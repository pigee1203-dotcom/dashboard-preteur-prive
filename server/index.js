const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 8080;

app.use(cors({ origin: true }));
app.use(express.json());

// ======================= Utils =========================
const clamp2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const nowIso = () => new Date().toISOString();

function toDateOnly(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function daysBetween(d1Iso, d2Iso) {
  const a = toDateOnly(d1Iso);
  const b = toDateOnly(d2Iso);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}
function sortSchedule(schedule) {
  return [...schedule].sort(
    (a, b) => (a.date || "").localeCompare(b.date || "") || (a.i || 0) - (b.i || 0)
  );
}

// ======================= DB mémoire =====================
const db = { loans: {} };

// ======================= Allocation "Margill-like" ======
// Order: arrears(optional) -> adhesion -> interest -> principal -> surplus
function allocatePayment({ amount, adhesionDue, interestDue, arrearsDue, payArrearsFirst }) {
  let remaining = clamp2(amount);
  const out = { toArrears: 0, toAdhesion: 0, toInterest: 0, toPrincipal: 0, surplus: 0 };

  if (payArrearsFirst && arrearsDue > 0) {
    const x = clamp2(Math.min(remaining, arrearsDue));
    out.toArrears = x;
    remaining = clamp2(remaining - x);
  }

  if (adhesionDue > 0) {
    const x = clamp2(Math.min(remaining, adhesionDue));
    out.toAdhesion = x;
    remaining = clamp2(remaining - x);
  }

  if (interestDue > 0) {
    const x = clamp2(Math.min(remaining, interestDue));
    out.toInterest = x;
    remaining = clamp2(remaining - x);
  }

  if (remaining > 0) {
    out.toPrincipal = remaining;
    remaining = 0;
  }

  out.surplus = clamp2(remaining);
  return out;
}

function openArrearsTotal(loan) {
  return clamp2((loan.arrearsItems || [])
    .filter(a => a.status === "OPEN")
    .reduce((s, a) => s + (a.total || 0), 0));
}

function closeArrearsFIFO(loan, amount) {
  // ferme des souffrances OPEN en FIFO (comme Margill)
  let remaining = clamp2(amount);
  let closed = 0;

  const items = (loan.arrearsItems || []).filter(a => a.status === "OPEN")
    .sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||""));

  for (const a of items) {
    if (remaining <= 0) break;
    const t = clamp2(a.total || 0);
    if (remaining >= t) {
      remaining = clamp2(remaining - t);
      a.total = 0;
      a.status = "RESOLVED";
      closed++;
    } else {
      a.total = clamp2(t - remaining);
      remaining = 0;
    }
  }
  return { closed, leftover: remaining };
}

// ======================= Moteur =========================
function recomputeSchedule(loan) {
  const cfg = loan.config || {};
  const annualRate = Number(cfg.annualRate ?? 0.1899);
  const dayBase = Number(cfg.dayBase ?? 365);
  const startBalance = clamp2(cfg.startBalance ?? 2250);
  const contractStartDate = cfg.contractStartDate || (loan.schedule?.[0]?.date ?? "2024-11-15");

  // Param Margill-like: est-ce qu'on applique les paiements à la souffrance en premier
  const payArrearsFirst = Boolean(cfg.payArrearsFirst ?? true);

  const ordered = sortSchedule(loan.schedule);

  // La date "réelle" de référence = dernier encaissement (postedDate) sinon date contrat
  let prevPostedDate = contractStartDate;
  let prevBalance = startBalance;

  // On calcule sans muter l'open arrears ici (ledger/arrears traités dans action POST)
  for (const row of ordered) {
    const planned = clamp2((row.total || 0) + (row.adjustment || 0));
    const adhesionDue = clamp2(row.adhesion || 0);

    // Réalité: montant encaissé = postedAmount si POSTED/PARTIAL, sinon 0.
    const postedStatus = row.postedStatus || "NONE"; // NONE|POSTED|PARTIAL|NSF
    const postedAmount = clamp2(row.postedAmount || 0);

    const collected = (postedStatus === "POSTED" || postedStatus === "PARTIAL") ? postedAmount : 0;

    // Jours basés sur encaissement réel si disponible, sinon date planifiée (pour affichage)
    const effectiveDate = row.postedDate || row.date;
    const days = daysBetween(prevPostedDate, effectiveDate);
    row.days = days;

    // Intérêt sur solde avant
    const interestDue = clamp2(prevBalance * annualRate * (days / dayBase));

    // Si on paye la souffrance en premier, elle "mange" du paiement encaissé.
    // Ici on calcule un "arrearsDue snapshot" juste pour affichage.
    const arrearsDue = openArrearsTotal(loan);

    const alloc = allocatePayment({
      amount: collected,
      adhesionDue,
      interestDue,
      arrearsDue,
      payArrearsFirst
    });

    // Capital = ce qui reste vers le principal (alloc.toPrincipal)
    const capital = clamp2(alloc.toPrincipal);

    const balanceAfter = clamp2(prevBalance - capital);

    row.planned = planned;
    row.collected = collected;
    row.loanPart = clamp2(collected - alloc.toArrears); // argent "restant" après souffrance (info)
    row.interest = clamp2(alloc.toInterest);
    row.capital = capital;
    row.balanceBefore = clamp2(prevBalance);
    row.balance = balanceAfter;
    row.allocation = alloc; // pour debug / audit

    prevBalance = balanceAfter;

    // avance prevPostedDate uniquement si encaissement réel (POSTED/PARTIAL)
    if (postedStatus === "POSTED" || postedStatus === "PARTIAL") {
      prevPostedDate = effectiveDate;
    }
  }

  loan._computedAt = nowIso();
}

