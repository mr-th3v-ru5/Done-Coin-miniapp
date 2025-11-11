// mini-app.js — DONE Hub mini app ($DONE Airdrop + Bet & Earn)

(function () {
  const els = {};
  const state = {
    fid: null,
    score: null,
    wallet: null
  };

  // airdrop contract address (for future on-chain claim hooks)
  const AIRDROP_CONTRACT_ADDRESS =
    "0x1df8DcCAD57939BaB8Ae0f3406Eaa868887E03bb";

  document.addEventListener("DOMContentLoaded", () => {
    // header
    els.scorePill = document.getElementById("score-pill");
    els.scoreVal = document.getElementById("score-val");

    // farcaster
    els.fcUser = document.getElementById("fc-user");
    els.fidLabel = document.getElementById("fid-label");
    els.fcHint = document.getElementById("fc-hint");

    // wallet
    els.walletAddr = document.getElementById("wallet-addr");

    // quest + progress
    els.steps = document.querySelectorAll(".step");
    els.progressFill = document.getElementById("progressFill");
    els.progressLabel = document.getElementById("progressLabel");
    els.progressHint = document.getElementById("progressHint");

    // claim
    els.btnClaim = document.getElementById("btn-claim");
    els.claimStatus = document.getElementById("claim-status");

    // tabs
    els.tabAirdrop = document.getElementById("tab-airdrop");
    els.tabBet = document.getElementById("tab-bet");
    els.viewAirdrop = document.getElementById("view-airdrop");
    els.viewBet = document.getElementById("view-bet");

    setupTabs();
    setupSteps();
    detectContext();
  });

  // ====== TABS ======
  function setupTabs() {
    if (!els.tabAirdrop || !els.tabBet || !els.viewAirdrop || !els.viewBet)
      return;

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

  // ====== QUEST STEPS ======
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
    const done = Array.from(els.steps).filter((s) =>
      s.classList.contains("done")
    ).length;
    const pct = total ? (done / total) * 100 : 0;

    els.progressFill.style.width = pct + "%";
    els.progressLabel.textContent = `${done} / ${total} steps complete`;
  }

  // ====== CONTEXT (FID + WALLET) ======
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
            "FID detected. Score & quest checks can be applied.";
        fetchNeynarScore(fid);
      } else {
        if (els.fidLabel) els.fidLabel.textContent = "unknown";
        if (els.claimStatus)
          els.claimStatus.textContent =
            "FID is not detected yet — automatic claim is disabled.";
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
      if (els.fcUser) els.fcUser.textContent = shortAddr(addr);
    } catch (e) {
      console.warn("detectWalletFromProvider error:", e);
    }
  }

  function shortAddr(addr) {
    if (!addr) return "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  // ====== NEYNAR SCORE (OPTIONAL) ======
  async function fetchNeynarScore(fid) {
    if (!fid || !els.scoreVal) return;

    try {
      els.scoreVal.textContent = "…";

      // assumes backend endpoint /api/neynar-score?fid=...
      const res = await fetch(`/api/neynar-score?fid=${encodeURIComponent(fid)}`);
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      const score = typeof data.score === "number" ? data.score : null;
      state.score = score;

      if (score === null) {
        els.scoreVal.textContent = "n/a";
        if (els.claimStatus)
          els.claimStatus.textContent =
            "Could not read Neynar score. Try again later.";
        return;
      }

      els.scoreVal.textContent = score.toFixed(2);
      if (els.claimStatus) {
        els.claimStatus.textContent =
          score >= 0.35
            ? "Score is high enough. Finish the quest and claim on the main site."
            : "Score is still low. Increase your activity before claiming.";
      }
    } catch (e) {
      console.warn("fetchNeynarScore error:", e);
      if (els.scoreVal) els.scoreVal.textContent = "error";
      if (els.claimStatus)
        els.claimStatus.textContent =
          "Failed to load Neynar score. Please try again later.";
    }
  }
})();
