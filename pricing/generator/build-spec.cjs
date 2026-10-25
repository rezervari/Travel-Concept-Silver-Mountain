"use strict";
// Generează specificația (JSON) a Excelului de prețuri; apply-spec.ps1 o aplică prin Excel COM (vezi README.md).
// Datele se iau din fișierul existent: perioadele din „Perioade” (sau din „Sezoane”, formatul de dinainte de 25.10.2026),
// valorile din celulele galbene din „Setări”, „Simulator”, „Calendar”, „Checklist”, iar foaia „Date actuale” se copiază.
// Rulare: node build-spec.cjs <xlsx existent> <spec.json>   (NODE_PATH = node_modules din repo)
const fs = require("fs");
const XLSX = require("xlsx");

const OLD = process.argv[2], OUT = process.argv[3];
const old = XLSX.readFile(OLD, { cellFormula: true });

const ops = [];
const set = (s, r, v) => ops.push({ op: "set", s, r, v });
// Celulă de intrare: păstrează valoarea din fișierul existent (dacă foaia există și celula are o valoare, nu o formulă).
const oldCell = (s, r) => (old.Sheets[s] ? old.Sheets[s][r] : undefined);
const inp = (s, r, v) => { const c = oldCell(s, r); set(s, r, c && !c.f && c.v !== undefined && c.v !== "" ? c.v : v); };
const f = (s, r, fx) => ops.push({ op: "f", s, r, f: fx });
const fmt = (s, r, o) => ops.push(Object.assign({ op: "fmt", s, r }, o));
const width = (s, cols, w) => ops.push({ op: "width", s, cols, w });
const height = (s, row, h) => ops.push({ op: "height", s, row, h });
const merge = (s, r) => ops.push({ op: "merge", s, r });
const name = (n, ref) => ops.push({ op: "name", n, ref });
const cf = (s, r, o) => ops.push(Object.assign({ op: "cf", s, r }, o));

