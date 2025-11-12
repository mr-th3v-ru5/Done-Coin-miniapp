
// bet.js — DONE Bet mini app (clean on-chain version)
// - Connect wallet on Base
// - Optional sign-message when NOT in Farcaster mini app
// - Place bet using DoneBtcPrediction contract (current epoch)
// - BTC price + simple visual round timer (frontend only)
// - Uses contract minBetAmount + prevents late betting before lockTime
//
// This script intentionally DOES NOT call claim()/claimBatch().
// It only:
//   - reads pool / round info,
//   - approves DONE if needed,
//   - calls placeBet(side, amount).
//
// Requires ethers v5 to be available globally.

(function () {
  // ====== CONFIG ======
  const BASE_CHAIN_ID = 8453;
  const DONE_TOKEN_ADDRESS = "0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4";
  const BET_CONTRACT_ADDRESS = "0xA24f111Ac03D9b03fFd9E04bD7A18e65f6bfddd7";
  const POOL_CONTRACT_ADDRESS = BET_CONTRACT_ADDRESS; // pool == bet contract
  const MIN_BET_FALLBACK = "2000";

  // ====== ABIs ======
  const ERC20_ABI = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  const BET_ABI = [
    "function minBetAmount() view returns (uint256)",
    "function feeBps() view returns (uint256)",
    "function currentEpoch() view returns (uint256)",
    "function poolBalance() view returns (uint256)",
    "function rounds(uint256) view returns (uint256 epoch,uint64 startTime,uint64 lockTime,uint64 closeTime,int256 lockPrice,int256 closePrice,uint256 totalUp,uint256 totalDown,uint8 result,bool locked,bool closed,bool feeTaken)",
    "function getUserBet(uint256,address) view returns (uint256 amount, uint8 position, bool claimed)",
    "function placeBet(uint8 side,uint256 amount)"
  ];

  // ====== STATE ======
  const els = {};
  const state = {
    provider: null,
    signer: null,
    address: null,
    doneDecimals: 18,
    doneBalanceRaw: "0",
    minBetRaw: null,
    feeBps: 0,
    currentEpoch: 0,
    selectedSide: null // 0=DOWN, 1=UP
  };

  const urlParams = new URLSearchParams(window.location.search || "");
  const isMini = urlParams.get("source") === "mini";

  const priceState = {
    lastPrice: null,
    lastChangePct: 0,
    roundSeconds: 60,
    timeLeft: 60,
    history: []
  };

  // ====== HELPERS ======
  function $(id) { return document.getElementById(id); }

  function shortAddr(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  function formatUnits(bn, decimals) {
    try {
      return ethers.utils.formatUnits(bn || 0, decimals).replace(/\.0+$/, "");
    } catch (e) {
      return "0";
    }
  }

  function parseUnits(numStr, decimals) {
    return ethers.utils.parseUnits(String(numStr || "0"), decimals);
  }

  function setStatus(msg, tone) {
    const el = els.betStatus;
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("status-success", "status-error", "status-info");
    if (tone) el.classList.add(tone);
  }

  function clearStatus() {
    const el = els.betStatus;
    if (!el) return;
    el.textContent = "";
    el.classList.remove("status-success", "status-error", "status-info");
  }

  // ====== DOM READY ======
  document.addEventListener("DOMContentLoaded", () => {
    // wallet + balances
    // Support both id="wallet-addr" (current HTML) and id="wallet-address" (older markup)
    els.walletAddress = $("wallet-addr") || $("wallet-address");
    els.walletHint = $("wallet-hint");
    els.doneBalance = $("done-balance");
    els.poolInfo = $("pool-info");
    els.betStatus = $("bet-status");

    // round / ticker
    els.btcPrice = $("btc-price");
    els.btcChange = $("btc-change");
    els.roundTimer = $("round-timer");

    // bet selection
    els.btnUp = $("btn-up");
    els.btnDown = $("btn-down");
    els.betAmount = $("bet-amount");
    els.quickAmounts = document.querySelectorAll(".qa");
    els.minBetHint = $("min-bet-hint");
    els.btnPlaceBet = $("btn-place-bet");

    // visual (optional)
    els.betDirection = $("bet-direction");
    els.betEntryPrice = $("bet-entry-price");
    els.betClosePrice = $("bet-close-price");

    // external swap + CA copy
    els.btnUniswap = $("btn-open-swap");
    els.caCopy = $("done-ca-copy");

    if (isMini && els.walletHint) {
      els.walletHint.textContent =
        "Mini app: you use the wallet from your Farcaster account. To change wallet, use Farcaster settings.";
    }

    if (els.minBetHint) {
      els.minBetHint.textContent =
        `Minimum bet from contract: ${MIN_BET_FALLBACK} DONE`;
    }

    setupWalletHandlers();
    setupBetHandlers();
    setupExternalSwapAndCA();
    startRoundTimerVisual();

    // initial fetch (best effort)
    refreshOnchainBasics().then(() => {
      refreshBalances();
      refreshRoundInfo();
    });
    setInterval(refreshOnchainBasics, 30000);
    setInterval(refreshBalances, 30000);
    setInterval(refreshRoundInfo, 15000);
  });

  // ====== WALLET ======
  function setupWalletHandlers() {
    const btn = $("btn-connect");
    if (!btn) return;
    btn.addEventListener("click", connectWallet);
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus("No wallet found. Install MetaMask or a compatible wallet.", "status-error");
      return;
    }
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      if (network.chainId !== BASE_CHAIN_ID) {
        setStatus("Switch network to Base first.", "status-error");
        try {
          await provider.send("wallet_switchEthereumChain", [{
            chainId: ethers.utils.hexValue(BASE_CHAIN_ID)
          }]);
        } catch (switchErr) {
          console.warn("switch chain error", switchErr);
          return;
        }
      }
      state.provider = provider;
      state.signer = provider.getSigner();
      state.address = await state.signer.getAddress();

      // update wallet label in UI (supports wallet-addr / wallet-address)
      if (els.walletAddress) {
        els.walletAddress.textContent = shortAddr(state.address);
      } else {
        const alt = document.getElementById("wallet-addr") || document.getElementById("wallet-address");
        if (alt) alt.textContent = shortAddr(state.address);
      }

      // optional sign-in message (non-mini)
      if (!isMini && state.signer) {
        try {
          const msg =
            "DONE Hub - Sign this message to confirm you control this wallet.\n\n" +
            "This is a free, off-chain signature and does not send a transaction.";
          await state.signer.signMessage(msg);
        } catch (signErr) {
          console.warn("User skipped signature:", signErr);
        }
      }

      setStatus("Wallet connected. You can now place bets.", "status-success");
      await refreshOnchainBasics();
      await refreshBalances();
      await refreshRoundInfo();
    } catch (e) {
      console.error(e);
      setStatus("Wallet connection failed.", "status-error");
    }
  }

  function getContracts() {
    const signerOrProv = state.signer || state.provider;
    if (!signerOrProv) return {};
    const erc20 = new ethers.Contract(DONE_TOKEN_ADDRESS, ERC20_ABI, signerOrProv);
    const bet = new ethers.Contract(BET_CONTRACT_ADDRESS, BET_ABI, signerOrProv);
    return { erc20, bet };
  }

  // ====== ONCHAIN READS ======
  async function refreshOnchainBasics() {
    try {
      const { erc20, bet } = getContracts();
      if (!erc20 || !bet) return;
      const [dec, minBetRaw, feeBps, epoch, pool] = await Promise.all([
        erc20.decimals(),
        bet.minBetAmount(),
        bet.feeBps(),
        bet.currentEpoch(),
        bet.poolBalance()
      ]);
      state.doneDecimals = dec;
      state.minBetRaw = minBetRaw;
      state.feeBps = Number(feeBps.toString());
      state.currentEpoch = Number(epoch.toString());
      if (els.minBetHint) {
        const humanMin = formatUnits(minBetRaw, dec);
        els.minBetHint.textContent = `Minimum bet from contract: ${humanMin} DONE`;
      }
      if (els.poolInfo) {
        els.poolInfo.textContent =
          `Pool: ${formatUnits(pool, dec)} DONE available for payouts`;
      }
    } catch (e) {
      console.warn("refreshOnchainBasics error", e);
    }
  }

  async function refreshBalances() {
    try {
      const { erc20 } = getContracts();
      if (!erc20 || !state.address) return;
      const bal = await erc20.balanceOf(state.address);
      state.doneBalanceRaw = bal;
      if (els.doneBalance) {
        els.doneBalance.textContent = formatUnits(bal, state.doneDecimals);
      }
    } catch (e) {
      console.warn("refreshBalances error", e);
    }
  }

  async function refreshRoundInfo() {
    try {
      const { bet } = getContracts();
      if (!bet) return;
      const epoch = await bet.currentEpoch();
      state.currentEpoch = Number(epoch.toString());
      const r = await bet.rounds(state.currentEpoch);

      const now = Math.floor(Date.now() / 1000);
      const lockLeft = Math.max(0, Number(r.lockTime) - now);
      const closeLeft = Math.max(0, Number(r.closeTime) - now);

      if (els.roundTimer) {
        if (!r.locked) {
          els.roundTimer.textContent = `${lockLeft}s to lock`;
        } else if (!r.closed) {
          els.roundTimer.textContent = `${closeLeft}s to close`;
        } else {
          els.roundTimer.textContent = "Round closed";
        }
      }
    } catch (e) {
      console.warn("refreshRoundInfo error", e);
    }
  }

  // ====== BET HANDLERS ======
  function setupBetHandlers() {
    if (els.btnUp) els.btnUp.addEventListener("click", () => {
      state.selectedSide = 1;
      els.btnUp.classList.add("active");
      if (els.btnDown) els.btnDown.classList.remove("active");
      if (els.betDirection) els.betDirection.textContent = "UP";
    });
    if (els.btnDown) els.btnDown.addEventListener("click", () => {
      state.selectedSide = 0;
      els.btnDown.classList.add("active");
      if (els.btnUp) els.btnUp.classList.remove("active");
      if (els.betDirection) els.betDirection.textContent = "DOWN";
    });

    if (els.quickAmounts) {
      els.quickAmounts.forEach((btn) => {
        btn.addEventListener("click", () => {
          const pct = parseFloat(btn.dataset.pct || "0");
          if (!state.doneBalanceRaw || pct <= 0) return;
          const bal = parseFloat(formatUnits(state.doneBalanceRaw, state.doneDecimals));
          const v = Math.floor((bal * pct) / 100);
          if (els.betAmount) els.betAmount.value = v.toString();
        });
      });
    }

    if (els.btnPlaceBet) {
      els.btnPlaceBet.addEventListener("click", placeBetFlow);
    }
  }

  async function placeBetFlow() {
    try {
      if (!state.signer || !state.address) {
        setStatus("Connect your wallet first.", "status-error");
        return;
      }
      if (state.selectedSide !== 0 && state.selectedSide !== 1) {
        setStatus("Choose UP or DOWN before placing a bet.", "status-error");
        return;
      }

      const raw = (els.betAmount && els.betAmount.value) || "";
      const num = parseFloat(raw.replace(",", "."));
      if (!isFinite(num) || num <= 0) {
        setStatus("Enter a valid $DONE amount.", "status-error");
        return;
      }

      const amount = parseUnits(num, state.doneDecimals);

      if (state.minBetRaw && amount.lt(state.minBetRaw)) {
        const min = formatUnits(state.minBetRaw, state.doneDecimals);
        setStatus(`Minimum bet is ${min} DONE.`, "status-error");
        return;
      }

      const { erc20, bet } = getContracts();
      if (!erc20 || !bet) {
        setStatus("Wallet contracts not ready.", "status-error");
        return;
      }

      // check round window
      const r = await bet.rounds(state.currentEpoch);
      const now = Math.floor(Date.now() / 1000);
      if (Number(r.startTime) === 0) {
        setStatus("Round not started yet.", "status-error");
        return;
      }
      if (now >= Number(r.lockTime)) {
        setStatus("Betting closed for this round. Wait for the next round.", "status-error");
        return;
      }

      // already bet this epoch?
      const binfo = await bet.getUserBet(state.currentEpoch, state.address);
      if (!ethers.BigNumber.from(binfo.amount || 0).isZero()) {
        setStatus("You already placed a bet in this epoch.", "status-error");
        return;
      }

      // balance
      const bal = await erc20.balanceOf(state.address);
      if (bal.lt(amount)) {
        setStatus(
          `Your $DONE balance (${formatUnits(bal, state.doneDecimals)}) is lower than the bet amount.`,
          "status-error"
        );
        return;
      }

      // allowance
      const allowance = await erc20.allowance(state.address, BET_CONTRACT_ADDRESS);
      if (allowance.lt(amount)) {
        setStatus("Approving DONE for the bet…", "status-info");
        const txApprove = await erc20.approve(BET_CONTRACT_ADDRESS, amount);
        await txApprove.wait();
      }

      // place bet
      setStatus("Sending bet transaction…", "status-info");
      const tx = await bet.placeBet(state.selectedSide, amount);
      await tx.wait();
      setStatus("✅ Bet confirmed on-chain for this epoch.", "status-success");

      await refreshBalances();
      await refreshOnchainBasics();
      await refreshRoundInfo();
    } catch (e) {
      console.error(e);
      const msg = (e && e.error && e.error.message) || e.message || String(e);
      if (/execution reverted/i.test(msg)) {
        setStatus(
          "Bet failed: execution reverted — likely betting window closed, already bet, or min bet not met.",
          "status-error"
        );
      } else {
        setStatus("Bet failed: " + msg, "status-error");
      }
    }
  }

  // ====== VISUAL ROUND TIMER (frontend only, not authoritative) ======
  function startRoundTimerVisual() {
    if (!els.roundTimer) return;
    priceState.timeLeft = priceState.roundSeconds;
    setInterval(() => {
      priceState.timeLeft--;
      if (priceState.timeLeft <= 0) {
        priceState.timeLeft = priceState.roundSeconds;
      }
    }, 1000);
  }

  // ====== EXTERNAL SWAP & CA ======
  function setupExternalSwapAndCA() {
    if (els.btnUniswap) {
      els.btnUniswap.addEventListener("click", () => {
        const url = `https://app.uniswap.org/swap?chain=base&outputCurrency=${DONE_TOKEN_ADDRESS}`;
        window.open(url, "_blank");
      });
    }
    if (els.caCopy) {
      els.caCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(DONE_TOKEN_ADDRESS);
          els.caCopy.textContent = "Copied!";
          setTimeout(() => {
            els.caCopy.textContent = "Copy DONE CA";
          }, 800);
        } catch (e) {
          console.warn("Clipboard error", e);
        }
      });
    }
  }
})();
