
// DONE Hub - on-chain aligned script (DoneBtcPrediction)
// - Bets go to CURRENT EPOCH (as in the contract).
// - Shows min bet from contract.
// - Blocks betting after lockTime (contract will also revert).
// - Adds "Claim rewards" panel: detect claimable epochs and call claim()/claimBatch().
// - Keeps BTC preview chart optional; but on-chain result is authoritative.
//
// Requires ethers v5 to be available globally.

(() => {
  const BET_CONTRACT_ADDRESS = "0xA24f111Ac03D9b03fFd9E04bD7A18e65f6bfddd7";
  const DONE_TOKEN_ADDRESS   = "0x3Da0Da9414D02c1E4cc4526a5a24F5eeEbfCEAd4";
  const MIN_BET_FALLBACK     = "2000"; // only used for UI hint if contract read fails

  // ===== ABIs (minimal) =====
  const ERC20_ABI = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address spender, uint256 value) returns (bool)"
  ];

  // DoneBtcPrediction
  const BET_ABI = [
    "function feeBps() view returns (uint256)",
    "function minBetAmount() view returns (uint256)",
    "function currentEpoch() view returns (uint256)",
    "function poolBalance() view returns (uint256)",
    "function setDurations(uint256,uint256)",
    "function rounds(uint256) view returns (uint256 epoch,uint64 startTime,uint64 lockTime,uint64 closeTime,int256 lockPrice,int256 closePrice,uint256 totalUp,uint256 totalDown,uint8 result,bool locked,bool closed,bool feeTaken)",
    "function getUserBet(uint256,address) view returns (uint256 amount, uint8 position, bool claimed)",
    "function placeBet(uint8 side,uint256 amount)",
    "function claim(uint256 epoch)",
    "function claimBatch(uint256[] epochs)"
  ];

  // ===== STATE =====
  const els = {};
  const state = {
    provider: null,
    signer: null,
    address: null,
    doneDecimals: 18,
    doneBalanceRaw: "0",
    minBetRaw: null,
    currentEpoch: 0,
    round: null, // latest round struct
    feeBps: 0,
    // selection
    selectedSide: null, // 0=DOWN,1=UP
  };

  // ===== HELPERS =====
  function $(id) { return document.getElementById(id); }
  function formatUnits(bn, decimals) {
    try { return ethers.utils.formatUnits(bn || 0, decimals).replace(/\.0+$/,''); }
    catch { return "0"; }
  }
  function parseUnits(str, decimals) {
    return ethers.utils.parseUnits(String(str || "0"), decimals);
  }
  function short(addr) {
    return addr ? addr.slice(0,6) + "..." + addr.slice(-4) : "";
  }
  function setStatus(msg, tone) {
    const el = els.betStatus;
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("status-success","status-error","status-info");
    if (tone) el.classList.add(tone);
  }
  function clearStatus() { setStatus("", null); }

  // claim UI helpers
  function ensureClaimPanel() {
    if (els.claimPanel) return;
    const panel = document.createElement("div");
    panel.id = "claim-panel";
    panel.style.marginTop = "10px";
    panel.style.border = "1px solid rgba(148,163,184,0.2)";
    panel.style.borderRadius = "12px";
    panel.style.padding = "10px 12px";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="font-weight:600;">On-chain rewards</div>
        <div>
          <button id="btn-claim-all" class="btn btn-claim" style="display:none;">Claim all</button>
        </div>
      </div>
      <div id="claim-list" style="margin-top:8px;font-size:14px;color:#cbd5e1">No claimable rewards.</div>
    `;
    const anchor = els.btnPlaceBet ? els.btnPlaceBet.parentElement : document.body;
    anchor.appendChild(panel);
    els.claimPanel = panel;
    els.claimList = panel.querySelector("#claim-list");
    els.btnClaimAll = panel.querySelector("#btn-claim-all");
    if (els.btnClaimAll) {
      els.btnClaimAll.addEventListener("click", claimAllHandler);
    }
  }

  // ===== INIT =====
  document.addEventListener("DOMContentLoaded", async () => {
    // wire elements that already exist in your HTML
    els.addr = $("wallet-address");
    els.doneBalance = $("done-balance");
    els.poolInfo = $("pool-info");
    els.betStatus = $("bet-status");
    els.minBetHint = $("min-bet-hint");
    els.betAmount = $("bet-amount");
    els.btnPlaceBet = $("btn-place-bet");
    els.btnUp = $("btn-up");
    els.btnDown = $("btn-down");
    // visual
    els.betDirection = $("bet-direction");
    els.betEntryPrice = $("bet-entry-price");
    els.betClosePrice = $("bet-close-price");

    // selection buttons
    if (els.btnUp) els.btnUp.addEventListener("click", () => {
      state.selectedSide = 1;
      els.btnUp.classList.add("active");
      if (els.btnDown) els.btnDown.classList.remove("active");
    });
    if (els.btnDown) els.btnDown.addEventListener("click", () => {
      state.selectedSide = 0;
      els.btnDown.classList.add("active");
      if (els.btnUp) els.btnUp.classList.remove("active");
    });

    if (els.minBetHint) {
      els.minBetHint.textContent = `Minimum bet from contract: ${MIN_BET_FALLBACK} DONE`;
    }

    // connect provider
    if (window.ethereum) {
      state.provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      try {
        await state.provider.send("eth_requestAccounts", []);
        state.signer = state.provider.getSigner();
        state.address = await state.signer.getAddress();
      } catch (e) {
        setStatus("Connect your wallet to place bets.", "status-info");
      }
    }

    if (state.address && els.addr) {
      els.addr.textContent = short(state.address);
    }

    // initial fetch
    await refreshOnchainBasics();
    await refreshBalances();
    await refreshRoundAndClaims();

    // actions
    if (els.btnPlaceBet) els.btnPlaceBet.addEventListener("click", placeBetFlow);

    // periodic refresh
    setInterval(refreshRoundAndClaims, 10_000); // every 10s
    setInterval(refreshBalances, 20_000);
  });

  // ===== ONCHAIN READS =====
  function getContracts() {
    const signerOrProv = state.signer || state.provider;
    if (!signerOrProv) return {};
    const erc20 = new ethers.Contract(DONE_TOKEN_ADDRESS, ERC20_ABI, signerOrProv);
    const bet   = new ethers.Contract(BET_CONTRACT_ADDRESS, BET_ABI, signerOrProv);
    return { erc20, bet };
  }

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
        const min = formatUnits(minBetRaw, dec);
        els.minBetHint.textContent = `Minimum bet from contract: ${min} DONE`;
      }
      if (els.poolInfo) {
        els.poolInfo.textContent = `Pool: ${formatUnits(pool, dec)} DONE`;
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

  async function refreshRoundAndClaims() {
    try {
      ensureClaimPanel();
      const { bet } = getContracts();
      if (!bet) return;

      // current round
      const epoch = await bet.currentEpoch();
      state.currentEpoch = Number(epoch.toString());
      const r = await bet.rounds(state.currentEpoch);
      state.round = r;

      // update timer-ish label (lock/close relative)
      const now = Math.floor(Date.now()/1000);
      const lockLeft  = Math.max(0, Number(r.lockTime)  - now);
      const closeLeft = Math.max(0, Number(r.closeTime) - now);
      const timerEl = document.getElementById("round-timer");
      if (timerEl) {
        if (!r.locked) {
          timerEl.textContent = `${lockLeft}s to lock`;
        } else if (!r.closed) {
          timerEl.textContent = `${closeLeft}s to close`;
        } else {
          timerEl.textContent = `Round closed`;
        }
      }

      // claimable scanner for recent epochs (currentEpoch-10 .. currentEpoch)
      if (!state.address) return;
      const start = Math.max(1, state.currentEpoch - 10);
      const claimRows = [];
      const claimable = [];

      for (let e = start; e <= state.currentEpoch; e++) {
        const rinfo = await bet.rounds(e);
        const binfo = await bet.getUserBet(e, state.address);

        const amount = ethers.BigNumber.from(binfo.amount || 0);
        const pos    = Number(binfo.position || 0); // 0=Down,1=Up
        const claimed = !!binfo.claimed;
        const closed = !!rinfo.closed;
        const result = Number(rinfo.result || 0); // 0=Undecided,1=Up,2=Down,3=Draw

        if (amount.isZero()) continue; // no bet this epoch

        let status = "Pending";
        let payout = ethers.BigNumber.from(0);

        if (!closed) {
          status = "Open";
        } else {
          if (claimed) {
            status = "Claimed";
          } else {
            if (result === 3) { // Draw
              payout = amount;
              status = "Claimable (Draw)";
              claimable.push(e);
            } else if ((result === 1 && pos === 1) || (result === 2 && pos === 0)) {
              // winner
              const totalUp   = ethers.BigNumber.from(rinfo.totalUp || 0);
              const totalDown = ethers.BigNumber.from(rinfo.totalDown || 0);
              const totalPool = totalUp.add(totalDown);
              const feeBpsBN  = ethers.BigNumber.from(state.feeBps);
              const fee       = totalPool.mul(feeBpsBN).div(10000);
              const rewardPool = totalPool.sub(fee);
              const totalWinning = (result === 1) ? totalUp : totalDown;
              payout = amount.mul(rewardPool).div(totalWinning);
              status = "Claimable";
              claimable.push(e);
            } else {
              status = "Lost";
            }
          }
        }

        const amt = formatUnits(amount, state.doneDecimals);
        const pay = formatUnits(payout, state.doneDecimals);
        claimRows.push({ e, amount: amt, payout: pay, status, closed, claimed });
      }

      // render panel
      renderClaimPanel(claimRows, claimable);
    } catch (e) {
      console.warn("refreshRoundAndClaims error", e);
    }
  }

  function renderClaimPanel(rows, claimableEpochs) {
    ensureClaimPanel();
    if (!els.claimList) return;

    if (!rows || rows.length === 0) {
      els.claimList.innerHTML = `<div>No bets in the last rounds.</div>`;
      if (els.btnClaimAll) els.btnClaimAll.style.display = "none";
      return;
    }

    const parts = rows.slice().reverse().map(row => {
      const badge =
        row.status.startsWith("Claimable")
          ? `<span style="color:#4ade80;font-weight:600">${row.status}</span>`
          : row.status === "Lost"
              ? `<span style="color:#f87171;">${row.status}</span>`
              : `<span style="color:#cbd5e1;">${row.status}</span>`;

      const claimBtn =
        row.status.startsWith("Claimable")
          ? `<button class="btn btn-claim" data-epoch="${row.e}" style="margin-left:6px;">Claim</button>`
          : "";

      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px dashed rgba(148,163,184,0.25)">
        <div>Epoch #${row.e}</div>
        <div style="display:flex;gap:12px;align-items:center;">
          <div>Bet: ${row.amount} DONE</div>
          <div>Payout: ${row.payout}</div>
          <div>${badge}${claimBtn}</div>
        </div>
      </div>`;
    });

    els.claimList.innerHTML = parts.join("");

    // wire single-claim buttons
    els.claimList.querySelectorAll(".btn-claim").forEach(btn => {
      btn.addEventListener("click", async () => {
        const epoch = Number(btn.getAttribute("data-epoch"));
        await claimEpoch(epoch);
      });
    });

    if (els.btnClaimAll) {
      els.btnClaimAll.style.display = claimableEpochs.length > 0 ? "inline-block" : "none";
      els.btnClaimAll.dataset.epochs = JSON.stringify(claimableEpochs);
      els.btnClaimAll.textContent = `Claim all (${claimableEpochs.length})`;
    }
  }

  async function claimEpoch(epoch) {
    try {
      const { bet } = getContracts();
      setStatus(`⏳ Claiming epoch #${epoch}...`, "status-info");
      const tx = await bet.claim(epoch);
      await tx.wait();
      setStatus(`✅ Claimed reward for epoch #${epoch}`, "status-success");
      await refreshBalances();
      await refreshRoundAndClaims();
    } catch (e) {
      console.error(e);
      setStatus(`❌ Claim failed: ${e.message || e}`, "status-error");
    }
  }

  async function claimAllHandler() {
    try {
      if (!els.btnClaimAll || !els.btnClaimAll.dataset.epochs) return;
      const epochs = JSON.parse(els.btnClaimAll.dataset.epochs || "[]");
      if (!epochs.length) return;
      const { bet } = getContracts();
      setStatus(`⏳ Claiming ${epochs.length} epochs...`, "status-info");
      const tx = await bet.claimBatch(epochs);
      await tx.wait();
      setStatus(`✅ Claimed ${epochs.length} epochs`, "status-success");
      await refreshBalances();
      await refreshRoundAndClaims();
    } catch (e) {
      console.error(e);
      setStatus(`❌ Claim all failed: ${e.message || e}`, "status-error");
    }
  }

  // ===== PLACE BET FLOW (current epoch) =====
  async function placeBetFlow() {
    try {
      if (!state.signer || !state.address) {
        setStatus("Connect your wallet first.", "status-info");
        return;
      }

      // side chosen
      if (state.selectedSide !== 0 && state.selectedSide !== 1) {
        setStatus("Choose UP or DOWN before placing a bet.", "status-error");
        return;
      }

      // amount parsing
      const raw = (els.betAmount && els.betAmount.value) || "";
      const num = parseFloat(raw.replace(",", "."));
      if (!isFinite(num) || num <= 0) {
        setStatus("Enter a valid $DONE amount.", "status-error");
        return;
      }

      const amount = parseUnits(num, state.doneDecimals);

      // min bet
      if (state.minBetRaw && amount.lt(state.minBetRaw)) {
        const min = formatUnits(state.minBetRaw, state.doneDecimals);
        setStatus(`Minimum bet is ${min} DONE.`, "status-error");
        return;
      }

      const { erc20, bet } = getContracts();

      // check time window: must be before lockTime
      const r = await bet.rounds(state.currentEpoch);
      const now = Math.floor(Date.now()/1000);
      if (Number(r.startTime) === 0) {
        setStatus("Round not started yet.", "status-error");
        return;
      }
      if (now >= Number(r.lockTime)) {
        setStatus("Betting closed for this round. Try next round.", "status-error");
        return;
      }

      // one bet per epoch (contract enforces, we precheck to avoid revert)
      const binfo = await bet.getUserBet(state.currentEpoch, state.address);
      if (!ethers.BigNumber.from(binfo.amount || 0).isZero()) {
        setStatus("You already placed a bet in this epoch.", "status-error");
        return;
      }

      // balance check
      const bal = await erc20.balanceOf(state.address);
      if (bal.lt(amount)) {
        setStatus(`Your $DONE balance (${formatUnits(bal, state.doneDecimals)}) is lower than the bet amount.`, "status-error");
        return;
      }

      // allowance
      const allowance = await erc20.allowance(state.address, BET_CONTRACT_ADDRESS);
      if (allowance.lt(amount)) {
        setStatus("Approving DONE for the bet…", "status-info");
        const txApprove = await erc20.approve(BET_CONTRACT_ADDRESS, amount);
        await txApprove.wait();
      }

      setStatus("Sending bet transaction…", "status-info");
      const tx = await bet.placeBet(state.selectedSide, amount);
      await tx.wait();

      setStatus("✅ Bet confirmed on-chain for the current epoch.", "status-success");

      await refreshBalances();
      await refreshOnchainBasics();
      await refreshRoundAndClaims();
    } catch (e) {
      console.error(e);
      const msg = (e && e.error && e.error.message) || e.message || String(e);
      if (/execution reverted/i.test(msg)) {
        setStatus("Bet failed: execution reverted — likely betting window closed or min bet not met.", "status-error");
      } else {
        setStatus("Bet failed: " + msg, "status-error");
      }
    }
  }
})();