function col(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function idx(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

const BLUE = "#003680", INPUT = { fill: "#FFF2CC", color: "#0000FF" }, CALC = { fill: "#EAF3FC", color: "#000000" };
const HEAD = { fill: BLUE, color: "#FFFFFF", bold: true, wrap: true, h: "center", v: "center", border: true };
const TITLE = { size: 14, bold: true, color: BLUE }, NOTE = { color: "#555555" }, SECTION = { size: 11, bold: true, color: BLUE };
const LEI = '#,##0" lei";-#,##0" lei";-', PCT = "0%", PCT1 = "0.0%", DATE = "dd.mm.yyyy";
const RED = { fill: "#F8CBAD", color: "#9C0006" }, GREEN = { fill: "#C6EFCE", color: "#006100" };
const R0 = 6, R1 = 40; // rândurile perioadelor (35)
const rows = (a, b) => `${a}${R0}:${b || a}${R1}`;

const SHEETS = ["Ghid", "Setări", "Perioade", "Prețuri de setat", "Verificare sejururi", "Simulator", "Calendar", "Checklist", "Verificare", "Calcule", "Export site"];
ops.push({ op: "sheets", names: SHEETS });
ops.push({ op: "copySheet", name: "Date actuale", after: "Checklist" });

/* ============================== SETĂRI ============================== */
const ST = "Setări";
set(ST, "A1", "Setări – comisioane, TVA, taxe, reduceri"); fmt(ST, "A1", TITLE);
set(ST, "A2", "Se modifică rar. Celulele galbene se pot schimba; prețurile pentru platforme se recalculează singure în „Prețuri de setat”."); fmt(ST, "A2", NOTE);

set(ST, "A4", "Taxe și TVA"); fmt(ST, "A4", SECTION);
const st = [
  [5, "Cota TVA pentru cazare", 0.11, PCT, "Cota redusă pentru cazare din 01.08.2025 (Legea 141/2025), menținută în 2026. Platformele iau comisionul pe prețul cu TVA, dar TVA-ul îl plătești tu → intră în calcul. Dacă se schimbă cota, schimbi doar aici."],
  [6, "Taxă turistică / adult / noapte", 7, LEI, "Incluse în preț, doar pentru adulți (ca pe site: TAX_TOURIST)."],
  [7, "Taxă Salvamont / adult / noapte", 5, LEI, "Inclusă în preț (TAX_SALVAMONT)."],
  [8, "Adulți luați în calcul (ocupare tipică)", 4, "0", "Taxele locale pe noapte se calculează pentru acest număr de adulți."],
];
st.forEach(([r, label, v, nf, ex]) => { set(ST, "A" + r, label); inp(ST, "B" + r, v); fmt(ST, "B" + r, Object.assign({ nf }, INPUT)); set(ST, "H" + r, ex); });
set(ST, "A9", "Taxe locale / noapte (calculat)"); f(ST, "B9", "=(B6+B7)*B8"); fmt(ST, "B9", Object.assign({ nf: LEI }, CALC));

set(ST, "A11", "Strategie"); fmt(ST, "A11", SECTION);
[
  [12, "Avantaj site: câștigul pe site mai mare decât pe platforme cu", 0.05, PCT, "Câștigul țintă pe fiecare platformă = câștigul real de pe site ÷ (1 + acest procent). 0% = câștig egal peste tot."],
  [13, "Verificare: roșu sub (% din câștigul țintă)", 0.97, PCT, "Pragul folosit în „Prețuri de setat” și „Verificare sejururi”."],
  [14, "Supliment tarif flexibil pe site", 0.10, PCT, "Doar pentru „Simulator”. Pe site e constanta FLEX_MARKUP_PCT din script.js și rezervari.gs."],
].forEach(([r, label, v, nf, ex]) => { set(ST, "A" + r, label); inp(ST, "B" + r, v); fmt(ST, "B" + r, Object.assign({ nf }, INPUT)); set(ST, "H" + r, ex); });

set(ST, "A16", "Scara standard de reduceri pe durată (perioadele „Standard”)"); fmt(ST, "A16", SECTION);
set(ST, "A17", "Nopți"); ["2 nopți", "3 nopți", "4 nopți", "5 nopți", "6 nopți", "7+ nopți"].forEach((t, i) => set(ST, col(2 + i) + "17", t)); fmt(ST, "A17:G17", HEAD);
set(ST, "A18", "Scara standard"); [0.10, 0.12, 0.15, 0.20, 0.25, 0.33].forEach((v, i) => inp(ST, col(2 + i) + "18", v)); fmt(ST, "B18:G18", Object.assign({ nf: PCT, border: true, h: "center" }, INPUT));
set(ST, "H18", "Se aplică pe site, pe Booking (planurile „2 zile” … „7 zile”), pe Travelminit („Reducere generală”) și pe Airbnb („Trip length” 2–6 nopți). Dacă o schimbi aici, o schimbi și pe platforme (vezi „Checklist”).");

set(ST, "A20", "Platforme"); fmt(ST, "A20", SECTION);
["Setare", "Site direct", "Booking.com", "Airbnb", "Travelminit"].forEach((t, i) => set(ST, col(1 + i) + "21", t)); set(ST, "H21", "Sursă / explicație");
fmt(ST, "A21:E21", HEAD); fmt(ST, "H21", HEAD);
const plat = [
  // rând, etichetă, site, booking, airbnb, travelminit, format, explicație, nume
  [22, "Comision platformă", "—", 0.15, 0.155, 0.12, PCT1, "Booking 15% (verificat la ban pe 3 rezervări reale). Airbnb: taxă unică 15,5% (obligatorie în UE din 13.10.2026; editorul Airbnb: 1.480 lei → câștigi 1.251 lei). Travelminit: comision standard 12% + TVA (TCG 21.01.2026, art. 61).", "Com"],
  [23, "Supliment de comision (ex. rezervări „la cerere”, poziție mai bună)", "—", 0, 0, 0, PCT1, "Travelminit: +2% la rezervările „la cerere”; poți urca singur comisionul ca să urci în listă (art. 64). Booking: „Preferred” ≈ +3%.", "Supl"],
  [24, "Comisionul se ia fără taxele locale? (1=da, 0=nu)", "—", 1, 0, 0, "0", "Booking scade taxa turistică + Salvamont din suma comisionabilă (ex. 3.969 lei total → 3.633 lei comisionabil). Airbnb și Travelminit iau comision pe tot, fiindcă taxele sunt incluse în preț.", "Excl"],
  [25, "Cost procesare plată (% din totalul plătit de oaspete)", 0, 0.013, 0, 0, PCT1, "Booking: 1,3% din total (Plăți prin Booking.com) — 15% × 3.633 + 1,3% × 3.969 = 596,55 lei, exact suma reținută. Site: 0 la transfer bancar (pune % dacă încasezi cu cardul). Travelminit: încasezi tu, fără cost.", "Plata"],
  [26, "TVA nerecuperabil pe comision", "—", 0, 0, 0, PCT, "0 când firma are codul de TVA trecut în cont (taxare inversă la Booking/Airbnb, TVA deductibil la Travelminit). Airbnb: pune 21% dacă în cont NU e trecut codul de TVA RO15288158.", "TVAc"],
  [27, "Reducere automată a platformei (mobil / Genius)", "—", 0.10, 0, 0, PCT, "Booking: „Mobile rate 10%” activ din 07.06.2026; Genius neactiv. Dacă pornești și Genius 10%, pune reducerea combinată: 1 − 0,9 × 0,9 = 19%.", "Auto"],
  [28, "Ponderea oaspeților care primesc reducerea automată", "—", 1, 1, 1, PCT, "100% = prețul e ridicat ca și oaspetele de pe telefon să-ți lase câștigul țintă (cei de pe calculator plătesc mai mult). 70% = compensare pe medie.", "Pond"],
  [29, "Aplică reducerile pe durată din „Perioade”? (1=da, 0=nu)", "da", 1, 1, 1, "0", "Booking: planurile derivate „2 zile” … „7 zile”; Travelminit: „Reducere generală” pe intervalele perioadelor; Airbnb: „Trip length” 2–6 nopți + săptămânal/lunar, GLOBALE (se aplică pe tot anul, și la perioadele cu preț fix).", "Durata"],
  [30, "Rotunjire în sus la (lei)", "—", 10, 10, 10, LEI, "Prețurile calculate se rotunjesc în sus la multiplu de 10 lei.", "Rot"],
];
plat.forEach(([r, label, s, b, a, m, nf, ex, key]) => {
  set(ST, "A" + r, label); inp(ST, "B" + r, s); inp(ST, "C" + r, b); inp(ST, "D" + r, a); inp(ST, "E" + r, m); set(ST, "H" + r, ex);
  fmt(ST, `C${r}:E${r}`, Object.assign({ nf, h: "center" }, INPUT));
  if (typeof s === "number") fmt(ST, "B" + r, Object.assign({ nf, h: "center" }, INPUT)); else fmt(ST, "B" + r, { color: "#808080", h: "center" });
  name("b_" + key, `='Setări'!$C$${r}`); name("a_" + key, `='Setări'!$D$${r}`); name("m_" + key, `='Setări'!$E$${r}`);
});
name("s_Plata", "='Setări'!$B$25");
fmt(ST, "A21:E30", { border: true });

set(ST, "A32", "Airbnb – reduceri globale"); fmt(ST, "A32", SECTION);
set(ST, "A33", "Reduceri „Trip length” 2–6 nopți"); set(ST, "B33", "ca scara standard"); fmt(ST, "B33", { color: "#808080" });
set(ST, "H33", "Airbnb → Calendar → Settings → Discounts → Trip length: aceleași procente ca scara standard (2–6 nopți).");
[
  [34, "Reducere săptămânală (7+ nopți)", null, PCT, "Implicit = treapta 7+ din scara standard, dar cel mult reducerea lunară − 1% (Airbnb cere săptămânal < lunar): azi 32%. Poți scrie peste formulă un procent fix.", "a_Sapt"],
  [35, "Reducere lunară (28+ nopți)", 0.33, PCT, "", "a_Luna"],
  [36, "Pondere sugestie Airbnb (0% = câștig țintă, 100% = exact sugestia)", 0.30, PCT, "Se aplică doar perioadelor cu sugestie completată în „Perioade” (coloana O).", "a_PondSug"],
  [37, "Câștig minim pe Airbnb când urmezi sugestia (% din câștigul de pe site)", 0.85, PCT, "Plasă de siguranță: prețul Airbnb nu coboară sub nivelul la care ai câștiga mai puțin de atât.", "a_MinNet"],
].forEach(([r, label, v, nf, ex, n]) => { set(ST, "A" + r, label); if (v === null && !(oldCell(ST, "B" + r) && !oldCell(ST, "B" + r).f)) f(ST, "B" + r, "=MIN(G18,B35-0.01)"); else inp(ST, "B" + r, v); fmt(ST, "B" + r, Object.assign({ nf, h: "center" }, INPUT)); if (ex) set(ST, "H" + r, ex); name(n, `='Setări'!$B$${r}`); });

set(ST, "A39", "Costuri pe sejur (pentru profit; nu schimbă prețurile)"); fmt(ST, "A39", SECTION);
[
  [40, "Curățenie / sejur", 200, "c_Cur", "Din „Pret apartament.xlsx”. Sunt aceleași pe orice canal, deci nu schimbă prețurile de pe platforme; apar ca profit în „Verificare sejururi” și „Simulator”."],
  [41, "Spălătorie lenjerie / sejur", 70, "c_Spal", ""],
  [42, "Spălătorie la sejururi de 7+ nopți", 140, "c_Spal7", ""],
  [43, "Consumabile / sejur (săpun, hârtie, apă, vin)", 50, "c_Cons", ""],
].forEach(([r, label, v, n, ex]) => { set(ST, "A" + r, label); inp(ST, "B" + r, v); fmt(ST, "B" + r, Object.assign({ nf: LEI, h: "center" }, INPUT)); if (ex) set(ST, "H" + r, ex); name(n, `='Setări'!$B$${r}`); });

set(ST, "J4", "Liste (meniuri)"); fmt(ST, "J4", { bold: true, color: "#808080" });
["Standard", "Preț fix", "Personalizat"].forEach((t, i) => set(ST, "J" + (5 + i), t));
["Flexibil 14 zile", "Nerambursabil", "Flexibil 7 zile", "Moderat"].forEach((t, i) => set(ST, "K" + (5 + i), t));
fmt(ST, "J5:K8", { color: "#808080" });
name("lst_Tip", "='Setări'!$J$5:$J$7"); name("lst_Pol", "='Setări'!$K$5:$K$8");
name("p_TVA", "='Setări'!$B$5"); name("p_TaxaTur", "='Setări'!$B$6"); name("p_TaxaSalv", "='Setări'!$B$7"); name("p_Adulti", "='Setări'!$B$8");
name("p_Taxe", "='Setări'!$B$9"); name("p_Avantaj", "='Setări'!$B$12"); name("p_Prag", "='Setări'!$B$13"); name("s_Flex", "='Setări'!$B$14");
name("p_Std", "='Setări'!$B$18:$G$18");
width(ST, "A", 62); width(ST, "B:E", 13); width(ST, "F:G", 10); width(ST, "H", 95); width(ST, "I", 3); width(ST, "J:K", 16);
fmt(ST, "H5:H43", { wrap: true, v: "top", color: "#404040" }); fmt(ST, "A5:G43", { v: "top" });
ops.push({ op: "tab", s: ST, color: "#FFC000" });
ops.push({ op: "freeze", s: ST, row: 3, col: 0 });
ops.push({ op: "autofit", s: ST, r: "A4:H43" });

/* ============================== PERIOADE ============================== */
const PE = "Perioade";
set(PE, "A1", "Perioade – singurul loc unde scrii prețurile"); fmt(PE, "A1", TITLE);
set(PE, "A2", "Pentru fiecare perioadă: datele, prețul tău pe site / noapte (cu taxele locale incluse, înainte de reduceri), nopțile minime și tipul reducerilor. Prețurile pentru Booking, Airbnb și Travelminit apar în „Prețuri de setat”."); fmt(PE, "A2", NOTE);
set(PE, "A3", "Reduceri: Standard = scara din „Setări” · Preț fix = fără reduceri pe durată (sărbători) · Personalizat = procentele tale în coloanele H–M. Perioadele în ordine cronologică, fără suprapuneri; rânduri libere până la 40."); fmt(PE, "A3", NOTE);
set(PE, "H4", "Reduceri personalizate (doar la „Personalizat”)"); merge(PE, "H4:M4");
set(PE, "Q4", "Reducerea aplicată pe site (calculat)"); merge(PE, "Q4:V4");
fmt(PE, "H4:M4", HEAD); fmt(PE, "Q4:V4", Object.assign({}, HEAD, { fill: "#2F75B5" }));
const peHead = ["ID perioadă", "Denumire", "Data început", "Data sfârșit", "Preț site / noapte", "Nopți minime", "Reduceri", "2 nopți", "3 nopți", "4 nopți", "5 nopți", "6 nopți", "7+ nopți", "Politică anulare (platforme)", "Sugestie Airbnb (opțional)", "Observații", "2 nopți", "3 nopți", "4 nopți", "5 nopți", "6 nopți", "7+ nopți", "Stare"];
peHead.forEach((t, i) => set(PE, col(1 + i) + "5", t)); fmt(PE, "A5:W5", HEAD); fmt(PE, "Q5:W5", { fill: "#2F75B5" }); height(PE, 5, 58);
fmt(PE, rows("A", "P"), Object.assign({ border: true }, INPUT));
fmt(PE, rows("C", "D"), { nf: DATE, h: "center" }); fmt(PE, rows("E"), { nf: LEI }); fmt(PE, rows("F", "G"), { h: "center" });
fmt(PE, rows("H", "M"), { nf: PCT, h: "center" }); fmt(PE, rows("O"), { nf: LEI });
ops.push({ op: "valid", s: PE, r: rows("G"), list: "=lst_Tip" });
ops.push({ op: "valid", s: PE, r: rows("N"), list: "=lst_Pol" });
cf(PE, rows("H", "M"), { type: "expr", f1: '=$G6<>"Personalizat"', fill: "#EDEDED", color: "#A6A6A6" });
f(PE, rows("Q", "V"), '=IF(Calcule!$A6="","",Calcule!J6)'); fmt(PE, rows("Q", "V"), Object.assign({ nf: PCT, h: "center", border: true }, CALC));
f(PE, rows("W"), '=IF($A6="","",Verificare!$H6)'); fmt(PE, rows("W"), Object.assign({ border: true }, CALC));
cf(PE, rows("W"), { type: "text", text: "⚠", color: "#C00000", bold: true });
width(PE, "A", 22); width(PE, "B", 16); width(PE, "C:D", 12); width(PE, "E", 13); width(PE, "F", 9); width(PE, "G", 14); width(PE, "H:M", 8);
width(PE, "N", 17); width(PE, "O", 13); width(PE, "P", 34); width(PE, "Q:V", 8); width(PE, "W", 28);
ops.push({ op: "tab", s: PE, color: "#FFC000" });
ops.push({ op: "freeze", s: PE, row: 5, col: 2 });

// perioadele: din „Perioade” (format nou) sau din „Sezoane” (format vechi, tipul reducerilor dedus din procente)
const STD = [0.10, 0.12, 0.15, 0.20, 0.25, 0.33];
const periods = [];
if (old.Sheets["Perioade"]) {
  const pr = XLSX.utils.sheet_to_json(old.Sheets["Perioade"], { header: 1, raw: true, defval: null });
  for (let r = R0; r <= R1; r++) {
    const row = pr[r - 1] || [];
    if (row[0] == null || String(row[0]).trim() === "") continue;
    const disc = row.slice(7, 13).map(v => (v === null || v === "" ? null : Number(v)));
    periods.push({ r, id: row[0], label: row[1], start: row[2], end: row[3], price: row[4], minN: row[5], type: row[6] || "Standard", disc, pol: row[13], obs: row[15], sug: row[14] });
  }
}
const sez = old.Sheets["Perioade"] ? [] : XLSX.utils.sheet_to_json(old.Sheets["Sezoane"], { header: 1, raw: true, defval: null });
for (let r = R0; r <= R1 && !old.Sheets["Perioade"]; r++) {
  const row = sez[r - 1] || [];
  if (row[0] == null || String(row[0]).trim() === "") continue;
  const disc = row.slice(6, 12).map(v => (v === null || v === "" || v === "-") ? null : Number(v));
  const minN = Number(row[5]);
  const relevant = disc.map((v, i) => (i + 2 >= minN ? v : null));
  let type;
  if (relevant.every(v => v === null || v === 0)) type = "Preț fix";
  else if (relevant.every((v, i) => i + 2 < minN || Math.abs((v || 0) - STD[i]) < 1e-6)) type = "Standard";
  else type = "Personalizat";
  periods.push({ r, id: row[0], label: row[1], start: row[2], end: row[3], price: row[4], minN, type, disc: relevant, pol: row[12], obs: row[13], sug: row[14] });
}
periods.forEach(p => {
  set(PE, "A" + p.r, p.id); set(PE, "B" + p.r, p.label); set(PE, "C" + p.r, p.start); set(PE, "D" + p.r, p.end); set(PE, "E" + p.r, p.price);
  set(PE, "F" + p.r, p.minN); set(PE, "G" + p.r, p.type);
  if (p.type === "Personalizat" || old.Sheets["Perioade"]) p.disc.forEach((v, i) => { if (v !== null) set(PE, col(8 + i) + p.r, v); });
  if (p.pol) set(PE, "N" + p.r, p.pol); if (p.sug) set(PE, "O" + p.r, p.sug); if (p.obs) set(PE, "P" + p.r, p.obs);
});

/* ============================== CALCULE (intern) ============================== */
const CA = "Calcule";
set(CA, "A1", "Calcule (intern) – pașii calculului, rând cu rând ca în „Perioade”. Nu scrie aici."); fmt(CA, "A1", TITLE);
const caCols = {}; let ci = 0;
const caDef = [];
function cdef(key, head, fx, nf) { ci++; caCols[key] = col(ci); caDef.push({ key, head, fx, nf, c: col(ci) }); }
const C = k => caCols[k];
cdef("id", "ID perioadă", () => '=IF(Perioade!$A6="","",Perioade!$A6)');
cdef("tip", "Reduceri (tip)", () => '=IF($A6="","",IF(OR(Perioade!$G6="Preț fix",Perioade!$G6="Personalizat"),Perioade!$G6,"Standard"))');
cdef("minN", "Nopți minime", () => '=IF($A6="","",N(Perioade!$F6))', "0");
for (let n = 2; n <= 7; n++) {
  const pc = col(8 + n - 2); // Perioade H..M
  cdef("thr" + n, `Prag ${n === 7 ? "7+" : n} nopți`, () => `=IF($A6="","",IF(${n}<$C6,"",IF($B6="Preț fix",IF(${n}=$C6,0,""),IF($B6="Standard",INDEX(p_Std,1,${n - 1}),IF(Perioade!$${pc}6="",IF(${n}=$C6,0,""),N(Perioade!$${pc}6))))))`, PCT);
}
for (let n = 2; n <= 7; n++) {
  cdef("eff" + n, `Reducere la ${n === 7 ? "7+" : n} nopți`, () => n === 2
    ? `=IF(OR($A6="",2<$C6),"",IF(${C("thr2")}6<>"",${C("thr2")}6,0))`
    : `=IF(OR($A6="",${n}<$C6),"",IF(${C("thr" + n)}6<>"",${C("thr" + n)}6,${C("eff" + (n - 1))}6))`, PCT);
}
cdef("has", "Are reduceri (1/0)", () => `=IF($A6="","",IF(MAX(${C("thr2")}6:${C("thr7")}6)>0,1,0))`, "0");
cdef("dS", "Reducere la sejurul minim", () => `=IF($A6="","",INDEX(${C("eff2")}6:${C("eff7")}6,1,MAX(2,MIN($C6,7))-1))`, PCT);
cdef("S", "Preț site / noapte", () => '=IF($A6="","",N(Perioade!$E6))', LEI);
cdef("Gs", "Site: plătește oaspetele / noapte (sejur minim)", () => `=IF($A6="","",${C("S")}6*(1-${C("dS")}6))`, LEI);
cdef("Ns", "Site: câștig real / noapte", () => `=IF($A6="","",(${C("Gs")}6-p_Taxe)/(1+p_TVA)-s_Plata*${C("Gs")}6)`, LEI);
cdef("N", "Câștig țintă / noapte", () => `=IF($A6="","",${C("Ns")}6/(1+p_Avantaj))`, LEI);
const plats = [["b", "Booking"], ["a", "Airbnb"], ["m", "Travelminit"]];
plats.forEach(([p, label]) => {
  cdef(p + "ck", `${label}: comision efectiv (cu supliment, TVA nerecuperabil)`, () => `=IF($A6="","",(${p}_Com+${p}_Supl)*(1+${p}_TVAc))`, PCT1);
  cdef(p + "G", `${label}: plătește oaspetele pentru câștigul țintă`, () => `=IF($A6="","",(${C("N")}6+p_Taxe/(1+p_TVA)-${C(p + "ck")}6*${p}_Excl*p_Taxe)/(1/(1+p_TVA)-${C(p + "ck")}6-${p}_Plata))`, LEI);
  if (p === "a") {
    cdef("ad", "Airbnb: reducere globală la sejurul minim", () => `=IF($A6="","",a_Durata*IF($C6>=28,a_Luna,IF($C6>=7,a_Sapt,INDEX(p_Std,1,MAX(2,$C6)-1))))`, PCT);
    cdef("aEq", "Airbnb: preț pentru câștigul țintă", () => `=IF($A6="","",${C("aG")}6/(1-${C("ad")}6)/(1-a_Auto*a_Pond))`, LEI);
    cdef("aFloor", "Airbnb: preț minim (dacă urmezi sugestia)", () => `=IF($A6="","",(${C("Ns")}6*a_MinNet+p_Taxe/(1+p_TVA)-${C("ack")}6*a_Excl*p_Taxe)/(1/(1+p_TVA)-${C("ack")}6-a_Plata)/(1-${C("ad")}6)/(1-a_Auto*a_Pond))`, LEI);
    cdef("aP", "AIRBNB preț / noapte", () => `=IF($A6="","",IF(N(Perioade!$O6)>0,CEILING(MAX(${C("aFloor")}6,${C("aEq")}6*(1-a_PondSug)+N(Perioade!$O6)*a_PondSug),a_Rot),CEILING(${C("aEq")}6,a_Rot)))`, LEI);
  } else {
    cdef(p + "d", `${label}: reducere pe durată la sejurul minim`, () => `=IF($A6="","",${p}_Durata*${C("dS")}6)`, PCT);
    cdef(p + "P", `${label.toUpperCase()} preț de setat`, () => `=IF($A6="","",CEILING(${C(p + "G")}6/(1-${C(p + "d")}6)/(1-${p}_Auto*${p}_Pond),${p}_Rot))`, LEI);
  }
});
const pd = p => (p === "a" ? C("ad") : C(p + "d"));
plats.forEach(([p, label]) => {
  cdef(p + "Gm", `${label}: plătește oaspetele (sejur minim, cu prețul rotunjit)`, () => `=IF($A6="","",${C(p + "P")}6*(1-${pd(p)}6)*(1-${p}_Auto*${p}_Pond))`, LEI);
  cdef(p + "Nm", `${label}: câștig real / noapte (sejur minim)`, () => `=IF($A6="","",(${C(p + "Gm")}6-p_Taxe)/(1+p_TVA)-${C(p + "ck")}6*(${C(p + "Gm")}6-${p}_Excl*p_Taxe)-${p}_Plata*${C(p + "Gm")}6)`, LEI);
});
plats.forEach(([p, label]) => {
  cdef(p + "Eff", `${label}: comision + plată, din venitul real (fără TVA și taxe)`, () => `=IF($A6="","",(${C(p + "ck")}6*(${C(p + "Gm")}6-${p}_Excl*p_Taxe)+${p}_Plata*${C(p + "Gm")}6)/((${C(p + "Gm")}6-p_Taxe)/(1+p_TVA)))`, PCT1);
});
const t = k => `IF(${C(k)}6="","–",ROUND(${C(k)}6*100,0))`;
cdef("scale", "Scara (text)", () => `=IF($A6="","",${t("thr2")}&"/"&${t("thr3")}&"/"&${t("thr4")}&"/"&${t("thr5")}&"/"&${t("thr6")}&"/"&${t("thr7")}&"% (2…7+ nopți)")`);
// blocuri pe durată: 2,3,4,5,6,7,14 nopți
const NIGHTS = [2, 3, 4, 5, 6, 7, 14];
const effOf = n => C("eff" + Math.min(n, 7));
const blockStart = ci + 1;
NIGHTS.forEach(n => {
  const e = `$${effOf(n)}6`;
  cdef("t" + n, `${n} n: câștig țintă`, () => `=IF(OR($A6="",${n}<$C6),"",(($${C("S")}6*(1-${e})-p_Taxe)/(1+p_TVA)-s_Plata*$${C("S")}6*(1-${e}))/(1+p_Avantaj))`, LEI);
  const gB = `($${C("bP")}6*(1-b_Durata*${e})*(1-b_Auto*b_Pond))`;
  cdef("b" + n, `${n} n: câștig Booking`, () => `=IF(${C("t" + n)}6="","",(${gB}-p_Taxe)/(1+p_TVA)-$${C("bck")}6*(${gB}-b_Excl*p_Taxe)-b_Plata*${gB})`, LEI);
  const aCol = col(ci + 1);
  const gA = `($${C("aP")}6*(1-${aCol}$2)*(1-a_Auto*a_Pond))`;
  cdef("a" + n, `${n} n: câștig Airbnb`, () => `=IF(${C("t" + n)}6="","",(${gA}-p_Taxe)/(1+p_TVA)-$${C("ack")}6*(${gA}-a_Excl*p_Taxe)-a_Plata*${gA})`, LEI);
  f(CA, aCol + "2", `=a_Durata*IF(${n}>=28,a_Luna,IF(${n}>=7,a_Sapt,INDEX(p_Std,1,${n - 1})))`); fmt(CA, aCol + "2", { nf: PCT, color: "#808080" });
  const gM = `($${C("mP")}6*(1-m_Durata*${e})*(1-m_Auto*m_Pond))`;
  cdef("m" + n, `${n} n: câștig Travelminit`, () => `=IF(${C("t" + n)}6="","",(${gM}-p_Taxe)/(1+p_TVA)-$${C("mck")}6*(${gM}-m_Excl*p_Taxe)-m_Plata*${gM})`, LEI);
  cdef("p" + n, `${n} n: profit / noapte pe site după costuri`, () => `=IF(${C("t" + n)}6="","",(${n}*(($${C("S")}6*(1-${e})-p_Taxe)/(1+p_TVA)-s_Plata*$${C("S")}6*(1-${e}))-(c_Cur+IF(${n}>=7,c_Spal7,c_Spal)+c_Cons))/${n})`, LEI);
});
if (C("eff2") !== "J" || C("eff7") !== "O") throw new Error("Perioade Q–V presupun eff2..eff7 = J..O în Calcule");
set(CA, col(blockStart - 1) + "2", "Airbnb, reducere globală →"); fmt(CA, col(blockStart - 1) + "2", { color: "#808080", h: "right" });
caDef.forEach(d => { set(CA, d.c + "5", d.head); f(CA, `${d.c}${R0}:${d.c}${R1}`, d.fx()); if (d.nf) fmt(CA, `${d.c}${R0}:${d.c}${R1}`, { nf: d.nf }); });
fmt(CA, `A5:${col(ci)}5`, Object.assign({}, HEAD, { fill: "#7F7F7F" })); height(CA, 5, 66);
fmt(CA, `A${R0}:${col(ci)}${R1}`, Object.assign({ border: true }, CALC));
width(CA, `A:${col(ci)}`, 12); width(CA, "A", 20);
ops.push({ op: "tab", s: CA, color: "#7F7F7F" });
ops.push({ op: "freeze", s: CA, row: 5, col: 1 });

/* ============================== PREȚURI DE SETAT ============================== */
const PS = "Prețuri de setat";
set(PS, "A1", "Prețuri de setat pe fiecare platformă"); fmt(PS, "A1", TITLE);
set(PS, "A2", "Calculat din „Perioade” + „Setări”: pe fiecare platformă îți rămâne câștigul țintă (câștigul real de pe site ÷ (1 + avantajul site-ului)), după TVA, comision, costul plății și reducerile aplicate de platformă. Calculul se face la sejurul minim al perioadei."); fmt(PS, "A2", NOTE);
set(PS, "A3", "Coloanele ACUM vin din „Date actuale” (ce e setat azi pe platforme); roșu = diferă de prețul calculat. Comparația „Direct economisești” de pe site folosește coloanele ACUM."); fmt(PS, "A3", NOTE);
[["A4:E4", "PERIOADA", BLUE], ["F4:L4", "CE SETEZI", "#C65911"], ["M4:T4", "CÂȘTIG REAL / NOAPTE (sejur minim; fără TVA, taxe, comision)", "#2F75B5"], ["U4:X4", "OASPETELE PLĂTEȘTE / NOAPTE", "#2F75B5"], ["Y4:AA4", "SETAT ACUM", "#548235"], ["AB4:AD4", "CÂT IA PLATFORMA", "#7F7F7F"]].forEach(([r, txt, fill]) => {
  set(PS, r.split(":")[0], txt); merge(PS, r); fmt(PS, r, Object.assign({}, HEAD, { fill }));
});
const psHead = ["ID perioadă", "De la", "Până la", "Nopți min.", "Reduceri", "SITE\npreț / noapte", "BOOKING\nStandard Rate", "AIRBNB\npreț / noapte", "TRAVELMINIT\npreț / noapte", "Booking – planuri", "Airbnb – observație", "Travelminit – reduceri",
  "Câștig țintă", "Site", "Booking", "Airbnb", "Travelminit", "Booking\n% țintă", "Airbnb\n% țintă", "Travelminit\n% țintă",
  "Site", "Booking", "Airbnb", "Travelminit", "Booking\nACUM", "Airbnb\nACUM", "Travelminit\nACUM", "Booking", "Airbnb", "Travelminit", "Politică anulare"];
psHead.forEach((h, i) => set(PS, col(1 + i) + "5", h)); fmt(PS, "A5:AE5", HEAD); height(PS, 5, 44);
f(PS, rows("A"), `=IF(Calcule!$A6="","",Calcule!$A6)`);
f(PS, rows("B"), `=IF($A6="","",Perioade!$C6)`); f(PS, rows("C"), `=IF($A6="","",Perioade!$D6)`);
f(PS, rows("D"), `=IF($A6="","",Calcule!$${C("minN")}6)`); f(PS, rows("E"), `=IF($A6="","",Calcule!$${C("tip")}6)`);
f(PS, rows("F"), `=IF($A6="","",Calcule!$${C("S")}6)`); f(PS, rows("G"), `=IF($A6="","",Calcule!$${C("bP")}6)`);
f(PS, rows("H"), `=IF($A6="","",Calcule!$${C("aP")}6)`); f(PS, rows("I"), `=IF($A6="","",Calcule!$${C("mP")}6)`);
f(PS, rows("J"), `=IF($A6="","",IF(b_Durata=0,"Fără planuri pe durată",IF(Calcule!$${C("tip")}6="Preț fix","Doar planul „Sărbători” (fără reduceri pe durată)",IF(Calcule!$${C("tip")}6="Standard","Planurile „2 zile” … „7 zile” (scara standard)","⚠ Planuri separate: "&Calcule!$${C("scale")}6))))`);
f(PS, rows("K"), `=IF($A6="","",IF(N(Perioade!$O6)>0,"Cu sugestia Airbnb ("&ROUND(a_PondSug*100,0)&"%)",IF(ABS(Calcule!$${C("ad")}6-Calcule!$${C("dS")}6)>0.0001,"Urcat pentru reducerea globală ("&ROUND(Calcule!$${C("ad")}6*100,0)&"% la "&$D6&" nopți) – mai puțin la sejururi lungi","Reducerile Airbnb = cele de pe site")))`);
f(PS, rows("L"), `=IF($A6="","",IF(OR(m_Durata=0,Calcule!$${C("has")}6=0),"Fără reduceri pe durată","Reduceri "&Calcule!$${C("scale")}6&" pe "&RIGHT("0"&DAY($B6),2)&"."&RIGHT("0"&MONTH($B6),2)&"–"&RIGHT("0"&DAY($C6),2)&"."&RIGHT("0"&MONTH($C6),2)&"."&YEAR($C6)))`);
f(PS, rows("M"), `=IF($A6="","",Calcule!$${C("N")}6)`); f(PS, rows("N"), `=IF($A6="","",Calcule!$${C("Ns")}6)`);
f(PS, rows("O"), `=IF($A6="","",Calcule!$${C("bNm")}6)`); f(PS, rows("P"), `=IF($A6="","",Calcule!$${C("aNm")}6)`); f(PS, rows("Q"), `=IF($A6="","",Calcule!$${C("mNm")}6)`);
f(PS, rows("R"), `=IF($A6="","",O6/$M6)`); f(PS, rows("S"), `=IF($A6="","",P6/$M6)`); f(PS, rows("T"), `=IF($A6="","",Q6/$M6)`);
f(PS, rows("U"), `=IF($A6="","",Calcule!$${C("Gs")}6)`); f(PS, rows("V"), `=IF($A6="","",Calcule!$${C("bGm")}6)`);
f(PS, rows("W"), `=IF($A6="","",Calcule!$${C("aGm")}6)`); f(PS, rows("X"), `=IF($A6="","",Calcule!$${C("mGm")}6)`);
[["Y", "C"], ["Z", "D"], ["AA", "E"]].forEach(([c, dc]) => f(PS, rows(c), `=IF($A6="","",IFERROR(INDEX('Date actuale'!$${dc}$6:$${dc}$40,MATCH($A6,'Date actuale'!$A$6:$A$40,0)),""))`));
f(PS, rows("AB"), `=IF($A6="","",Calcule!$${C("bEff")}6)`); f(PS, rows("AC"), `=IF($A6="","",Calcule!$${C("aEff")}6)`); f(PS, rows("AD"), `=IF($A6="","",Calcule!$${C("mEff")}6)`);
f(PS, rows("AE"), `=IF($A6="","",Perioade!$N6)`);
fmt(PS, rows("A", "AE"), { border: true }); fmt(PS, rows("A", "E"), { color: "#008000" });
fmt(PS, rows("B", "C"), { nf: DATE, h: "center" }); fmt(PS, rows("D", "E"), { h: "center" });
fmt(PS, rows("F", "I"), Object.assign({ nf: LEI, bold: true }, CALC, { fill: "#FCE4D6" }));
fmt(PS, rows("J", "L"), { wrap: true, size: 9 });
fmt(PS, rows("M", "Q"), Object.assign({ nf: LEI }, CALC)); fmt(PS, rows("R", "T"), { nf: PCT, h: "center" });
fmt(PS, rows("U", "X"), Object.assign({ nf: LEI }, CALC)); fmt(PS, rows("Y", "AA"), { nf: LEI }); fmt(PS, rows("AB", "AD"), { nf: PCT1, h: "center" });
cf(PS, rows("R", "T"), Object.assign({ type: "cell", oper: 6, f1: "=p_Prag" }, RED));
cf(PS, rows("R", "T"), Object.assign({ type: "cell", oper: 1, f1: "=p_Prag", f2: "=10" }, GREEN));
[["Y", "G"], ["Z", "H"], ["AA", "I"]].forEach(([c, ref]) => cf(PS, rows(c), Object.assign({ type: "cell", oper: 4, f1: `=${ref}6` }, RED)));
width(PS, "A", 20); width(PS, "B:C", 11); width(PS, "D", 7); width(PS, "E", 12); width(PS, "F:I", 13); width(PS, "J:L", 30); width(PS, "M:X", 11.5); width(PS, "Y:AA", 11); width(PS, "AB:AD", 10); width(PS, "AE", 16);
ops.push({ op: "tab", s: PS, color: "#C65911" });
ops.push({ op: "freeze", s: PS, row: 5, col: 1 });

/* ============================== VERIFICARE SEJURURI ============================== */
const VS = "Verificare sejururi";
set(VS, "A1", "Verificare sejururi – cât îți rămâne pe fiecare platformă, la fiecare durată"); fmt(VS, "A1", TITLE);
set(VS, "A2", "Procent din câștigul țintă la aceeași durată (câștigul real de pe site ÷ (1 + avantajul site-ului)), cu tot sejurul în aceeași perioadă. Verde = cel puțin pragul din „Setări”; roșu = platforma îți lasă mai puțin decât ai vrut; peste 100% = platforma e mai scumpă decât era nevoie."); fmt(VS, "A2", NOTE);
set(VS, "A3", "Roșul apare de obicei la Airbnb pe perioadele cu preț fix sau personalizate: reducerile Airbnb sunt globale. Sejururile care trec dintr-o perioadă în alta: vezi „Simulator”. În dreapta: profitul pe noapte pe site după curățenie, spălătorie și consumabile."); fmt(VS, "A3", NOTE);
set(VS, "A5", "ID perioadă"); set(VS, "B5", "Reduceri"); set(VS, "C5", "Nopți min.");
f(VS, rows("A"), `=IF(Calcule!$A6="","",Calcule!$A6)`); f(VS, rows("B"), `=IF($A6="","",Calcule!$${C("tip")}6)`); f(VS, rows("C"), `=IF($A6="","",Calcule!$${C("minN")}6)`);
let vc = 4;
NIGHTS.forEach(n => {
  const g = `${col(vc)}4:${col(vc + 2)}4`; set(VS, col(vc) + "4", `${n} nopți`); merge(VS, g);
  [["b", "Booking"], ["a", "Airbnb"], ["m", "Travelminit"]].forEach(([p, label], j) => {
    const c = col(vc + j); set(VS, c + "5", label);
    f(VS, `${c}${R0}:${c}${R1}`, `=IF(Calcule!$${C("t" + n)}6="","",Calcule!$${C(p + n)}6/Calcule!$${C("t" + n)}6)`);
  });
  vc += 3;
});
const pStart = vc;
set(VS, col(vc) + "4", "Profit / noapte pe site după costuri"); merge(VS, `${col(vc)}4:${col(vc + NIGHTS.length - 1)}4`);
NIGHTS.forEach((n, j) => { const c = col(vc + j); set(VS, c + "5", `${n} nopți`); f(VS, `${c}${R0}:${c}${R1}`, `=IF($A6="","",Calcule!$${C("p" + n)}6)`); });
const vLast = col(vc + NIGHTS.length - 1);
fmt(VS, `A4:${vLast}5`, HEAD); fmt(VS, `${col(pStart)}4:${vLast}5`, { fill: "#548235" }); height(VS, 5, 30);
fmt(VS, `A${R0}:${vLast}${R1}`, { border: true }); fmt(VS, rows("A", "C"), { color: "#008000" }); fmt(VS, rows("B", "C"), { h: "center" });
fmt(VS, `D${R0}:${col(pStart - 1)}${R1}`, { nf: PCT, h: "center" });
fmt(VS, `${col(pStart)}${R0}:${vLast}${R1}`, Object.assign({ nf: LEI }, CALC));
cf(VS, `D${R0}:${col(pStart - 1)}${R1}`, Object.assign({ type: "cell", oper: 6, f1: "=p_Prag" }, RED));
cf(VS, `D${R0}:${col(pStart - 1)}${R1}`, Object.assign({ type: "cell", oper: 1, f1: "=p_Prag", f2: "=10" }, GREEN));
width(VS, "A", 20); width(VS, "B", 12); width(VS, "C", 7); width(VS, `D:${col(pStart - 1)}`, 11); width(VS, `${col(pStart)}:${vLast}`, 10);
ops.push({ op: "tab", s: VS, color: "#2F75B5" });
ops.push({ op: "freeze", s: VS, row: 5, col: 1 });

/* ============================== SIMULATOR ============================== */
const SI = "Simulator";
set(SI, "A1", "Simulator rezervare – cât plătește oaspetele și cât îți rămâne"); fmt(SI, "A1", TITLE);
set(SI, "A2", "Modifică celulele galbene. Prețul se calculează pe fiecare noapte după perioada ei; reducerea pe durată și nopțile minime după perioada zilei de check-in (ca pe site). Nopțile din perioadele cu preț fix nu primesc reducere (site, Booking, Travelminit); Airbnb aplică reducerea globală pe tot."); fmt(SI, "A2", NOTE);
const simIn = [[4, "Check-in", 46402, DATE], [5, "Nopți (max. 30)", 4, "0"], [6, "Adulți", 4, "0"], [7, "Oaspete Booking cu reducerea automată (mobil)? 1=da", 1, "0"], [8, "Tarif flexibil pe site (+10%)? 1=da", 0, "0"]];
simIn.forEach(([r, l, v, nf]) => { set(SI, "A" + r, l); inp(SI, "B" + r, v); fmt(SI, "B" + r, Object.assign({ nf, h: "center", border: true }, INPUT)); });
const DR0 = 30, DR1 = 59;
set(SI, "A9", "Check-out"); f(SI, "B9", "=B4+B5"); fmt(SI, "B9", Object.assign({ nf: DATE, h: "center" }, CALC));
set(SI, "A10", "Perioada zilei de check-in"); f(SI, "B10", `=IF(C${DR0}="","fără perioadă",D${DR0})`);
set(SI, "A11", "Nopți minime în perioadă"); f(SI, "B11", `=IF(C${DR0}="","",INDEX(Calcule!$${C("minN")}$6:$${C("minN")}$40,C${DR0}))`);
set(SI, "A12", "Reducere pe durată (site, Booking, Travelminit)"); f(SI, "B12", `=IF(OR(C${DR0}="",B5<N(B11)),0,INDEX(Calcule!$${C("eff2")}$6:$${C("eff7")}$40,C${DR0},MIN(B5,7)-1))`);
set(SI, "A13", "Reducere globală Airbnb"); f(SI, "B13", "=a_Durata*IF(B5>=28,a_Luna,IF(B5>=7,a_Sapt,IF(B5>=2,INDEX(p_Std,1,B5-1),0)))");
set(SI, "A14", "Verificare sejur"); f(SI, "B14", `=IF(C${DR0}="","⚠ Data nu e în nicio perioadă – pe site rezervarea e blocată",IF(B5<N(B11),"⚠ Sub numărul minim de nopți",IF(B5>30,"⚠ Max. 30 de nopți în simulator","OK")))`);
fmt(SI, "B10:B14", Object.assign({ h: "center" }, CALC)); fmt(SI, "B11", { nf: "0" }); fmt(SI, "B12:B13", { nf: PCT });
["", "Site direct", "Booking.com", "Airbnb", "Travelminit"].forEach((h, i) => set(SI, col(4 + i) + "4", h)); fmt(SI, "D4:H4", HEAD);
const simRows = [
  [5, "Preț nopți (fără reduceri)", c => `=SUM(${c}${DR0}:${c}${DR1})`],
  [6, "Reducere pe durată", { E: `=-SUMPRODUCT(E${DR0}:E${DR1},I${DR0}:I${DR1})*$B$12`, F: `=-SUMPRODUCT(F${DR0}:F${DR1},I${DR0}:I${DR1})*$B$12*b_Durata`, G: "=-G5*$B$13", H: `=-SUMPRODUCT(H${DR0}:H${DR1},I${DR0}:I${DR1})*$B$12*m_Durata` }],
  [7, "Reducere automată (mobil / Genius)", { E: "=0", F: "=-(F5+F6)*b_Auto*$B$7", G: "=-(G5+G6)*a_Auto", H: "=-(H5+H6)*m_Auto" }],
  [8, "Supliment tarif flexibil (site)", { E: "=(E5+E6)*s_Flex*$B$8", F: "=0", G: "=0", H: "=0" }],
  [9, "PLĂTEȘTE OASPETELE", c => `=SUM(${c}5:${c}8)`],
  [10, "Taxe locale (turistică + Salvamont)", () => "=-(p_TaxaTur+p_TaxaSalv)*$B$6*$B$5"],
  [11, "TVA cazare", c => `=-(${c}9+${c}10)*p_TVA/(1+p_TVA)`],
  [12, "Comision platformă", { E: "=0", F: "=-(b_Com+b_Supl)*(1+b_TVAc)*(F9+b_Excl*F10)", G: "=-(a_Com+a_Supl)*(1+a_TVAc)*(G9+a_Excl*G10)", H: "=-(m_Com+m_Supl)*(1+m_TVAc)*(H9+m_Excl*H10)" }],
  [13, "Cost procesare plată", { E: "=-s_Plata*E9", F: "=-b_Plata*F9", G: "=-a_Plata*G9", H: "=-m_Plata*H9" }],
  [14, "CÂȘTIG REAL (fără TVA, taxe, comision)", c => `=SUM(${c}9:${c}13)`],
  [15, "Costuri sejur (curățenie, spălătorie, consumabile)", () => "=IF($B$5>0,-(c_Cur+IF($B$5>=7,c_Spal7,c_Spal)+c_Cons),0)"],
  [16, "PROFIT SEJUR", c => `=${c}14+${c}15`],
  [17, "Profit / noapte", c => `=IF($B$5>0,${c}16/$B$5,0)`],
  [18, "Cât ia platforma (din venitul real)", { E: '="—"', F: '=IF(F9+F10+F11=0,"",-(F12+F13)/(F9+F10+F11))', G: '=IF(G9+G10+G11=0,"",-(G12+G13)/(G9+G10+G11))', H: '=IF(H9+H10+H11=0,"",-(H12+H13)/(H9+H10+H11))' }],
  [19, "Câștig real față de site", { E: '="—"', F: '=IF($E$14=0,"",F14/$E$14)', G: '=IF($E$14=0,"",G14/$E$14)', H: '=IF($E$14=0,"",H14/$E$14)' }],
  [20, "Oaspetele economisește pe site față de", { E: '="—"', F: "=F9-$E$9", G: "=G9-$E$9", H: "=H9-$E$9" }],
];
simRows.forEach(([r, label, def]) => {
  set(SI, "D" + r, label);
  ["E", "F", "G", "H"].forEach(c => f(SI, c + r, typeof def === "function" ? def(c) : def[c]));
});
fmt(SI, "D5:H20", { border: true }); fmt(SI, "E5:H17", Object.assign({ nf: LEI }, CALC)); fmt(SI, "E20:H20", Object.assign({ nf: LEI }, CALC));
fmt(SI, "E18:H19", Object.assign({ nf: PCT1, h: "right" }, CALC));
[9, 14, 16].forEach(r => fmt(SI, `D${r}:H${r}`, { bold: true }));
set(SI, "A28", "Detaliu pe nopți"); fmt(SI, "A28", SECTION);
["Noapte", "Data", "rând (intern)", "Perioadă", "Site", "Booking", "Airbnb", "Travelminit", "Cu reduceri"].forEach((h, i) => set(SI, col(1 + i) + "29", h)); fmt(SI, "A29:I29", HEAD);
for (let r = DR0, n = 1; r <= DR1; r++, n++) f(SI, "A" + r, `=IF(${n}<=$B$5,${n},"")`);
f(SI, `B${DR0}:B${DR1}`, `=IF(A${DR0}="","",$B$4+A${DR0}-1)`);
f(SI, `C${DR0}:C${DR1}`, `=IF(A${DR0}="","",IFERROR(IF(B${DR0}<=INDEX(Perioade!$D$6:$D$40,MATCH(B${DR0},Perioade!$C$6:$C$40,1)),MATCH(B${DR0},Perioade!$C$6:$C$40,1),""),""))`);
f(SI, `D${DR0}:D${DR1}`, `=IF(A${DR0}="","",IF(C${DR0}="","fără perioadă",INDEX(Perioade!$A$6:$A$40,C${DR0})))`);
[["E", "S"], ["F", "bP"], ["G", "aP"], ["H", "mP"], ["I", "has"]].forEach(([c, k]) => f(SI, `${c}${DR0}:${c}${DR1}`, `=IF(C${DR0}="",0,INDEX(Calcule!$${C(k)}$6:$${C(k)}$40,C${DR0}))`));
fmt(SI, `A${DR0}:I${DR1}`, { border: true }); fmt(SI, `B${DR0}:B${DR1}`, { nf: DATE }); fmt(SI, `C${DR0}:C${DR1}`, { color: "#A6A6A6" }); fmt(SI, `E${DR0}:H${DR1}`, { nf: LEI }); fmt(SI, `I${DR0}:I${DR1}`, { nf: "0", h: "center" });
width(SI, "A", 46); width(SI, "B", 16); width(SI, "C", 8); width(SI, "D", 46); width(SI, "E:H", 14); width(SI, "I", 10);
ops.push({ op: "tab", s: SI, color: "#2F75B5" });

/* ============================== CALENDAR ============================== */
const CL = "Calendar";
set(CL, "A1", "Calendar zilnic – preț pe noapte pe fiecare canal (12 luni)"); fmt(CL, "A1", TITLE);
set(CL, "A2", "Prima zi:"); inp(CL, "B2", 46320); fmt(CL, "B2", Object.assign({ nf: DATE, h: "center", border: true }, INPUT));
set(CL, "C2", "Prețurile de setat (nu cele plătite după reduceri). Util când introduci prețuri pe intervale în extranet."); fmt(CL, "C2", NOTE);
["Data", "Zi", "Perioadă", "Nopți min.", "Reduceri", "Site", "Booking", "Airbnb", "Travelminit", "Câștig țintă / noapte", "rând (intern)"].forEach((h, i) => set(CL, col(1 + i) + "4", h)); fmt(CL, "A4:K4", HEAD); height(CL, 4, 30);
const CR0 = 5, CR1 = 369;
f(CL, `A${CR0}:A${CR1}`, `=$B$2+ROW()-${CR0}`);
f(CL, `B${CR0}:B${CR1}`, `=CHOOSE(WEEKDAY(A${CR0},2),"Lu","Ma","Mi","Jo","Vi","Sâ","Du")`);
f(CL, `K${CR0}:K${CR1}`, `=IFERROR(IF(A${CR0}<=INDEX(Perioade!$D$6:$D$40,MATCH(A${CR0},Perioade!$C$6:$C$40,1)),MATCH(A${CR0},Perioade!$C$6:$C$40,1),""),"")`);
f(CL, `C${CR0}:C${CR1}`, `=IF(K${CR0}="","⚠ fără perioadă",INDEX(Perioade!$A$6:$A$40,K${CR0}))`);
[["D", "minN"], ["E", "tip"], ["F", "S"], ["G", "bP"], ["H", "aP"], ["I", "mP"], ["J", "N"]].forEach(([c, k]) => f(CL, `${c}${CR0}:${c}${CR1}`, `=IF(K${CR0}="","",INDEX(Calcule!$${C(k)}$6:$${C(k)}$40,K${CR0}))`));
fmt(CL, `A${CR0}:A${CR1}`, { nf: DATE }); fmt(CL, `B${CR0}:B${CR1}`, { h: "center" }); fmt(CL, `D${CR0}:E${CR1}`, { h: "center" });
fmt(CL, `F${CR0}:J${CR1}`, { nf: LEI }); fmt(CL, `K${CR0}:K${CR1}`, { color: "#A6A6A6", h: "center" });
width(CL, "A", 12); width(CL, "B", 5); width(CL, "C", 20); width(CL, "D", 9); width(CL, "E", 12); width(CL, "F:J", 12); width(CL, "K", 8);
ops.push({ op: "freeze", s: CL, row: 4, col: 0 });

/* ============================== CHECKLIST ============================== */
const CK = "Checklist";
set(CK, "A1", "Checklist sincronizare platforme"); fmt(CK, "A1", TITLE);
set(CK, "A2", "După fiecare modificare în „Perioade” sau „Setări”, parcurge lista. Valorile vin din „Prețuri de setat”."); fmt(CK, "A2", NOTE);
["Platformă", "Ce setezi", "Unde (meniu)", "Valoare / regulă", "Stare"].forEach((h, i) => set(CK, col(1 + i) + "4", h)); fmt(CK, "A4:E4", HEAD);
const ck = [
  ["Site", "Prețuri, nopți minime, reduceri", "Salvezi fișierul și îl copiezi ca pricing/tarife.xlsx în repo → git push", "Automat din foaia „Export site”"],
  ["Booking.com", "Standard Rate pe fiecare perioadă", "Extranet → Tarife și disponibilitate → Calendar", "„Prețuri de setat”, coloana G"],
  ["Booking.com", "Planurile „2 zile” … „7 zile”", "Extranet → Planuri tarifare", "Aceleași procente ca scara standard din „Setări”; deschise pe perioadele Standard, închise pe cele cu preț fix (coloana J)"],
  ["Booking.com", "Plan „Sarbatori – Nerambursabil”", "Calendar", "Deschis doar pe perioadele cu preț fix, cu prețul din coloana G"],
  ["Booking.com", "Perioade „Personalizat”", "Extranet → Planuri tarifare", "Set separat de planuri derivate cu procentele perioadei (coloana J), deschis doar pe perioada respectivă"],
  ["Booking.com", "Nopți minime pe perioadă", "Calendar → Restricții (pe intervalul perioadei)", "„Prețuri de setat”, coloana D"],
  ["Booking.com", "Mobile rate", "Promoții → Tarife specifice", "Ca în „Setări” (reducerea automată Booking, azi 10%). Dacă o schimbi, schimbi și în „Setări”"],
  ["Airbnb", "Preț pe noapte pe fiecare perioadă", "Calendar → selectezi intervalul → Preț", "„Prețuri de setat”, coloana H (perioadele cu preț fix sunt deja urcate pentru reducerile globale)"],
  ["Airbnb", "Preț de bază (zilele fără preț personalizat)", "Editor anunț → Prețuri → Preț de bază", "Cel mai mic preț Airbnb din an (plasă de siguranță)"],
  ["Airbnb", "Reduceri Trip length / săptămânal / lunar", "Calendar → Settings → Discounts", "Trip length 2–6 nopți = scara standard; săptămânal și lunar din „Setări”"],
  ["Airbnb", "Nopți minime pe perioadă", "Calendar → Disponibilitate → Durata sejurului", "„Prețuri de setat”, coloana D"],
  ["Travelminit", "Tarif standard pe fiecare perioadă", "Tarife și capacitate → tabel (perioadă)", "„Prețuri de setat”, coloana I"],
  ["Travelminit", "Reduceri pe durată („Reducere generală”)", "Reduceri / promoții", "Pe intervalele și cu procentele din coloana L; „În zilele de ședere”, necombinabile; fără reduceri pe perioadele cu preț fix"],
  ["Travelminit", "Nopți minime pe perioadă", "Condiții de rezervare → Număr minim de nopți", "„Prețuri de setat”, coloana D"],
  ["Travelminit", "Politica „sarbatori” (avans/anulare)", "Avans și anulare", "Doar pe perioadele cu preț fix"],
  ["Toate", "Ce ai setat", "Foaia „Date actuale”", "Treci prețurile setate (coloanele C–E) și data verificării în titlu; altfel comparația „Direct economisești” de pe site devine falsă"],
  ["Toate", "Perioade fără preț", "Foaia „Verificare”", "Adaugă perioada următoare înainte să se termine ultima (azi: 30.06.2027); zilele fără perioadă sunt blocate pe site"],
];
ck.forEach((row, i) => { const r = 5 + i; row.forEach((v, j) => set(CK, col(1 + j) + r, v)); const ob = oldCell(CK, "B" + r); if (ob && ob.v === row[1]) inp(CK, "E" + r, "De făcut"); else set(CK, "E" + r, "De făcut"); });
const ckLast = 4 + ck.length;
fmt(CK, `A5:E${ckLast}`, { border: true, wrap: true, v: "top" }); fmt(CK, `E5:E${ckLast}`, Object.assign({ h: "center" }, INPUT));
width(CK, "A", 13); width(CK, "B", 38); width(CK, "C", 44); width(CK, "D", 70); width(CK, "E", 11);
ops.push({ op: "autofit", s: CK, r: `A5:E${ckLast}` });

/* ============================== VERIFICARE (perioade) ============================== */
const VE = "Verificare";
set(VE, "A1", "Verificare perioade"); fmt(VE, "A1", TITLE);
set(VE, "A2", "Ordine, suprapuneri, goluri, nopți minime, tipul reducerilor, preț. Rezultatul apare și în „Perioade”, coloana Stare."); fmt(VE, "A2", NOTE);
["ID perioadă", "Început", "Sfârșit", "Ordine și suprapunere", "Gol până la perioada următoare (zile)", "Nopți minime și reduceri", "Preț", "Stare"].forEach((h, i) => set(VE, col(1 + i) + "5", h)); fmt(VE, "A5:H5", HEAD); height(VE, 5, 30);
f(VE, rows("A"), '=IF(Perioade!$A6="","",Perioade!$A6)');
f(VE, rows("B"), '=IF($A6="","",Perioade!$C6)'); f(VE, rows("C"), '=IF($A6="","",Perioade!$D6)');
f(VE, rows("D"), '=IF($A6="","",IF(Perioade!$D6<Perioade!$C6,"⚠ sfârșit înainte de început",IF(Perioade!$A7="","OK",IF(Perioade!$C7<=Perioade!$D6,"⚠ se suprapune / neordonat","OK"))))');
f(VE, rows("E"), '=IF($A6="","",IF(Perioade!$A7="","ultima perioadă",Perioade!$C7-Perioade!$D6-1))');
f(VE, rows("F"), `=IF($A6="","",IF(OR(Calcule!$C6<2,Calcule!$C6>7),"⚠ nopți minime între 2 și 7",IF(AND(Perioade!$G6<>"",Perioade!$G6<>"Standard",Perioade!$G6<>"Preț fix",Perioade!$G6<>"Personalizat"),"⚠ alege Standard / Preț fix / Personalizat (acum se aplică Standard)",IF(AND(Calcule!$B6="Personalizat",COUNT(Perioade!$H6:$M6)=0),"⚠ completează reducerile (sau alege Preț fix)","OK"))))`);
f(VE, rows("G"), `=IF($A6="","",IF(Calcule!$${C("S")}6<=0,"⚠ lipsește prețul","OK"))`);
f(VE, rows("H"), '=IF($A6="","",IF(AND(D6="OK",OR(E6="ultima perioadă",E6=0),F6="OK",G6="OK"),IF(Calcule!$B6="Personalizat","OK · Booking: planuri separate","OK"),"⚠ verifică"))');
fmt(VE, rows("A", "H"), { border: true }); fmt(VE, rows("A"), { color: "#008000" }); fmt(VE, rows("B", "C"), { nf: DATE, h: "center" }); fmt(VE, rows("E"), { h: "center" });
cf(VE, rows("D", "H"), { type: "text", text: "⚠", color: "#C00000", bold: true });
set(VE, "J5", "Ultima zi cu tarif pe site"); fmt(VE, "J5", HEAD);
f(VE, "J6", "=MAX(Perioade!$D$6:$D$40)"); fmt(VE, "J6", Object.assign({ nf: DATE, h: "center", border: true }, CALC));
f(VE, "J7", '=IF(J6-TODAY()<120,"⚠ Mai puțin de 4 luni de prețuri pe site – adaugă perioadele următoare","OK")');
width(VE, "A", 20); width(VE, "B:C", 11); width(VE, "D", 26); width(VE, "E", 14); width(VE, "F", 40); width(VE, "G", 16); width(VE, "H", 28); width(VE, "I", 3); width(VE, "J", 24);

/* ============================== EXPORT SITE ============================== */
const EX = "Export site";
["id", "label", "Data inceput", "Data sfarsit", "pret referinta", "2 zile", "3 zile", "4 zile", "5 zile", "6 zile", "7 zile"].forEach((h, i) => set(EX, col(1 + i) + "1", h));
set(EX, "M1", "NU MODIFICA – foaie citită automat de site (update-pricing.cjs)."); fmt(EX, "A1:K1", { bold: true }); fmt(EX, "M1", { bold: true, color: "#C00000" });
const E0 = 2, E1 = 36;
[["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"]].forEach(([c, pc]) => f(EX, `${c}${E0}:${c}${E1}`, `=IF(Perioade!$A6="","",Perioade!${pc}6)`));
for (let n = 2; n <= 7; n++) {
  const c = col(6 + n - 2), th = C("thr" + n);
  f(EX, `${c}${E0}:${c}${E1}`, `=IF(OR(Perioade!$A6="",${n}<Calcule!$C6),"",IF(${n}=Calcule!$C6,N(Calcule!${th}6),IF(N(Calcule!${th}6)>0,Calcule!${th}6,"")))`);
}
fmt(EX, `C${E0}:D${E1}`, { nf: DATE }); fmt(EX, `E${E0}:E${E1}`, { nf: LEI }); fmt(EX, `F${E0}:K${E1}`, { nf: "0.00" });
width(EX, "A", 20); width(EX, "B", 16); width(EX, "C:E", 13);
ops.push({ op: "tab", s: EX, color: "#7F7F7F" });

/* ============================== GHID ============================== */
const GH = "Ghid";
set(GH, "A1", "Prețuri A13 Travel Concept – cum funcționează tabelul"); fmt(GH, "A1", TITLE);
set(GH, "A2", "Scrii doar prețul de pe site pe fiecare perioadă. Prețurile pentru Booking, Airbnb și Travelminit se calculează singure, cu TVA, comision, costul plății și reducerile pe care le aplică fiecare platformă."); fmt(GH, "A2", NOTE);
const gh = [
  ["CUM LUCREZI"],
  ["1. Setări (rar)", "Comisioane, TVA, taxe locale, reducerea de mobil Booking, avantajul site-ului (5%), scara standard de reduceri pe durată, costurile pe sejur."],
  ["2. Perioade", "Pentru fiecare perioadă: datele, prețul tău pe site / noapte (cu taxele locale incluse), nopțile minime și tipul reducerilor: Standard (scara din Setări), Preț fix (fără reduceri, ex. sărbători) sau Personalizat (completezi procentele)."],
  ["3. Prețuri de setat", "Citești ce pui pe fiecare platformă (coloanele G–I) și ce planuri / reduceri deschizi (J–L). Verificarea arată cât îți rămâne pe fiecare canal la sejurul minim."],
  ["4. Verificare sejururi", "Pentru fiecare perioadă, la 2–7 și 14 nopți: cât îți rămâne pe fiecare platformă, ca procent din câștigul țintă, plus profitul pe noapte pe site după costuri."],
  ["5. Checklist", "Setezi prețurile pe platforme, apoi treci ce ai setat în „Date actuale” (coloanele C–E și data din titlu)."],
  ["6. Site", "Salvezi fișierul și îl copiezi ca pricing/tarife.xlsx în repo → git push: site-ul se actualizează singur din foaia „Export site”."],
  [""],
  ["CUM SE CALCULEAZĂ"],
  ["Câștigul real", "Ce plătește oaspetele − taxele locale − TVA (11%) − comisionul − costul plății. Platformele iau comisionul pe prețul cu TVA, dar TVA-ul îl plătești tu: de aceea intră în calcul."],
  ["Câștigul țintă", "Câștigul real de pe site la sejurul minim (cu reducerea lui) ÷ (1 + avantajul site-ului). Pe fiecare platformă, prețul e calculat să-ți lase exact acest câștig."],
  ["Formula", "Preț plătit de oaspete = (câștig țintă + taxe ÷ 1,11 − comision × taxe [doar unde comisionul se ia fără taxe: Booking]) ÷ (1 ÷ 1,11 − comision − cost plată). Apoi se urcă cu reducerile aplicate de platformă la sejurul minim (durată, mobil) și se rotunjește în sus la 10 lei. Pașii sunt în foaia „Calcule”."],
  ["Booking", "15% × (total − taxe locale) + 1,3% × total (Plăți prin Booking.com) – verificat la ban pe rezervările reale. Mobile rate 10% compensat în preț."],
  ["Airbnb", "Taxă unică 15,5% pe tot ce plătește oaspetele (inclusiv taxele locale). Reducerile Airbnb (Trip length 2–6 nopți, săptămânal, lunar) sunt globale: la perioadele cu preț fix sau personalizate prețul e urcat automat ca să iasă corect la sejurul minim; la sejururi mai lungi câștigi mai puțin (vezi „Verificare sejururi”)."],
  ["Travelminit", "12% + TVA (deductibil) pe totalul plătit, inclusiv taxele. Rezervările „la cerere” au +2% (Setări → Supliment). Banii îi încasezi tu."],
  ["Costuri pe sejur", "Curățenie, spălătorie, consumabile: aceleași pe orice canal, deci nu schimbă prețurile de pe platforme; apar ca profit în „Verificare sejururi” și „Simulator”."],
  [""],
  ["TIPURI DE REDUCERI"],
  ["Standard", "Scara din Setări. Merge identic pe toate platformele (Booking: planurile „2 zile” … „7 zile”; Travelminit: „Reducere generală” pe intervalul perioadei; Airbnb: Trip length)."],
  ["Preț fix", "Fără reduceri pe durată (sărbători). Booking: doar planul „Sărbători”; Travelminit: fără reduceri; Airbnb: preț urcat automat pentru reducerea globală."],
  ["Personalizat", "Procentele tale pentru perioada respectivă. Site și Travelminit: da. Booking: cere un set separat de planuri. Airbnb: prețul e corect doar la sejurul minim."],
  [""],
  ["LEGENDĂ"],
  ["Celulă galbenă, text albastru", "Date de intrare – le poți modifica."],
  ["Celulă albastru-deschis", "Calculat automat – nu modifica."],
  ["Verde / roșu în verificări", "Verde = platforma îți lasă cel puțin pragul din Setări (97%) din câștigul țintă; roșu = mai puțin. În coloanele ACUM, roșu = prețul setat azi diferă de cel calculat."],
  [""],
  ["IMPORTANT"],
  ["Export site", "O citește automat site-ul (update-pricing.cjs). Nu o redenumi, nu o șterge, nu scrie în ea."],
  ["Calcule", "Foaie internă cu pașii calculului, pentru verificare. Nu scrie în ea."],
  ["Ordinea perioadelor", "În ordine cronologică, fără suprapuneri și fără goluri (foaia „Verificare”). Zilele fără perioadă sunt blocate pe site."],
  ["Platformele nu se actualizează singure", "Booking, Airbnb și Travelminit se setează manual după „Prețuri de setat” și „Checklist”."],
  ["Surse", "Comisioane verificate pe 25.10.2026: rezervările Booking reale, editorul Airbnb (1.480 lei → 1.251 lei), Travelminit TCG 21.01.2026 (art. 61–64), TVA cazare 11% (Legea 141/2025)."],
];
gh.forEach((row, i) => { const r = 4 + i; set(GH, "A" + r, row[0]); if (row[1]) set(GH, "B" + r, row[1]); if (!row[1] && row[0]) fmt(GH, "A" + r, SECTION); });
const ghLast = 3 + gh.length;
fmt(GH, `A4:B${ghLast}`, { wrap: true, v: "top" });
const lg = gh.findIndex(r => r[0] === "Celulă galbenă, text albastru") + 4;
fmt(GH, "A" + lg, INPUT); fmt(GH, "A" + (lg + 1), CALC);
width(GH, "A", 34); width(GH, "B", 120);
ops.push({ op: "autofit", s: GH, r: `A4:B${ghLast}` });
ops.push({ op: "gridlines", s: GH, show: false });

ops.push({ op: "activate", s: PE });
fs.writeFileSync(OUT, JSON.stringify({ ops, periods: periods.map(p => ({ id: p.id, type: p.type, minN: p.minN })) }, null, 1), "utf8");
console.log("Spec: " + ops.length + " operații; perioade: " + periods.map(p => p.id + "=" + p.type).join(", ") + "; coloane Calcule: " + ci);
console.log("Calcule: " + JSON.stringify(caCols));
