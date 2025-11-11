// bet.js — DONE BTC Prediction (kontrak DoneBtcPrediction di Base)

(function () {
  // ====== KONFIGURASI ALAMAT KONTRAK ======
  // Token DONE (ERC-20)
  const DONE_TOKEN_ADDRESS = "0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4";
  // Kontrak prediction baru (DoneBtcPrediction)
  const BET_CONTRACT_ADDRESS = "0xC107CDB70bC93912Aa6765C3a66Dd88cEE1aCDf0";

  // ABI standar ERC20 minimal
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];

  // ABI utama DoneBtcPrediction (bagian yang dipakai frontend)
  const BET_ABI = [
    "function minBetAmount() view returns (uint256)",
    "function poolBalance() view returns (uint256)",
    "function placeBet(uint8 side, uint256 amount) external",
    "function currentEpoch() view returns (uint256)",
    "function rounds(uint256) view returns (uint256 epoch,uint64 startTime,uint64 lockTime,uint64 closeTime,int256 lockPrice,int256 closePrice,uint256 totalUp,uint256 totalDown,uint8 result,bool locked,bool closed,bool feeTaken)"
  ];

  const els = {};
  const state = {
    provider: null,
    signer: null,
    address: null,
    doneDecimals: 18,
    doneBalanceRaw: "0",
    selectedSide: 0, // 0 = Down, 1 = Up
    selectedMult: 1.2,
    minBetRaw: null,
    poolBalanceRaw: null
  };

  // Flag jika dibuka dari mini app (source=mini)
  const urlParams = new URLSearchParams(window.location.search || "");
  const isMini = urlParams.get("source") === "mini";

  // State visual untuk ticker BTC & timer round (frontend only)
  const priceState = {
    lastPrice: null,
    lastChangePct: 0,
    roundSeconds: 60,
    timeLeft: 60
  };

  document.addEventListener("DOMContentLoaded", () => {
    // DOM element utama
    els.walletAddr = document.getElementById("wallet-addr-bet");
    els.networkName = document.getElementById("network-name");
    els.networkPill = document.getElementById("network-pill");
    els.doneBalance = document.getElementById("done-balance");
    els.btnConnect = document.getElementById("btn-connect");
    els.walletHint = document.getElementById("wallet-hint");

    els.modes = document.querySelectorAll(".mode-chip");
    els.betAmount = document.getElementById("bet-amount");
    els.quickAmounts = document.querySelectorAll(".qa");
    els.minBetHint = document.getElementById("min-bet-hint");
    els.btnPlaceBet = document.getElementById("btn-place-bet");
    els.rewardPreview = document.getElementById("reward-preview");
    els.payoutPreview = document.getElementById("payout-preview");
    els.poolInfo = document.getElementById("pool-info");
    els.betStatus = document.getElementById("bet-status");

    // elemen untuk ticker BTC & tombol UP/DOWN (kalau ada di HTML)
    els.btcPrice = document.getElementById("btc-price");
    els.btcChange = document.getElementById("btc-change");
    els.roundTimer = document.getElementById("round-timer");
    els.btnUp = document.getElementById("btn-up");
    els.btnDown = document.getElementById("btn-down");

    if (isMini && els.walletHint) {
      els.walletHint.textContent =
        "Mini app: kamu menggunakan wallet akun Farcaster. Untuk ganti wallet, gunakan pengaturan di aplikasi Farcaster.";
    }

    setupUIHandlers();
    setupRoundButtons();
    startPriceTicker(); // safe walaupun elemen ticker belum ada, semua dicek dulu
  });

  // ====== UTIL ======

  function setStatus(msg) {
    if (els.betStatus) els.betStatus.textContent = msg;
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
    if (chainId === 8453) return; // Base mainnet

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }] // 8453
      });
    } catch (e) {
      console.warn("wallet_switchEthereumChain gagal:", e);
      setStatus(
        "Pastikan network wallet kamu sudah di Base (chainId 8453) sebelum bertaruh."
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
      setStatus("BET_CONTRACT_ADDRESS belum di-set di bet.js");
      return;
    }

    try {
      const bet = new ethers.Contract(
        BET_CONTRACT_ADDRESS,
        BET_ABI,
        state.signer
      );

      // minimal bet
      try {
        const minBet = await bet.minBetAmount();
        state.minBetRaw = minBet.toString();
        const humanMin = ethers.utils.formatUnits(
          minBet,
          state.doneDecimals || 18
        );
        if (els.minBetHint) {
          els.minBetHint.textContent = `Minimal bet dari kontrak: ${humanMin} DONE`;
        }
      } catch (e) {
        console.warn("loadBetConfig: minBetAmount error", e);
      }

      // pool DONE dalam kontrak
      try {
        const pool = await bet.poolBalance();
        state.poolBalanceRaw = pool.toString();
        if (els.poolInfo) {
          const humanPool = ethers.utils.formatUnits(
            pool,
            state.doneDecimals || 18
          );
          els.poolInfo.textContent =
            `Pool: ${humanPool} DONE tersedia untuk payout`;
        }
      } catch (e) {
        console.warn("loadBetConfig: poolBalance error", e);
      }
    } catch (e) {
      console.error("loadBetConfig error:", e);
      setStatus("Gagal memuat konfigurasi bet dari kontrak.");
    }
  }

  // ====== UI HANDLERS ======

  function setupUIHandlers() {
    // tombol connect kecil di kanan atas
    if (els.btnConnect) {
      els.btnConnect.addEventListener("click", async () => {
        if (!state.address) {
          await connectWallet();
          return;
        }

        if (isMini) {
          setStatus(
            "Wallet terhubung dari mini app. Untuk ganti wallet, gunakan pengaturan di aplikasi Farcaster."
          );
        } else {
          // disconnect manual
          state.provider = null;
          state.signer = null;
          state.address = null;
          state.doneBalanceRaw = "0";
          if (els.walletAddr) els.walletAddr.textContent = "not connected";
          if (els.doneBalance) els.doneBalance.textContent = "0.0";
          els.btnConnect.textContent = "🔗 Connect Wallet";
          els.btnConnect.classList.remove("connected");
          setStatus("Wallet terputus. Silakan connect lagi sebelum bertaruh.");
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
      els.betAmount.addEventListener("input", () => {
        updatePayoutPreview();
      });
    }

    if (els.btnPlaceBet) {
      els.btnPlaceBet.addEventListener("click", placeBetFlow);
    }
  }

  // tombol UP / DOWN visual (mapping ke selectedSide)
  function setupRoundButtons() {
    if (!els.btnUp || !els.btnDown) return;
    els.btnUp.addEventListener("click", () => {
      state.selectedSide = 1; // UP
      els.btnUp.classList.add("active");
      els.btnDown.classList.remove("active");
    });
    els.btnDown.addEventListener("click", () => {
      state.selectedSide = 0; // DOWN
      els.btnDown.classList.add("active");
      els.btnUp.classList.remove("active");
    });
  }

  async function connectWallet() {
    if (typeof window.ethereum === "undefined") {
      setStatus("Tidak ada wallet web3 (window.ethereum tidak ditemukan).");
      if (els.walletHint)
        els.walletHint.textContent =
          "Gunakan browser dengan wallet seperti MetaMask / Rabby.";
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

      setStatus("Wallet terhubung. Siap untuk bertaruh.");
    } catch (e) {
      console.error(e);
      setStatus(
        "Gagal menghubungkan wallet: " + (e?.message || "unknown error")
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

    // Untuk sekarang hanya penjelasan teks, payout real dihitung kontrak
    if (els.rewardPreview) {
      els.rewardPreview.textContent =
        "Perkiraan reward (tanpa modal): tergantung hasil kontrak DoneBtcPrediction.";
    }
    if (els.payoutPreview) {
      els.payoutPreview.textContent =
        "Payout final (modal + reward) dihitung dan dikirim otomatis oleh kontrak setelah round ditutup.";
    }
  }

  // ====== FLOW PLACE BET ======

  async function placeBetFlow() {
    if (!state.signer || !state.address) {
      setStatus("Hubungkan wallet dulu.");
      return;
    }

    const rawAmount = (els.betAmount && els.betAmount.value) || "";
    const num = parseFloat(rawAmount);
    if (!isFinite(num) || num <= 0) {
      setStatus("Masukkan jumlah $DONE yang valid.");
      return;
    }

    try {
      const amount = ethers.utils.parseUnits(
        rawAmount,
        state.doneDecimals || 18
      );

      // cek minimal bet
      if (state.minBetRaw) {
        const min = ethers.BigNumber.from(state.minBetRaw);
        if (amount.lt(min)) {
          const humanMin = ethers.utils.formatUnits(
            state.minBetRaw,
            state.doneDecimals || 18
          );
          setStatus(`Jumlah bet kurang dari minimal: ${humanMin} DONE`);
          return;
        }
      }

      // cek saldo
      if (state.doneBalanceRaw) {
        const bal = ethers.BigNumber.from(state.doneBalanceRaw);
        if (bal.lt(amount)) {
          const humanBal = ethers.utils.formatUnits(
            state.doneBalanceRaw,
            state.doneDecimals || 18
          );
          setStatus(
            `Saldo $DONE kamu (${humanBal}) kurang dari jumlah bet yang diminta.`
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

      setStatus("Mengecek allowance $DONE untuk kontrak bet…");
      let allowance = await erc20.allowance(
        state.address,
        BET_CONTRACT_ADDRESS
      );

      if (allowance.lt(amount)) {
        setStatus(
          "Allowance kurang. Mengirim transaksi approve (set allowance tinggi)…"
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
            "Allowance masih kurang setelah approve. Cek kembali kontrak/token $DONE di BaseScan."
          );
          return;
        }

        setStatus("Approve selesai. Mengirim transaksi bet…");
      } else {
        setStatus("Allowance cukup. Mengirim transaksi bet…");
      }

      const side = state.selectedSide || 0; // 0=Down, 1=Up
      const tx = await bet.placeBet(side, amount);
      setStatus("Tx bet terkirim: " + tx.hash + " (menunggu konfirmasi)…");

      const receipt = await tx.wait();
      if (receipt.status === 1) {
        setStatus(
          "✅ Bet sukses! Klaim reward bisa dilakukan setelah round ditutup (lock & close)."
        );
        await loadDoneTokenInfo();
      } else {
        setStatus("Transaksi bet gagal / reverted.");
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
          "insufficient allowance — allowance $DONE ke kontrak masih kurang. Pastikan transaksi approve berhasil, lalu coba lagi.";
      }

      setStatus("Bet gagal: " + msg);
    }
  }

  // ====== BTC TICKER & ROUND TIMER (FRONTEND SAJA) ======

  function startPriceTicker() {
    // update harga pertama, lalu setiap 8 detik
    updateBtcPrice();
    setInterval(updateBtcPrice, 8000);
    startRoundTimer();
  }

  async function updateBtcPrice() {
    if (!els.btcPrice && !els.btcChange) return; // kalau tidak ada elemen, skip
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
