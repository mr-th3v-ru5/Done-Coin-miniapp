// bet.js — DONE Bet mini app
// - Connect wallet on Base
// - Place bet using DoneBtcPrediction contract
// - BTC ticker + round timer
// - Visual entry/close price around each round (frontend only)
// - Simple BTC/USDT line chart
// - External "Swap $DONE on Uniswap" button + copyable DONE CA
// - Auto refresh minBet & poolBalance every 30s

(function () {
  // ====== CONFIG ======

  const BASE_CHAIN_ID = 8453;
  const DONE_TOKEN_ADDRESS = "0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4";
  const BET_CONTRACT_ADDRESS = "0xC107CDB70bC93912Aa6765C3a66Dd88cEE1aCDf0";

  // ====== ABIs ======

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  const BET_ABI = [
    "function minBetAmount() view returns (uint256)",
    "function poolBalance() view returns (uint256)",
    "function placeBet(uint8 side, uint256 amount) external"
  ];

  // ====== STATE ======

  const els = {};
  const state = {
    provider: null,
    signer: null,
    address: null,
    doneDecimals: 18,
    doneBalanceRaw: "0",
    selectedSide: 0,
    selectedMult: 1.2,
    minBetRaw: null,
    poolBalanceRaw: null,
    lastBetVisual: null
  };

  let poolRefreshInterval = null;

  const urlParams = new URLSearchParams(window.location.search || "");
  const isMini = urlParams.get("source") === "mini";

  const priceState = {
    lastPrice: null,
    lastChangePct: 0,
    roundSeconds: 60,
    timeLeft: 60,
    history: []
  };

  // ====== DOM READY ======

  document.addEventListener("DOMContentLoaded", () => {
    // WALLET / HEADER
    els.walletAddr = document.getElementById("wallet-addr-bet");
    els.networkName = document.getElementById("network-name");
    els.networkPill = document.getElementById("network-pill");
    els.doneBalance = document.getElementById("done-balance");
    els.btnConnect = document.getElementById("btn-connect");
    els.walletHint = document.getElementById("wallet-hint");

    // BET UI
    els.modes = document.querySelectorAll(".mode-chip");
    els.betAmount = document.getElementById("bet-amount");
    els.quickAmounts = document.querySelectorAll(".qa");
    els.minBetHint = document.getElementById("min-bet-hint");
    els.btnPlaceBet = document.getElementById("btn-place-bet");
    els.rewardPreview = document.getElementById("reward-preview");
    els.payoutPreview = document.getElementById("payout-preview");
    els.poolInfo = document.getElementById("pool-info");
    els.betStatus = document.getElementById("bet-status");

    // TICKER / ROUND
    els.btcPrice = document.getElementById("btc-price");
    els.btcChange = document.getElementById("btc-change");
    els.roundTimer = document.getElementById("round-timer");
    els.btnUp = document.getElementById("btn-up");
    els.btnDown = document.getElementById("btn-down");

    // VISUAL PRICE INFO
    els.betEntryPrice = document.getElementById("bet-entry-price");
    els.betClosePrice = document.getElementById("bet-close-price");
    els.betOutcome = document.getElementById("bet-outcome");

    // BTC CHART
    els.btcChart = document.getElementById("btc-chart");

    // EXTERNAL SWAP BUTTON + CA COPY
    els.btnUniswap = document.getElementById("btn-open-swap");
    els.caCopy = document.getElementById("done-ca-copy");

    if (isMini && els.walletHint) {
      els.walletHint.textContent =
        "Mini app: you use the wallet from your Farcaster account. To change wallet, use Farcaster settings.";
    }

    setupWalletHandlers();
    setupBetHandlers();
    setupRoundButtons();
    setupExternalSwapAndCA();
    startPriceTicker();
  });

  // ====== HELPERS ======

  function setStatus(msg) {
    if (els.betStatus) els.betStatus.textContent = msg || "";
  }

  function shortAddr(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  async function ensureBaseNetwork(rawProvider) {
    const provider = rawProvider || (state.provider && state.provider.provider);
    if (!provider || !provider.request) return;

    const net = await state.provider.getNetwork();
    const chainId = Number(net.chainId || 0);
    if (chainId === BASE_CHAIN_ID) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }]
      });
    } catch (e) {
      console.warn("wallet_switchEthereumChain failed:", e);
      setStatus(
        "Please switch your wallet to Base (chainId 8453) before betting."
      );
      throw e;
    }
  }

  async function refreshNetworkInfo() {
    if (!state.provider) return;
    try {
      const net = await state.provider.getNetwork();
      const chainId = Number(net.chainId || 0);
      if (els.networkName) {
        if (chainId === BASE_CHAIN_ID) {
          els.networkName.textContent = "Base";
          els.networkPill && els.networkPill.classList.add("ok");
        } else {
          els.networkName.textContent = `chainId ${chainId}`;
          els.networkPill && els.networkPill.classList.add("bad");
        }
      }
    } catch (e) {
      console.warn("refreshNetworkInfo error:", e);
    }
  }

  async function refreshDoneBalance() {
    if (!state.signer || !state.address) return;
    try {
      const erc20 = new ethers.Contract(
        DONE_TOKEN_ADDRESS,
        ERC20_ABI,
        state.signer
      );
      const [decimals, balance] = await Promise.all([
        erc20.decimals(),
        erc20.balanceOf(state.address)
      ]);
      state.doneDecimals = Number(decimals) || 18;
      state.doneBalanceRaw = balance.toString();

      if (els.doneBalance) {
        const human = ethers.utils.formatUnits(
          state.doneBalanceRaw,
          state.doneDecimals
        );
        els.doneBalance.textContent = human;
      }
    } catch (e) {
      console.warn("refreshDoneBalance error:", e);
    }
  }

  async function refreshPoolInfo() {
    if (!state.signer || !BET_CONTRACT_ADDRESS) return;
    try {
      const bet = new ethers.Contract(
        BET_CONTRACT_ADDRESS,
        BET_ABI,
        state.signer
      );

      const [minBet, pool] = await Promise.all([
        bet.minBetAmount(),
        bet.poolBalance()
      ]);

      state.minBetRaw = minBet.toString();
      state.poolBalanceRaw = pool.toString();

      if (els.minBetHint) {
        const humanMin = ethers.utils.formatUnits(
          state.minBetRaw,
          state.doneDecimals || 18
        );
        els.minBetHint.textContent =
          `Minimum bet from contract: ${humanMin} DONE`;
      }

      if (els.poolInfo) {
        const humanPool = ethers.utils.formatUnits(
          state.poolBalanceRaw,
          state.doneDecimals || 18
        );
        els.poolInfo.textContent =
          `Pool: ${humanPool} DONE available for payouts`;
      }
    } catch (e) {
      console.warn("refreshPoolInfo error:", e);
    }
  }

  async function loadBetConfig() {
    await refreshPoolInfo();
  }

  // ====== WALLET & BET ======

  function setupWalletHandlers() {
    if (els.btnConnect) {
      els.btnConnect.addEventListener("click", async () => {
        if (!state.address) {
          await connectWallet();
          return;
        }

        if (isMini) {
          setStatus(
            "Wallet is provided by the mini app. To change it, use Farcaster settings."
          );
        } else {
          state.provider = null;
          state.signer = null;
          state.address = null;
          state.doneBalanceRaw = "0";
          state.minBetRaw = null;
          state.poolBalanceRaw = null;

          if (poolRefreshInterval) {
            clearInterval(poolRefreshInterval);
            poolRefreshInterval = null;
          }

          if (els.walletAddr) els.walletAddr.textContent = "not connected";
          if (els.doneBalance) els.doneBalance.textContent = "0.0";
          if (els.minBetHint) els.minBetHint.textContent = "Minimum bet: —";
          if (els.poolInfo) els.poolInfo.textContent = "Pool: —";

          els.btnConnect.textContent = "🔗 Connect";
          els.btnConnect.classList.remove("connected");
          setStatus("Wallet disconnected. Connect again before betting.");
        }
      });
    }
  }

  function setupBetHandlers() {
    if (els.modes && els.modes.length) {
      els.modes.forEach((btn) => {
        btn.addEventListener("click", () => {
          els.modes.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const mult = parseFloat(btn.dataset.mult || "1");
          const side = parseInt(btn.dataset.side || "0", 10);
          state.selectedMult = mult;
          state.selectedSide = side;
          updatePayoutPreview();
        });
      });
    }

    if (els.quickAmounts && els.quickAmounts.length) {
      els.quickAmounts.forEach((btn) => {
        btn.addEventListener("click", () => {
          const p = parseFloat(btn.dataset.perc || "0");
          if (!state.doneBalanceRaw || !state.doneDecimals) return;
          const bal = ethers.utils.formatUnits(
            state.doneBalanceRaw,
            state.doneDecimals
          );
          const numBal = parseFloat(bal);
          if (!isFinite(numBal) || numBal <= 0) return;
          const use = (numBal * p) / 100;
          if (els.betAmount) {
            els.betAmount.value = use.toFixed(2);
          }
          updatePayoutPreview();
        });
      });
    }

    if (els.betAmount) {
      els.betAmount.addEventListener("input", updatePayoutPreview);
    }

    if (els.btnPlaceBet) {
      els.btnPlaceBet.addEventListener("click", placeBetFlow);
    }
  }

  async function connectWallet() {
    if (typeof window.ethereum === "undefined") {
      setStatus("No web3 wallet found (window.ethereum is missing).");
      return;
    }

    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const addr = accounts[0];

      state.provider = provider;
      state.signer = provider.getSigner();
      state.address = addr;

      if (els.walletAddr) els.walletAddr.textContent = shortAddr(addr);
      if (els.btnConnect) {
        els.btnConnect.textContent = shortAddr(addr);
        els.btnConnect.classList.add("connected");
      }

      await ensureBaseNetwork(provider.provider);
      await refreshNetworkInfo();
      await refreshDoneBalance();
      await loadBetConfig();
      setStatus("Wallet connected. You can now bet.");

      if (poolRefreshInterval) clearInterval(poolRefreshInterval);
      poolRefreshInterval = setInterval(() => {
        if (state.signer && state.address) {
          refreshPoolInfo();
        }
      }, 30000);
    } catch (e) {
      console.error(e);
      setStatus(
        "Failed to connect wallet: " + (e?.message || "unknown error")
      );
    }
  }

  function updatePayoutPreview() {
    if (!els.betAmount) return;
    const rawAmount = els.betAmount.value || "";
    const num = parseFloat(rawAmount.replace(",", "."));
    if (!isFinite(num) || num <= 0) {
      if (els.rewardPreview) els.rewardPreview.textContent = "";
      if (els.payoutPreview) els.payoutPreview.textContent = "";
      return;
    }

    if (els.rewardPreview) {
      els.rewardPreview.textContent =
        "Estimated reward (without principal) depends on the on-chain pool and winners of this round.";
    }
    if (els.payoutPreview) {
      els.payoutPreview.textContent =
        "Final payout (principal + reward) is calculated and sent automatically by the DoneBtcPrediction contract after the round is closed.";
    }
  }

  async function placeBetFlow() {
    if (!state.signer || !state.address) {
      setStatus("Connect your wallet first.");
      return;
    }

    const rawAmount = (els.betAmount && els.betAmount.value) || "";
    const num = parseFloat(rawAmount.replace(",", "."));
    if (!isFinite(num) || num <= 0) {
      setStatus("Enter a valid $DONE amount.");
      return;
    }

    if (priceState.lastPrice && isFinite(priceState.lastPrice)) {
      state.lastBetVisual = {
        side: state.selectedSide || 0,
        entryPrice: priceState.lastPrice,
        resolved: false
      };
      if (els.betEntryPrice) {
        els.betEntryPrice.textContent = priceState.lastPrice.toFixed(2);
      }
      if (els.betClosePrice) {
        els.betClosePrice.textContent = "—";
      }
      if (els.betOutcome) {
        els.betOutcome.textContent = "Waiting for round close…";
        els.betOutcome.classList.remove("bet-win", "bet-lose", "bet-draw");
      }
    }

    try {
      const amount = ethers.utils.parseUnits(
        rawAmount.replace(",", "."),
        state.doneDecimals || 18
      );

      if (state.minBetRaw) {
        const min = ethers.BigNumber.from(state.minBetRaw);
        if (amount.lt(min)) {
          const humanMin = ethers.utils.formatUnits(
            state.minBetRaw,
            state.doneDecimals || 18
          );
          setStatus(`Bet amount is below minimum: ${humanMin} DONE`);
          return;
        }
      }

      if (state.doneBalanceRaw) {
        const bal = ethers.BigNumber.from(state.doneBalanceRaw);
        if (bal.lt(amount)) {
          const humanBal = ethers.utils.formatUnits(
            state.doneBalanceRaw,
            state.doneDecimals || 18
          );
          setStatus(
            `Your $DONE balance (${humanBal}) is lower than the bet amount.`
          );
          return;
        }
      }

      if (state.poolBalanceRaw) {
        const pool = ethers.BigNumber.from(state.poolBalanceRaw);
        if (pool.isZero()) {
          setStatus(
            "Pool is empty (0 DONE). Please wait until the contract is funded before betting."
          );
          return;
        }
        if (amount.gt(pool)) {
          const humanPool = ethers.utils.formatUnits(
            state.poolBalanceRaw,
            state.doneDecimals || 18
          );
          setStatus(
            `Bet amount is larger than pool balance (${humanPool} DONE). Try a smaller bet.`
          );
          return;
        }
      }

      const erc20 = new ethers.Contract(
        DONE_TOKEN_ADDRESS,
        ERC20_ABI,
        state.signer
      );
      const bet = new ethers.Contract(
        BET_CONTRACT_ADDRESS,
        BET_ABI,
        state.signer
      );

      setStatus("Checking $DONE allowance for bet contract...");
      let allowance = await erc20.allowance(
        state.address,
        BET_CONTRACT_ADDRESS
      );

      if (allowance.lt(amount)) {
        setStatus(
          "Allowance is too low. Sending approve transaction (max allowance)..."
        );
        const txApprove = await erc20.approve(
          BET_CONTRACT_ADDRESS,
          ethers.constants.MaxUint256
        );
        await txApprove.wait();

        allowance = await erc20.allowance(
          state.address,
          BET_CONTRACT_ADDRESS
        );
        if (allowance.lt(amount)) {
          setStatus(
            "Allowance is still low after approve. Please re-check on BaseScan."
          );
          return;
        }

        setStatus("Approve confirmed. Sending bet transaction...");
      } else {
        setStatus("Allowance OK. Sending bet transaction...");
      }

      if (els.btnPlaceBet) {
        els.btnPlaceBet.classList.add("bet-pending");
      }

      const side = state.selectedSide || 0;
      const tx = await bet.placeBet(side, amount);
      setStatus("Bet tx sent: " + tx.hash + " (waiting for confirmation)…");

      const receipt = await tx.wait();
      if (els.btnPlaceBet) els.btnPlaceBet.classList.remove("bet-pending");

      if (receipt.status === 1) {
        setStatus(
          "✅ Bet confirmed on-chain. Visual result will show at end of this countdown round."
        );
        await refreshDoneBalance();
        await refreshPoolInfo();
        if (els.btnPlaceBet) {
          els.btnPlaceBet.classList.add("bet-ok");
          setTimeout(() => {
            els.btnPlaceBet.classList.remove("bet-ok");
          }, 600);
        }
      } else {
        setStatus("Bet transaction failed or reverted by the network.");
      }
    } catch (e) {
      console.error(e);
      if (els.btnPlaceBet) els.btnPlaceBet.classList.remove("bet-pending");

      let msg =
        e?.reason ||
        (e?.data && e.data.message) ||
        (e?.error && e.error.message) ||
        e?.message ||
        "unknown error";

      if (typeof msg === "string") {
        if (msg.toLowerCase().includes("execution reverted")) {
          msg =
            "execution reverted — this usually means the contract conditions are not met (round locked, pool empty, or bet size not allowed). Check pool/min bet and try again.";
        } else if (msg.includes("insufficient allowance")) {
          msg =
            "insufficient allowance — make sure your approve transaction is confirmed, then try again.";
        }
      }

      setStatus("Bet failed: " + msg);
    }
  }

  // ====== EXTERNAL SWAP BUTTON + COPY CA ======

  function setupExternalSwapAndCA() {
    if (els.btnUniswap) {
      els.btnUniswap.textContent = "Swap $DONE on Uniswap";
      els.btnUniswap.addEventListener("click", () => {
        const url =
          "https://app.uniswap.org/swap?chain=base&outputCurrency=" +
          DONE_TOKEN_ADDRESS;
        window.open(url, "_blank");
      });
    }

    if (els.caCopy) {
      els.caCopy.textContent = DONE_TOKEN_ADDRESS;
      els.caCopy.style.cursor = "pointer";
      els.caCopy.title = "Click to copy $DONE contract address";

      els.caCopy.addEventListener("click", async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(DONE_TOKEN_ADDRESS);
          }
          const original = DONE_TOKEN_ADDRESS;
          els.caCopy.textContent = "Copied!";
          els.caCopy.classList.add("copied");
          setTimeout(() => {
            els.caCopy.textContent = original;
            els.caCopy.classList.remove("copied");
          }, 1000);
        } catch (e) {
          alert("DONE token contract address:\n" + DONE_TOKEN_ADDRESS);
        }
      });
    }
  }

  // ====== ROUND CONTROLS ======

  function setupRoundButtons() {
    if (!els.btnUp || !els.btnDown) return;
    els.btnUp.addEventListener("click", () => {
      state.selectedSide = 1;
      els.btnUp.classList.add("active");
      els.btnDown.classList.remove("active");
    });
    els.btnDown.addEventListener("click", () => {
      state.selectedSide = 0;
      els.btnDown.classList.add("active");
      els.btnUp.classList.remove("active");
    });
  }

  function resolveVisualBet() {
    if (!state.lastBetVisual || state.lastBetVisual.resolved) return;
    const entry = state.lastBetVisual.entryPrice;
    const close = priceState.lastPrice;
    if (!entry || !close || !els.betOutcome) return;

    if (els.betClosePrice) {
      els.betClosePrice.textContent = close.toFixed(2);
    }

    let msg;
    let cls;
    if (
      (close > entry && state.lastBetVisual.side === 1) ||
      (close < entry && state.lastBetVisual.side === 0)
    ) {
      msg = "✅ Your bet direction is correct based on BTC price (visual only).";
      cls = "bet-win";
    } else if (close === entry) {
      msg = "⏸ BTC price closed at the same level as your entry.";
      cls = "bet-draw";
    } else {
      msg = "❌ Your bet direction is wrong based on BTC price (visual only).";
      cls = "bet-lose";
    }

    els.betOutcome.textContent = msg;
    els.betOutcome.classList.remove("bet-win", "bet-lose", "bet-draw");
    els.betOutcome.classList.add(cls);
    state.lastBetVisual.resolved = true;
  }

  // ====== BTC TICKER, CHART & ROUND TIMER ======

  function startPriceTicker() {
    updateBtcPrice();
    setInterval(updateBtcPrice, 8000);
    startRoundTimer();
  }

  async function updateBtcPrice() {
    if (!els.btcPrice && !els.btcChange && !els.btcChart) return;
    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
      );
      const data = await res.json();
      const price = parseFloat(data.price || "0");
      if (!isFinite(price) || price <= 0) return;

      if (priceState.lastPrice !== null) {
        const diff = price - priceState.lastPrice;
        const pct = (diff / priceState.lastPrice) * 100;
        priceState.lastChangePct = pct;
      }
      priceState.lastPrice = price;

      if (els.btcPrice) {
        els.btcPrice.textContent = price.toFixed(2);
      }
      if (els.btcChange) {
        const pct = priceState.lastChangePct;
        els.btcChange.textContent =
          (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
        els.btcChange.classList.remove("up", "down", "neutral");
        els.btcChange.classList.add(
          pct > 0.05 ? "up" : pct < -0.05 ? "down" : "neutral"
        );
      }

      priceState.history.push(price);
      if (priceState.history.length > 60) priceState.history.shift();
      renderBtcChart();
    } catch (e) {
      console.warn("updateBtcPrice error:", e);
    }
  }

  function renderBtcChart() {
    if (!els.btcChart || !els.btcChart.getContext) return;
    const ctx = els.btcChart.getContext("2d");
    const width = els.btcChart.width || els.btcChart.clientWidth || 320;
    const height = els.btcChart.height || els.btcChart.clientHeight || 140;

    const data = priceState.history || [];
    if (!data.length) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    const min = Math.min.apply(null, data);
    const max = Math.max.apply(null, data);
    const pad = (max - min) * 0.1 || 1;
    const low = min - pad;
    const high = max + pad;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#2c2f3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();

    ctx.strokeStyle = "#00d17a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((p, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const t = (p - low) / (high - low);
      const y = height - t * (height - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function startRoundTimer() {
    if (!els.roundTimer) return;
    priceState.timeLeft = priceState.roundSeconds;
    updateRoundTimer();
    setInterval(() => {
      priceState.timeLeft--;
      if (priceState.timeLeft <= 0) {
        resolveVisualBet();
        priceState.timeLeft = priceState.roundSeconds;
      }
      updateRoundTimer();
    }, 1000);
  }

  function updateRoundTimer() {
    if (!els.roundTimer) return;
    els.roundTimer.textContent = priceState.timeLeft + "s";
  }
})();