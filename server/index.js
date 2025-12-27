// =======================================================
// server/index.js
// Backend Express - Prêteur privé (démo fonctionnelle)
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
const clamp2 = (n) => Math.round((Number(n || 0)) * 100) / 100;
const nowIso = () => new Date().toISOString();

// =======================================================
// DB mémoire (démo)
// =======================================================
const db = {
  loans: {}
};

// =======================================================
// Seed d’un dossier
// =======================================================
function seedLoan(loanId = "demo") {
  if (db.loans[loanId]) return db.loans[loanId];

  const schedule = [
    { i: 1, date: "2024-11-15", total: 147.92, interest: 9.62, adhesion: 45, balance: 2156.7 },
    { i: 2, date: "2024-11-29", total: 147.19, interest: 16.15, adhesion: 45, balance: 2070.66 },
    { i: 3, date: "2024-12-13", total: 146.56, interest: 15.51, adhesion: 45, balance: 1984.61 },
    { i: 4, date: "2024-12-27", total: 145.94, interest: 14.87, adhesion: 45, balance: 1898.54 }
  ];

  db.loans[loanId] = {
    loanId,
    schedule: schedule.map(r => ({
      ...r,
      adjustment: 0,
      status: "À venir",
      paid: false,
      method: "PAD"
    })),
    arrearsItems: [],
    events: [
      { ts: nowIso(), title: "Dossier chargé", txt: "Backend initialisé" }
    ]
  };

  return db.loans[loanId];
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
  res.json(getLoan(req));
});

// Reset dossier
app.post("/api/loans/:loanId/reset", (req, res) => {
  delete db.loans[req.params.loanId];
  res.json(seedLoan(req.params.loanId));
});

// =======================================================
// ACTION: NSF → crée une souffrance automatique
// =======================================================
app.post("/api/loans/:loanId/actions/nsf", (req, res) => {
  const loan = getLoan(req);
  const { selectedLine, fee } = req.body;

  const row = loan.schedule.find(r => r.i === Number(selectedLine));
  if (!row) return res.status(400).json({ error: "ligne_invalide" });

  const nsfFee = clamp2(fee ?? 48);
  const payment = clamp2((row.total || 0) + (row.adjustment || 0));
  const total = clamp2(payment + nsfFee);

  row.status = "NSF";

  const arrearsId = "A" + Date.now();
  loan.arrearsItems.push({
    id: arrearsId,
    type: "NSF",
    sourceLine: row.i,
    amount: payment,
    fee: nsfFee,
    total,
    status: "OPEN",
    createdAt: nowIso()
  });

  loan.events.push({
    ts: nowIso(),
    title: "NSF",
    txt: `Paiement #${row.i} NSF. Souffrance ${payment}$ + ${nsfFee}$ = ${total}$.`
  });

  res.json({ arrearsId, loan });
});

// =======================================================
// ACTION: Traiter / déplacer la souffrance
// (mêmes options que reporter)
// =======================================================
app.post("/api/loans/:loanId/actions/arrears/resolve", (req, res) => {
  const loan = getLoan(req);
  const { arrearsId, amount, targetIds, newDate } = req.body;

  const item = loan.arrearsItems.find(a => a.id === arrearsId && a.status === "OPEN");
  if (!item) return res.status(404).json({ error: "souffrance_introuvable" });

  const amt = clamp2(amount ?? item.total);
  if (amt <= 0) return res.status(400).json({ error: "montant_invalide" });

  // ---- Cas 1 : Nouvelle ligne (VIREMENT)
  if (newDate) {
    const maxI = Math.max(...loan.schedule.map(r => r.i));
    loan.schedule.push({
      i: maxI + 1,
      date: newDate
