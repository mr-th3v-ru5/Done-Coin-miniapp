// DONE Hub Mini App JS
// - Tab 1: Airdrop Quest (Neynar anti-bot + claim DONE)
// - Tab 2: Bet & Earn (buka dApp taruhan eksternal)

(function () {
  const AIRDROP_ADDRESS = "0x1df8DcCAD57939BaB8Ae0f3406Eaa868887E03bb";
  const AIRDROP_ABI = ["function claim() external"];
  const MIN_SCORE = 0.35;

  // URL bet dApp (root-relative, akan buka /bet.html)
  const BET_DAPP_URL = "/bet.html";

  const state = {
    fid: null,
    username: null,
    displayName: null,
    score: null,
    scoreEligible: false,
    walletAddress: null,
    provider: null,
    signer: null,
    questCompleted: false,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    els.scorePill = document.getElementById("score-pill");
    els.scoreVal = document.getElementById("score-val");
    els.fcUser = document.getElementById("fc-user");
    els.walletAddr = document.getElementById("wallet-addr");
    els.fcHint = document.getElementById("fc-hint");
    els.progressFill = document.getElementById("progressFill");
    els.progressLabel = document.getElementById("progressLabel");
    els.progressHint = document.getElementById("progressHint");
    els.claimBtn = document.getElementById("btn-claim");
    els.claimStatus = document.getElementById("claim-status");

    els.tabAirdrop = document.getElementById("tab-airdrop");
    els.tabBet = document.getElementById("tab-bet");
    els.viewAirdrop = document.getElementById("view-airdrop");
    els.viewBet = document.getElementById("view-bet");
    els.betOpenBtn = document.getElementById("btn-open-bet");

    setupTabs();
    setupQuestToggles();
    setupBetButton();

    bootstrap().catch((e) => {
      console.error(e);
      setClaimStatus("Gagal inisialisasi mini app. Coba tutup dan buka lagi.");
    });
  });

  function setupTabs() {
    const setTab = (which) => {
      const isAirdrop = which === "airdrop";
      els.tabAirdrop.classList.toggle("active", isAirdrop);
      els.tabBet.classList.toggle("active", !isAirdrop);
      els.viewAirdrop.classList.toggle("view-hidden", !isAirdrop);
      els.viewBet.classList.toggle("view-hidden", isAirdrop);
    };

    els.tabAirdrop.addEventListener("click", () => setTab("airdrop"));
    els.tabBet.addEventListener("click", () => setTab("bet"));
    setTab("airdrop");
  }

  function setupBetButton() {
    if (!els.betOpenBtn) return;
    els.betOpenBtn.addEventListener("click", () => {
      if (!BET_DAPP_URL) return;
      try {
        window.open(BET_DAPP_URL, "_blank");
      } catch (e) {
        console.warn("Cannot open bet dapp:", e);
      }
    });
  }

  function setupQuestToggles() {
    const stepEls = document.querySelectorAll(".step");
    if (!stepEls.length) return;

    stepEls.forEach((step) => {
      step.addEventListener("click", () => {
        step.classList.toggle("done");
        updateQuestProgress();
        updateClaimButton();
      });
    });
    updateQuestProgress();
  }

  function updateQuestProgress() {
    const stepEls = document.querySelectorAll(".step");
    const total = stepEls.length;
    let done = 0;
    stepEls.forEach((s) => {
      if (s.classList.contains("done")) done++;
    });

    const pct = total ? (done / total) * 100 : 0;
    if (els.progressFill) {
      els.progressFill.style.width = pct + "%";
    }
    if (els.progressLabel) {
      els.progressLabel.textContent = `${done} / ${total} steps complete`;
    }
    state.questCompleted = done === total;
  }

  function setClaimStatus(msg) {
    if (els.claimStatus) els.claimStatus.textContent = msg;
  }

  function shortAddr(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function parseFidFromQuery() {
    const qs = new URLSearchParams(window.location.search || "");
    const cand =
      qs.get("fid") ||
      qs.get("viewerFid") ||
      qs.get("viewer_fid") ||
      qs.get("f");
    if (!cand) return null;
    const n = parseInt(cand, 10);
    return Number.isFinite(n) ? n : null;
  }

  async function hydrateFarcasterFromBackend() {
    try {
      const resp = await fetch("/api/farcaster/session");
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data || !data.fid) return;

      state.fid = data.fid;
      state.username = data.username || null;
      state.displayName = data.displayName || null;
      if (typeof data.score === "number") {
        state.score = data.score;
        state.scoreEligible = data.score >= MIN_SCORE;
      }
    } catch (e) {
      console.warn("hydrateFarcasterFromBackend error:", e);
    }
  }

  async function fetchNeynarScoreIfNeeded() {
    if (!state.fid) return;
    if (state.score != null) return;

    try {
      const resp = await fetch(`/api/neynar-score?fid=${state.fid}`);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      let score = null;
      if (typeof data.score === "number") {
        score = data.score;
      } else if (
        data.experimental &&
        typeof data.experimental.neynar_user_score === "number"
      ) {
        score = data.experimental.neynar_user_score;
      }
      state.score = score;
      state.scoreEligible = score != null && score >= MIN_SCORE;
    } catch (e) {
      console.warn("fetchNeynarScoreIfNeeded error:", e);
    }
  }

  async function connectWallet() {
    if (state.walletAddress) return;

    if (typeof window.ethereum === "undefined") {
      if (els.walletAddr) els.walletAddr.textContent = "no ethereum provider";
      throw new Error("No ethereum provider found (window.ethereum missing)");
    }

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    const addr = accounts && accounts[0];

    state.provider = provider;
    state.signer = provider.getSigner();
    state.walletAddress = addr || null;

    if (els.walletAddr) {
      els.walletAddr.textContent = addr ? shortAddr(addr) : "unknown address";
    }
  }

  function updateScoreUI() {
    if (els.scoreVal) {
      els.scoreVal.textContent =
        state.score != null ? state.score.toFixed(2) : "—";
    }
    if (!els.scorePill) return;
    els.scorePill.classList.remove("ok", "bad");

    if (state.score == null) {
      // tidak tahu
    } else if (state.scoreEligible) {
      els.scorePill.classList.add("ok");
    } else {
      els.scorePill.classList.add("bad");
    }
  }

  function updateFarcasterUI() {
    if (els.fcUser) {
      if (!state.fid) {
        els.fcUser.textContent = "FID unknown";
      } else {
        const handle =
          state.username ? "@" + state.username : "fid:" + state.fid;
        els.fcUser.textContent = handle;
      }
    }

    if (els.fcHint) {
      if (!state.fid) {
        els.fcHint.textContent =
          "Tidak bisa mendeteksi FID Farcaster dari mini app. Pastikan mini app dikonfigurasi untuk mengirimkan FID di URL atau sesi backend.";
      } else if (state.score == null) {
        els.fcHint.textContent =
          "FID terdeteksi. Mengambil Neynar score untuk anti-bot…";
      } else if (!state.scoreEligible) {
        els.fcHint.textContent =
          "Score Neynar kamu di bawah 0.35. Kamu tetap bisa mencoba lagi nanti setelah score naik.";
      } else {
        els.fcHint.textContent =
          "Score Neynar kamu memenuhi syarat. Selesaikan quest lalu klaim airdrop.";
      }
    }
  }

  function updateClaimButton() {
    if (!els.claimBtn) return;

    const can =
      state.walletAddress &&
      state.scoreEligible &&
      state.questCompleted &&
      state.fid;

    els.claimBtn.disabled = !can;

    if (!can) {
      if (!state.walletAddress) {
        setClaimStatus("Menunggu wallet Farcaster terhubung…");
      } else if (!state.fid) {
        setClaimStatus("FID Farcaster belum terdeteksi, tidak bisa klaim.");
      } else if (!state.scoreEligible) {
        setClaimStatus(
          "Score Neynar kamu belum mencapai 0.35. Klaim airdrop dikunci."
        );
      } else if (!state.questCompleted) {
        setClaimStatus("Centang semua langkah quest sebelum klaim.");
      }
    } else {
      setClaimStatus(
        "Semua syarat terpenuhi. Kamu bisa klaim 1,000 DONE ke wallet ini."
      );
    }
  }

  async function ensureBaseNetwork(rawProvider) {
    const provider = rawProvider || (state.provider && state.provider.provider);
    if (!provider || !provider.request) return;
    const baseChainId = "0x2105";
    try {
      const current = await provider.request({ method: "eth_chainId" });
      if (current === baseChainId) return;
    } catch (e) {}
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: baseChainId }],
      });
    } catch (switchErr) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: baseChainId,
              chainName: "Base",
              nativeCurrency: {
                name: "Ether",
                symbol: "ETH",
                decimals: 18,
              },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } catch (addErr) {
        console.warn("Cannot switch/add Base:", addErr);
      }
    }
  }

  async function runClaim() {
    if (!state.signer || !state.provider) {
      throw new Error("Wallet belum terhubung");
    }
    if (typeof ethers === "undefined") {
      throw new Error("ethers.js belum dimuat");
    }
    await ensureBaseNetwork(state.provider.provider);

    const contract = new ethers.Contract(
      AIRDROP_ADDRESS,
      AIRDROP_ABI,
      state.signer
    );

    if (els.claimBtn) {
      els.claimBtn.disabled = true;
      els.claimBtn.textContent = "⛓️ Sending claim tx…";
    }
    setClaimStatus("Mengirim transaksi claim ke kontrak DONE airdrop…");

    const tx = await contract.claim();
    setClaimStatus("Tx terkirim: " + tx.hash + ". Menunggu konfirmasi…");
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      if (els.claimBtn) {
        els.claimBtn.textContent = "✅ Claimed";
        els.claimBtn.disabled = true;
      }
      setClaimStatus("Berhasil klaim! 1,000 DONE dikirim ke wallet kamu.");
    } else {
      throw new Error("Transaction reverted");
    }
  }

  async function bootstrap() {
    if (els.claimBtn) {
      els.claimBtn.addEventListener("click", async () => {
        try {
          await runClaim();
        } catch (e) {
          console.error(e);
          if (els.claimBtn) {
            els.claimBtn.disabled = false;
            els.claimBtn.textContent = "🎁 Claim 1,000 DONE";
          }
          setClaimStatus(
            "Claim gagal: " +
              (e && e.message ? e.message : "alasan tidak diketahui.")
          );
        }
      });
    }

    try {
      await connectWallet();
    } catch (e) {
      console.warn("connectWallet error:", e);
    }

    state.fid = parseFidFromQuery();
    if (!state.fid) {
      await hydrateFarcasterFromBackend();
    }

    await fetchNeynarScoreIfNeeded();

    if (state.walletAddress && els.walletAddr) {
      els.walletAddr.textContent = shortAddr(state.walletAddress);
    }
    updateScoreUI();
    updateFarcasterUI();
    updateClaimButton();
  }
})();
