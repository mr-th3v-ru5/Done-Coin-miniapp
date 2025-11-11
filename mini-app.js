// mini-app.js — DONE Hub mini app
(function () {
  const els = {};
  const state = {
    fid: null,
    score: null,
    wallet: null,
  };

  const ROOT_URL = window.location.origin;
  const BET_DAPP_URL = ROOT_URL + "/bet.html?source=mini";

  document.addEventListener("DOMContentLoaded", () => {
    els.scorePill = document.getElementById("score-pill");
    els.scoreVal = document.getElementById("score-val");
    els.fcUser = document.getElementById("fc-user");
    els.fidLabel = document.getElementById("fid-label");
    els.fcHint = document.getElementById("fc-hint");
    els.walletAddr = document.getElementById("wallet-addr");
    els.progressFill = document.getElementById("progressFill");
    els.progressLabel = document.getElementById("progressLabel");
    els.progressHint = document.getElementById("progressHint");
    els.btnClaim = document.getElementById("btn-claim");
    els.claimStatus = document.getElementById("claim-status");
    els.steps = document.querySelectorAll(".step");
    els.tabAirdrop = document.getElementById("tab-airdrop");
    els.tabBet = document.getElementById("tab-bet");
    els.viewAirdrop = document.getElementById("view-airdrop");
    els.viewBet = document.getElementById("view-bet");
    els.betOpenBtn = document.getElementById("btn-open-bet");

    setupTabs();
    setupSteps();
    setupBetButton();
    detectContext();
  });

  function setupTabs() {
    if (!els.tabAirdrop || !els.tabBet || !els.viewAirdrop || !els.viewBet) return;
    els.tabAirdrop.addEventListener("click", () => {
      els.tabAirdrop.classList.add("active");
      els.tabBet.classList.remove("active");
      els.viewAirdrop.classList.remove("view-hidden");
      els.viewBet.classList.add("view-hidden");
    });
    els.tabBet.addEventListener("click", () => {
      els.tabBet.classList.add("active");
      els.tabAirdrop.classList.remove("active");
      els.viewBet.classList.remove("view-hidden");
      els.viewAirdrop.classList.add("view-hidden");
    });
  }

  function setupBetButton() {
    if (!els.betOpenBtn) return;
    els.betOpenBtn.addEventListener("click", () => {
      window.open(BET_DAPP_URL, "_blank");
    });
  }

  function setupSteps() {
    if (!els.steps || !els.steps.length) return;
    els.steps.forEach((li) => {
      li.addEventListener("click", () => {
        li.classList.toggle("done");
        updateProgress();
      });
    });
    updateProgress();
  }

  function updateProgress() {
    if (!els.steps || !els.progressFill || !els.progressLabel) return;
    const total = els.steps.length;
    const done = Array.from(els.steps).filter((s) => s.classList.contains("done"))
      .length;
    const pct = total ? (done / total) * 100 : 0;
    els.progressFill.style.width = pct + "%";
    els.progressLabel.textContent = `${done} / ${total} steps complete`;
  }

  function detectContext() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const fid =
        params.get("fid") ||
        params.get("viewerFid") ||
        params.get("userFid") ||
        null;

      if (fid) {
        state.fid = fid;
        if (els.fidLabel) els.fidLabel.textContent = fid;
        if (els.claimStatus)
          els.claimStatus.textContent =
            "FID Farcaster terdeteksi. Siap untuk verifikasi skor Neynar.";
        fetchNeynarScore(fid);
      } else {
        if (els.fidLabel) els.fidLabel.textContent = "unknown";
        if (els.claimStatus)
          els.claimStatus.textContent =
            "FID Farcaster belum terdeteksi, tidak bisa klaim.";
      }
    } catch (e) {
      console.warn("detectContext error:", e);
    }

    detectWalletFromProvider();
  }

  async function detectWalletFromProvider() {
    if (typeof window.ethereum === "undefined") return;
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.listAccounts();
      if (!accounts || !accounts.length) return;
      const addr = accounts[0];
      state.wallet = addr;
      if (els.walletAddr) els.walletAddr.textContent = shortAddr(addr);
    } catch (e) {
      console.warn("detectWalletFromProvider error:", e);
    }
  }

  function shortAddr(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  async function fetchNeynarScore(fid) {
    if (!fid || !els.scoreVal) return;
    try {
      els.scoreVal.textContent = "…";
      const res = await fetch(`/api/neynar-score?fid=${encodeURIComponent(fid)}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const score = typeof data.score === "number" ? data.score : null;
      state.score = score;
      if (score === null) {
        els.scoreVal.textContent = "n/a";
        if (els.claimStatus)
          els.claimStatus.textContent =
            "Tidak bisa membaca skor Neynar. Coba lagi nanti.";
        return;
      }
      els.scoreVal.textContent = score.toFixed(2);
      if (els.claimStatus) {
        els.claimStatus.textContent =
          score >= 0.35
            ? "Skor Neynar cukup tinggi. Kamu berhak klaim jika quest juga selesai."
            : "Skor Neynar masih rendah. Tingkatkan aktivitasmu sebelum klaim.";
      }
    } catch (e) {
      console.warn("fetchNeynarScore error:", e);
      if (els.scoreVal) els.scoreVal.textContent = "error";
      if (els.claimStatus)
        els.claimStatus.textContent =
          "Gagal memuat skor Neynar. Coba lagi nanti.";
    }
  }
})();
