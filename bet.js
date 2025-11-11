// bet.js — DONE BTC Prediction & ETH->DONE swap on Base

(function () {
  // ====== CONTRACT ADDRESSES (lowercase) ======
  const DONE_TOKEN_ADDRESS = "0x3da0da9414d02c1e4cc4526a5a24f5eeebfcead4";
  const BET_CONTRACT_ADDRESS = "0xc107cdb70bc93912aa6765c3a66dd88cee1acdf0";

  // Uniswap V2 router on Base
  const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
  const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

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
    "function placeBet(uint8 side, uint256 amount) external",
    "function currentEpoch() view returns (uint256)",
    "function rounds(uint256) view returns (uint256 epoch,uint64 startTime,uint64 lockTime,uint64 closeTime,int256 lockPrice,int256 closePrice,uint256 totalUp,uint256 totalDown,uint8 result,bool locked,bool closed,bool feeTaken)"
  ];

  const UNISWAP_V2_ROUTER_ABI = [
    "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable"
  ];

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
    poolBalanceRaw: null
  };

  const urlParams = new URLSearchParams(window.location.search || "");
  const isMini = urlParams.get("source") === "mini";

  const priceState = {
    lastPrice: null,
    lastChangePct: 0,
    roundSeconds: 60,
    timeLeft: 60
  };

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

    // SWAP elements
    els.swapAmountEth = document.getElementById("swap-amount-eth");
    els.swapEstimateDone = document.getElementById("swap-estimate-done");
    els.btnSwap = document.getElementById("btn-swap");
    els.swapStatus = document.getElementById("swap-status");

    // swap modal
    els.swapModal = document.getElementById("swap-modal");
    els.swapBackdrop = document.getElementById("swap-backdrop");
    els.swapClose = document.getElementById("swap-close");
    els.btnOpenSwap = document.getElementById("btn-open-swap");

    if (isMini && els.walletHint) {
      els.walletHint.textContent =
        "Mini app: you use the wallet from your Farcaster account. To change wallet, use Farcaster settings.";
    }

    setupUIHandlers();
    setupRoundButtons();
    setupSwapHandlers();
    startPriceTicker();
  });

  function setStatus(msg) {
    if (els.betStatus) els.betStatus.textContent = msg || "";
  }

  function setSwapStatus(msg) {
    if (els.swapStatus) els.swapStatus.textContent = msg || "";
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
    if (chainId === 8453) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }]
      });
    } catch (e) {
      console.warn("wallet_switchEthereumChain failed:", e);
      setStatus(
        "Please switch your wallet to Base (chainId 8453) before betting or swapping."
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
        if (chainId === 8453) {
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

  async function loadDoneTokenInfo() {
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
      console.warn("loadDoneTokenInfo error:", e);
    }
  }

  async function loadBetConfig() {
    if (!state.signer) return;
    if (!BET_CONTRACT_ADDRESS) {
      setStatus("BET_CONTRACT_ADDRESS is not set in bet.js");
      return;
    }

    try {
      const bet = new ethers.Contract(
        BET_CONTRACT_ADDRESS,
        BET_ABI,
        state.signer
      );

      try {
        const minBet = await bet.minBetAmount();
        state.minBetRaw = minBet.toString();
        const humanMin = ethers.utils.formatUnits(
          minBet,
          state.doneDecimals || 18
        );
        if (els.minBetHint) {
          els.minBetHint.textContent = `Minimum bet from contract: ${humanMin} DONE`;
        }
      } catch (e) {
        console.warn("minBetAmount error", e);
      }

      try {
        const pool = await bet.poolBalance();
        state.poolBalanceRaw = pool.toString();
        if (els.poolInfo) {
          const humanPool = ethers.utils.formatUnits(
            pool,
            state.doneDecimals || 18
          );
          els.poolInfo.textContent =
            `Pool: ${humanPool} DONE available for payouts`;
        }
      } catch (e) {
        console.warn("poolBalance error", e);
      }
    } catch (e) {
      console.error("loadBetConfig error:", e);
      setStatus("Failed to load bet configuration from contract.");
    }
  }

  function setupUIHandlers() {
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
          if (els.walletAddr) els.walletAddr.textContent = "not connected";
          if (els.doneBalance) els.doneBalance.textContent = "0.0";
          els.btnConnect.textContent = "🔗 Connect";
          els.btnConnect.classList.remove("connected");
          setStatus("Wallet disconnected. Connect again before betting.");
          setSwapStatus("");
        }
      });
    }

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

  function setupSwapHandlers() {
    if (els.swapAmountEth) {
      els.swapAmountEth.addEventListener("input", handleSwapEstimate);
    }
    if (els.btnSwap) {
      els.btnSwap.addEventListener("click", handleSwap);
    }

    if (els.btnOpenSwap && els.swapModal) {
      els.btnOpenSwap.addEventListener("click", () => {
        els.swapModal.classList.add("open");
        setSwapStatus("");
      });
    }

    if (els.swapClose) {
      els.swapClose.addEventListener("click", closeSwapModal);
    }
    if (els.swapBackdrop) {
      els.swapBackdrop.addEventListener("click", closeSwapModal);
    }
  }

  function closeSwapModal() {
    if (els.swapModal) {
      els.swapModal.classList.remove("open");
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
      await loadDoneTokenInfo();
      await loadBetConfig();
      await handleSwapEstimate();

      setStatus("Wallet connected. You can now bet and swap.");
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
    const num = parseFloat(rawAmount);
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
    const num = parseFloat(rawAmount);
    if (!isFinite(num) || num <= 0) {
      setStatus("Enter a valid $DONE amount.");
      return;
    }

    try {
      const amount = ethers.utils.parseUnits(
        rawAmount,
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

      const side = state.selectedSide || 0;
      const tx = await bet.placeBet(side, amount);
      setStatus("Bet tx sent: " + tx.hash + " (waiting for confirmation)…");

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        setStatus(
          "✅ Bet confirmed. Rewards will be claimable after this round is closed."
        );
        await loadDoneTokenInfo();
      } else {
        setStatus("Bet transaction failed or reverted.");
      }
    } catch (e) {
      console.error(e);
      let msg =
        e?.reason ||
        (e?.data && e.data.message) ||
        (e?.error && e.error.message) ||
        e?.message ||
        "unknown error";

      if (typeof msg === "string" && msg.includes("insufficient allowance")) {
        msg =
          "insufficient allowance — make sure your approve transaction is confirmed, then try again.";
      }

      setStatus("Bet failed: " + msg);
    }
  }

  // ====== SWAP FUNCTIONS ======

  async function handleSwapEstimate() {
    if (!els.swapAmountEth || !els.swapEstimateDone) return;
    const raw = els.swapAmountEth.value || "";
    const val = parseFloat(raw);
    if (!isFinite(val) || val <= 0) {
      els.swapEstimateDone.textContent = "—";
      return;
    }
    if (!state.provider) {
      els.swapEstimateDone.textContent = "connect wallet";
      return;
    }

    try {
      const router = new ethers.Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        state.provider
      );
      const amountIn = ethers.utils.parseEther(raw);
      const path = [WETH_ADDRESS, DONE_TOKEN_ADDRESS];
      const amounts = await router.getAmountsOut(amountIn, path);
      const out = amounts[1];
      const human = ethers.utils.formatUnits(out, state.doneDecimals || 18);
      els.swapEstimateDone.textContent = human;
    } catch (e) {
      console.warn("swap estimate error", e);
      els.swapEstimateDone.textContent = "—";
    }
  }

  async function handleSwap() {
    if (!state.signer || !state.address) {
      setSwapStatus("Connect your wallet first.");
      return;
    }
    if (!els.swapAmountEth) return;

    const raw = els.swapAmountEth.value || "";
    const val = parseFloat(raw);
    if (!isFinite(val) || val <= 0) {
      setSwapStatus("Enter a valid ETH amount.");
      return;
    }

    try {
      await ensureBaseNetwork();

      const amountIn = ethers.utils.parseEther(raw);
      const router = new ethers.Contract(
        UNISWAP_V2_ROUTER,
        UNISWAP_V2_ROUTER_ABI,
        state.signer
      );
      const path = [WETH_ADDRESS, DONE_TOKEN_ADDRESS];

      const amounts = await router.getAmountsOut(amountIn, path);
      const out = amounts[1];
      const minOut = out.mul(97).div(100);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      setSwapStatus("Sending swap transaction via Uniswap router…");

      const tx = await router.swapExactETHForTokens(
        minOut,
        path,
        state.address,
        deadline,
        { value: amountIn }
      );

      setSwapStatus(
        "Swap tx sent: " + tx.hash + " (waiting for confirmation)…"
      );

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        setSwapStatus("✅ Swap completed. Your DONE balance will refresh soon.");
        await loadDoneTokenInfo();
        await handleSwapEstimate();
      } else {
        setSwapStatus("Swap failed or reverted.");
      }
    } catch (e) {
      console.error(e);
      let msg =
        e?.reason ||
        (e?.data && e.data.message) ||
        (e?.error && e.error.message) ||
        e?.message ||
        "unknown error";

      setSwapStatus("Swap failed: " + msg);
    }
  }

  // ====== BTC TICKER & TIMER ======

  function startPriceTicker() {
    updateBtcPrice();
    setInterval(updateBtcPrice, 8000);
    startRoundTimer();
  }

  async function updateBtcPrice() {
    if (!els.btcPrice && !els.btcChange) return;
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
    } catch (e) {
      console.warn("updateBtcPrice error:", e);
    }
  }

  function startRoundTimer() {
    if (!els.roundTimer) return;
    priceState.timeLeft = priceState.roundSeconds;
    updateRoundTimer();
    setInterval(() => {
      priceState.timeLeft--;
      if (priceState.timeLeft <= 0) {
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