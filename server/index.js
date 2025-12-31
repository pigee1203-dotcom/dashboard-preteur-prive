// =======================================================
// server/index.js
// Backend Express - Prêteur privé (demo fonctionnelle)
// + Recompute schedule (style Margill): intérêt journalier sur solde avant paiement
// =======================================================

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 8080;

app.use(cors({ origin: true }));
app.use(express.json());

// =======================================================
// Utils
// =======================================================
const clamp2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const nowIso = () => new Date().toISOString();

function toDateOnly(iso) {
  // iso: "YYYY-MM-DD"
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function daysBetween(d1Iso, d2Iso) {
  // d2 - d1 in days
  const a = toDateOnly(d1Iso);
  const b = toDateOnly(d2Iso);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}
function sortSchedule(schedule) {
  return [...schedule].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.i || 0) - (b.i || 0));
}

// =======================================================
// DB mémoire (démo)
// =======================================================
const db = {
  loans: {},
};

// =======================================================
// MOTEUR: recalcul intérêt/capital/solde (style Margill)
// - intérêt journalier ACT/365 sur SOLDE AVANT paiement
// - frais adhesion ne portent pas intérêt
// - adjustment = supplément ajouté à une ligne (souffrance/report)
// - si ligne est NSF: on considère paiement encaissé = 0 (par défaut)
//   (tu peux changer via config.nsfCountsAsPaid)
// =======================================================
function recomputeSchedule(loan) {
  const cfg = loan.config || {};
  const annualRate = Number(cfg.annualRate ?? 0.1899); // 18.99% = 0.1899
  const dayBase = Number(cfg.dayBase ?? 365); // ACT/365
  const startBalance = clamp2(cfg.startBalance ?? 2250.0); // solde de départ du contrat
  const contractStartDate = cfg.contractStartDate || (loan.schedule?.[0]?.date ?? "2024-11-15");

  // comportement NSF:
  // - false (par défaut) : paiement encaissé = 0 quand status === "NSF"
  // - true : on laisse la ligne normale (rare en pratique)
  const nsfCountsAsPaid = Boolean(cfg.nsfCountsAsPaid ?? false);

  const ordered = sortSchedule(loan.schedule);

  let prevDate = contractStartDate;
  let prevBalance = startBalance;

  for (const row of ordered) {
    // jours écoulés
    const d = daysBetween(prevDate, row.date);
    row.days = d;

    // paiement encaissé (total + adjustment), SAUF NSF si nsfCountsAsPaid === false
    const scheduledToCollect = clamp2((row.total || 0) + (row.adjustment || 0));
    const collected = (row.status === "NSF" && !nsfCountsAsPaid) ? 0 : scheduledToCollect;

    // frais adhesion (ne portent pas intérêt)
    const adhesion = clamp2(row.adhesion || 0);

    // part "prêt" (ce qui sert à intérêts + capital)
    const loanPart = clamp2(Math.max(0, collected - adhesion));

    // intérêt période sur solde AVANT paiement
    const interest = clamp2(prevBalance * annualRate * (d / dayBase));

    // capital payé = loanPart - interest (ne peut pas être négatif)
    // (si loanPart < interest, capital=0 et tu auras un "déficit" dans la réalité;
    //  ici on laisse capital=0 pour éviter solde qui augmente; la souffrance gère le reste)
    const capital = clamp2(Math.max(0, loanPart - interest));

    // solde après
    const balanceAfter = clamp2(Math.max(0, prevBalance - capital));

    // écrire sur la ligne
    row.interest = interest;
    row.capital = capital; // (champ utile, même si ton UI ne l’affiche pas)
    row.collected = collected; // info debug/audit
    row.loanPart = loanPart; // info debug/audit
    row.balanceBefore = clamp2(prevBalance);
    row.balance = balanceAfter;

    // next
    prevBalance = balanceAfter;
    prevDate = row.date;
  }

  // réinjecter dans loan.schedule (conserver ordre original par i)
  // (on modifie déjà les objets de base, donc rien à faire)
  loan._computedAt = nowIso();
}