// ======================= Seed ===========================
function seedLoan(loanId = "demo") {
  if (db.loans[loanId]) return db.loans[loanId];

  const schedule = [
    {i:1,  date:"2024-11-15", total:147.92, adhesion:45.00, adjustment:0, status:"À venir", paid:false, method:"PAD"},
    {i:2,  date:"2024-11-29", total:147.19, adhesion:45.00, adjustment:0, status:"À venir", paid:false, method:"PAD"},
    {i:3,  date:"2024-12-13", total:146.56, adhesion:45.00, adjustment:0, status:"À venir", paid:false, method:"PAD"},
    {i:4,  date:"2024-12-27", total:145.94, adhesion:45.00, adjustment:0, status:"À venir", paid:false, method:"PAD"},
  ];

  const loan = {
    loanId,
    config: {
      contractStartDate: "2024-10-31",
      startBalance: 2250.00,
      annualRate: 0.1899,
      dayBase: 365,
      reportFee: 25.00,
      defaultNSFFee: 48.00,
      payArrearsFirst: true, // ✅ Margill-like
    },
    schedule: schedule.map(r => ({
      ...r,
      postedStatus: "NONE",
      postedAmount: 0,
      postedDate: null,
    })),
    arrearsItems: [],
    events: [{ ts: nowIso(), title: "Dossier chargé", txt: "Backend MAX (encaissement réel + allocation)." }],
    ledger: [] // Margill-like: lignes comptables
  };

  recomputeSchedule(loan);
  db.loans[loanId] = loan;
  return loan;
}

function getLoan(req) {
  const loanId = req.params.loanId || "demo";
  return db.loans[loanId] || seedLoan(loanId);
}

// ======================= ROUTES =========================
app.get("/api/health", (req, res) => res.json({ ok: true, ts: nowIso() }));

app.get("/api/loans/:loanId", (req, res) => {
  const loan = getLoan(req);
  recomputeSchedule(loan);
  res.json(loan);
});

app.post("/api/loans/:loanId/reset", (req, res) => {
  delete db.loans[req.params.loanId];
  const loan = seedLoan(req.params.loanId);
  recomputeSchedule(loan);
  res.json(loan);
});

// ======================= ACTION: NSF =====================
app.post("/api/loans/:loanId/actions/nsf", (req, res) => {
  const loan = getLoan(req);
  const { selectedLine, fee } = req.body;

  const row = loan.schedule.find((r) => r.i === Number(selectedLine));
  if (!row) return res.status(400).json({ error: "ligne_invalide" });

  const nsfFee = clamp2(fee ?? loan.config?.defaultNSFFee ?? 48);
  const paymentPlanned = clamp2((row.total || 0) + (row.adjustment || 0));
  const total = clamp2(paymentPlanned + nsfFee);

  // Marque banque NSF (encaissé 0)
  row.status = "NSF";
  row.postedStatus = "NSF";
  row.postedAmount = 0;
  row.postedDate = null;

  // Crée souffrance OPEN
  const arrearsId = "A" + Date.now();
  loan.arrearsItems.push({
    id: arrearsId,
    type: "NSF",
    sourceLine: row.i,
    amount: paymentPlanned,
    fee: nsfFee,
    total,
    status: "OPEN",
    createdAt: nowIso(),
  });

  loan.events.push({
    ts: nowIso(),
    title: "NSF",
    txt: `Paiement #${row.i} NSF. Souffrance: rejet ${paymentPlanned}$ + frais ${nsfFee}$ = ${total}$.`,
  });

  recomputeSchedule(loan);
  res.json({ arrearsId, loan });
});