// =======================================================
// Seed d’un dossier
// =======================================================
function seedLoan(loanId = "demo") {
  if (db.loans[loanId]) return db.loans[loanId];

  // NOTE: ici tes totaux originaux sont conservés,
  // mais le moteur va recalculer interest/balance à partir de config + dates + paiements.
  const schedule = [
    { i: 1, date: "2024-11-15", total: 147.92, interest: 9.62, adhesion: 45, balance: 2156.7 },
    { i: 2, date: "2024-11-29", total: 147.19, interest: 16.15, adhesion: 45, balance: 2070.66 },
    { i: 3, date: "2024-12-13", total: 146.56, interest: 15.51, adhesion: 45, balance: 1984.61 },
    { i: 4, date: "2024-12-27", total: 145.94, interest: 14.87, adhesion: 45, balance: 1898.54 },
  ];

  const loan = {
    loanId,

    // ✅ CONFIG “contrat” (c’est ICI que tu contrôles le calcul)
    config: {
      contractStartDate: "2024-10-31", // date d’origine (utilisée pour calculer jours jusqu’au 1er paiement)
      startBalance: 2250.0,            // montant financé (ex: prêt + frais ouverture financés)
      annualRate: 0.1899,              // 18.99%
      dayBase: 365,                    // ACT/365
      nsfCountsAsPaid: false,          // NSF = paiement encaissé 0 (recommandé)
    },

    schedule: schedule.map((r) => ({
      ...r,
      adjustment: 0,
      status: "À venir",
      paid: false,
      method: "PAD",
    })),
    arrearsItems: [],
    events: [{ ts: nowIso(), title: "Dossier chargé", txt: "Backend initialisé" }],
  };

  // ✅ Calcul initial
  recomputeSchedule(loan);

  db.loans[loanId] = loan;
  return loan;
}

function getLoan(req) {
  const loanId = req.params.loanId || "demo";
  return db.loans[loanId] || seedLoan(loanId);
}

// =======================================================
// ROUTES
// =======================================================

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: nowIso() });
});

// Charger un dossier
app.get("/api/loans/:loanId", (req, res) => {
  const loan = getLoan(req);
  recomputeSchedule(loan);
  res.json(loan);
});

// Reset dossier
app.post("/api/loans/:loanId/reset", (req, res) => {
  delete db.loans[req.params.loanId];
  const loan = seedLoan(req.params.loanId);
  recomputeSchedule(loan);
  res.json(loan);
});

// =======================================================
// ACTION: NSF → crée une souffrance automatique
// =======================================================
app.post("/api/loans/:loanId/actions/nsf", (req, res) => {
  const loan = getLoan(req);
  const { selectedLine, fee } = req.body;

  const row = loan.schedule.find((r) => r.i === Number(selectedLine));
  if (!row) return res.status(400).json({ error: "ligne_invalide" });

  const nsfFee = clamp2(fee ?? 48);

  // montant "prévu" (ligne) = total + adjustment
  const paymentPlanned = clamp2((row.total || 0) + (row.adjustment || 0));

  // souffrance = paiement prévu + frais NSF
  const total = clamp2(paymentPlanned + nsfFee);

  // marquer la ligne
  row.status = "NSF";
  row.paid = false;

  const arrearsId = "A" + Date.now();
  loan.arrearsItems.push({
    id: arrearsId,
    type: "NSF",
    sourceLine: row.i,
    amount: paymentPlanned, // paiement rejeté
    fee: nsfFee,
    total,
    status: "OPEN",
    createdAt: nowIso(),
  });

  loan.events.push({
    ts: nowIso(),
    title: "NSF",
    txt: `Paiement #${row.i} NSF. Souffrance ${paymentPlanned}$ + ${nsfFee}$ = ${total}$.`,
  });

  // ✅ recalcul des intérêts/solde (NSF = encaissé 0 si config.nsfCountsAsPaid=false)
  recomputeSchedule(loan);

  res.json({ arrearsId, loan });
});

// =======================================================
// ACTION: Traiter / déplacer la souffrance
// - En pratique: on "place la souffrance à payer" en l'ajoutant dans adjustment de ligne(s)
// - NEW: créer une ligne VIREMENT
// =======================================================
app.post("/api/loans/:loanId/actions/arrears/resolve", (req, res) => {
  const loan = getLoan(req);
  const { arrearsId, amount, targetIds, newDate } = req.body;

  const item = loan.arrearsItems.find((a) => a.id === arrearsId && a.status === "OPEN");
  if (!item) return res.status(404).json({ error: "souffrance_introuvable" });

  const amt = clamp2(amount ?? item.total);
  if (amt <= 0) return res.status(400).json({ error: "montant_invalide" });

  // ---- Cas 1 : Nouvelle ligne (VIREMENT)
  if (newDate) {
    const maxI = Math.max(...loan.schedule.map((r) => r.i));
    loan.schedule.push({
      i: maxI + 1,
      date: newDate,
      total: amt,
      interest: 0,
      adhesion: 0,
      balance: 0,
      adjustment: 0,
      status: "À venir",
      paid: false,
      method: "VIREMENT",
    });

    item.status = "RESOLVED";
    loan.events.push({
      ts: nowIso(),
      title: "Souffrance (VIREMENT)",
      txt: `Souffrance ${amt}$ déplacée en nouvelle ligne VIREMENT (${newDate}).`,
    });

    recomputeSchedule(loan);
    return res.json({ ok: true, loan });
  }

  // ---- Cas 2 : Répartir sur lignes existantes (PAD)
  const ids = Array.isArray(targetIds) ? targetIds.map(Number) : [];
  const targets = loan.schedule.filter((r) => ids.includes(r.i));
  if (!targets.length) return res.status(400).json({ error: "cibles_invalides" });

  const per = clamp2(amt / targets.length);
  targets.forEach((t) => {
    t.adjustment = clamp2((t.adjustment || 0) + per);
  });

  item.status = "RESOLVED";
  loan.events.push({
    ts: nowIso(),
    title: "Souffrance (répartie)",
    txt: `Souffrance ${amt}$ répartie sur ${targets.length} paiement(s): +${per}$ chacun.`,
  });

  // ✅ recalcul après modifications
  recomputeSchedule(loan);

  res.json({ ok: true, loan });
});

// =======================================================
// ACTION: Reporter (démo simple) — même logique que ton UI
// (Ici: tu peux brancher ton front plus tard, on conserve)
// =======================================================
app.post("/api/loans/:loanId/actions/report", (req, res) => {
  const loan = getLoan(req);
  const { selectedLine, amount, targetIds } = req.body;

  const src = loan.schedule.find((r) => r.i === Number(selectedLine));
  if (!src) return res.status(400).json({ error: "ligne_invalide" });

  const amt = clamp2(amount ?? ((src.total || 0) + (src.adjustment || 0)));
  if (amt <= 0) return res.status(400).json({ error: "montant_invalide" });

  // source devient "frais report" (exemple comme ton UI)
  const fee = 25;
  src.status = "Frais report";
  src.method = "PAD";
  src.total = fee;
  src.adjustment = 0;
  src.adhesion = 0;

  // répartir le montant
  const ids = Array.isArray(targetIds) ? targetIds.map(Number) : [];
  const targets = loan.schedule.filter((r) => ids.includes(r.i));
  if (!targets.length) return res.status(400).json({ error: "cibles_invalides" });

  const per = clamp2(amt / targets.length);
  targets.forEach((t) => (t.adjustment = clamp2((t.adjustment || 0) + per)));

  loan.events.push({
    ts: nowIso(),
    title: "Report",
    txt: `Report ${amt}$ réparti sur ${targets.length} paiement(s): +${per}$ chacun.`,
  });

  recomputeSchedule(loan);
  res.json({ ok: true, loan });
});

// =======================================================
// Start
// =======================================================
app.listen(PORT, () => {
  console.log(`✅ Backend prêt sur http://localhost:${PORT}`);
});