// ======================= ACTION: POST (PAYÉ / PARTIEL) ===
// payload: { lineId, amount, postedDate?, applyToArrearsFirst? }
app.post("/api/loans/:loanId/actions/post", (req, res) => {
  const loan = getLoan(req);
  const { lineId, amount, postedDate, applyToArrearsFirst } = req.body;

  const row = loan.schedule.find(r => r.i === Number(lineId));
  if(!row) return res.status(400).json({ error:"ligne_invalide" });

  const amt = clamp2(amount);
  if(amt <= 0) return res.status(400).json({ error:"montant_invalide" });

  // met à jour config si override
  if (typeof applyToArrearsFirst === "boolean") {
    loan.config.payArrearsFirst = applyToArrearsFirst;
  }

  // Marque encaissé
  row.postedStatus = (amt < clamp2((row.total||0)+(row.adjustment||0))) ? "PARTIAL" : "POSTED";
  row.postedAmount = amt;
  row.postedDate = postedDate || row.date;
  row.status = (row.postedStatus === "PARTIAL") ? "Partiel" : "Payé";
  row.paid = true;

  // Allocation réelle + ledger
  recomputeSchedule(loan);

  const alloc = row.allocation || {toArrears:0,toAdhesion:0,toInterest:0,toPrincipal:0};

  // Appliquer à souffrance FIFO si payArrearsFirst ON
  let closeInfo = { closed: 0, leftover: 0 };
  if ((loan.config.payArrearsFirst ?? true) && alloc.toArrears > 0) {
    closeInfo = closeArrearsFIFO(loan, alloc.toArrears);
  }

  loan.ledger.push({
    ts: nowIso(),
    line: row.i,
    type: "POST",
    postedDate: row.postedDate,
    amount: amt,
    split: {
      arrears: alloc.toArrears,
      adhesion: alloc.toAdhesion,
      interest: alloc.toInterest,
      principal: alloc.toPrincipal
    }
  });

  loan.events.push({
    ts: nowIso(),
    title: "Encaissement",
    txt: `Paiement #${row.i} encaissé ${amt}$ (${row.postedStatus}). Split: souffrance ${alloc.toArrears}$, adhésion ${alloc.toAdhesion}$, intérêt ${alloc.toInterest}$, capital ${alloc.toPrincipal}$. Souffrances fermées: ${closeInfo.closed}.`
  });

  recomputeSchedule(loan);
  res.json({ ok:true, loan });
});

// ======================= ACTION: RETRY NSF = reprise =====
// payload: { lineId, newDate }
app.post("/api/loans/:loanId/actions/retry", (req, res) => {
  const loan = getLoan(req);
  const { lineId, newDate } = req.body;

  const row = loan.schedule.find(r => r.i === Number(lineId));
  if(!row) return res.status(400).json({ error:"ligne_invalide" });

  if(row.postedStatus !== "NSF" && row.status !== "NSF"){
    return res.status(400).json({ error:"ligne_pas_nsf" });
  }

  // Margill-like: on "replanifie" la date (la banque réessaie)
  row.date = newDate || row.date;
  row.status = "À venir";
  row.paid = false;
  row.postedStatus = "NONE";
  row.postedAmount = 0;
  row.postedDate = null;

  loan.events.push({
    ts: nowIso(),
    title: "Reprise bancaire",
    txt: `Paiement #${row.i} repris / replanifié au ${row.date}.`
  });

  recomputeSchedule(loan);
  res.json({ ok:true, loan });
});

// ======================= START ===========================
app.listen(PORT, () => {
  console.log(`✅ Backend prêt sur http://localhost:${PORT}`);
});
