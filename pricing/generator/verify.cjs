"use strict";
// Verifică Excelul (valorile calculate de Excel) față de un model JS independent și compară „Export site” cu un alt fișier.
// Rulare: node verify.cjs <xlsx de verificat> <xlsx de comparat (ex. versiunea anterioară)>   (NODE_PATH = node_modules din repo)
const XLSX = require("xlsx");
const [NEW, OLD] = process.argv.slice(2);
const wb = XLSX.readFile(NEW), wo = XLSX.readFile(OLD);
const D = x => { if (typeof x !== "number") return String(x); const d = new Date(Math.round((x - 25569) * 864e5)); return d.toISOString().slice(0,10).split("-").reverse().join("."); };
let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log("  ✗ " + msg); } };

// 1. erori în celule
for (const n of wb.SheetNames) {
  const ws = wb.Sheets[n]; const errs = [];
  for (const a of Object.keys(ws)) if (a[0] !== "!" && ws[a].t === "e") errs.push(a + "=" + ws[a].w);
  console.log(`${n}: ${errs.length ? "ERORI " + errs.slice(0, 8).join(", ") : "fără erori"}`);
  fails += errs.length;
}
console.log("Foi: " + wb.SheetNames.join(" | "));
const v = (s, a) => { const c = wb.Sheets[s][a]; return c ? c.v : undefined; };

// 2. Export site nou = vechi (valori)
const rowsOf = (w) => XLSX.utils.sheet_to_json(w.Sheets["Export site"], { header: 1, raw: true, defval: null }).slice(0, 36).map(r => r.slice(0, 11));
const en = rowsOf(wb), eo = rowsOf(wo);
let diff = 0;
for (let i = 0; i < 36; i++) for (let j = 0; j < 11; j++) {
  const a = en[i] ? en[i][j] : null, b = eo[i] ? eo[i][j] : null;
  const na = a === "" ? null : a, nb = b === "" ? null : b;
  const same = (typeof na === "number" && typeof nb === "number") ? Math.abs(na - nb) < 1e-9 : na === nb;
  if (!same) { diff++; if (diff < 10) console.log(`  Export site diferă la rândul ${i + 1}, col ${j + 1}: nou=${JSON.stringify(a)} vechi=${JSON.stringify(b)}`); }
}
console.log("Export site: " + (diff ? diff + " diferențe" : "identic cu vechiul"));
fails += diff;

// 3. model JS independent, cu parametrii citiți din „Setări” (aceleași adrese ca în build-spec.cjs)
const st = a => Number(v("Setări", a) || 0);
const chan = c => ({ c: (st(c + "22") + st(c + "23")) * (1 + st(c + "26")), excl: st(c + "24"), p: st(c + "25"), auto: st(c + "27") * st(c + "28"), dur: st(c + "29"), rot: st(c + "30") || 1 });
const P = { vat: st("B5"), T: (st("B6") + st("B7")) * st("B8"), adv: st("B12"), sPay: st("B25"), std: ["B", "C", "D", "E", "F", "G"].map(c => st(c + "18")),
  wk: st("B34"), mo: st("B35"), w: st("B36"), minNet: st("B37"), b: chan("C"), a: chan("D"), m: chan("E") };
const a1 = 1 / (1 + P.vat), ceil = (x, r) => Math.ceil(x / r - 1e-9) * r;
const inv = (ch, N) => (N + P.T * a1 - ch.c * ch.excl * P.T) / (a1 - ch.c - ch.p);
const airG = n => P.a.dur * (n >= 28 ? P.mo : n >= 7 ? P.wk : P.std[Math.max(2, n) - 2]);
console.log("\nPerioadă | tip | min | Booking (Excel/JS) | Airbnb | Travelminit | % țintă B/A/M (Excel)");
for (let r = 6; r <= 40; r++) {
  const id = v("Perioade", "A" + r); if (!id) continue;
  const S = v("Perioade", "E" + r), minN = v("Perioade", "F" + r), sug = v("Perioade", "O" + r) || 0;
  const tip = ["Preț fix", "Personalizat"].includes(v("Perioade", "G" + r)) ? v("Perioade", "G" + r) : "Standard";
  const dS = tip === "Preț fix" ? 0 : tip === "Standard" ? P.std[Math.min(minN, 7) - 2] : (v("Perioade", String.fromCharCode(72 + Math.min(minN, 7) - 2) + r) || 0);
  const Gs = S * (1 - dS), Ns = (Gs - P.T) * a1 - P.sPay * Gs, N = Ns / (1 + P.adv);
  const B = ceil(inv(P.b, N) / (1 - P.b.dur * dS) / (1 - P.b.auto), P.b.rot);
  const dA = airG(minN), aEq = inv(P.a, N) / (1 - dA) / (1 - P.a.auto);
  let A = ceil(aEq, P.a.rot);
  if (sug > 0) { const floor = inv(P.a, Ns * P.minNet) / (1 - dA) / (1 - P.a.auto); A = ceil(Math.max(floor, aEq * (1 - P.w) + sug * P.w), P.a.rot); }
  const M = ceil(inv(P.m, N) / (1 - P.m.dur * dS) / (1 - P.m.auto), P.m.rot);
  const eB = v("Prețuri de setat", "G" + r), eA = v("Prețuri de setat", "H" + r), eM = v("Prețuri de setat", "I" + r);
  ok(eB === B && eA === A && eM === M, `${id}: Excel ${eB}/${eA}/${eM} ≠ JS ${B}/${A}/${M}`);
  const pct = ["R", "S", "T"].map(c => (100 * v("Prețuri de setat", c + r)).toFixed(1) + "%").join(" ");
  console.log(`${id} | ${tip} | ${minN} | ${eB}/${B} | ${eA}/${A} | ${eM}/${M} | ${pct} | ACUM ${v("Prețuri de setat", "Y" + r)}/${v("Prețuri de setat", "Z" + r)}/${v("Prețuri de setat", "AA" + r)}`);
  console.log(`    J: ${v("Prețuri de setat", "J" + r)} | K: ${v("Prețuri de setat", "K" + r)} | L: ${v("Prețuri de setat", "L" + r)}`);
}

// 4. Verificare sejururi
console.log("\nVerificare sejururi (% țintă B/A/M la 2,3,4,5,6,7,14 nopți) + profit/noapte site:");
const VS = wb.Sheets["Verificare sejururi"]; const vsRows = XLSX.utils.sheet_to_json(VS, { header: 1, raw: true, defval: "" });
for (let r = 5; r < 12; r++) {
  const row = vsRows[r]; if (!row || !row[0]) continue;
  const cells = []; for (let k = 0; k < 7; k++) cells.push([0, 1, 2].map(j => row[3 + 3 * k + j] === "" ? "–" : Math.round(row[3 + 3 * k + j] * 100)).join("/"));
  const prof = row.slice(24, 31).map(x => x === "" ? "–" : Math.round(x)).join(" ");
  console.log(`${row[0]} (${row[1]}): ${cells.join(" | ")} || ${prof}`);
}

// 5. Simulator
console.log("\nSimulator (" + D(v("Simulator", "B4")) + ", " + v("Simulator", "B5") + " nopți, " + v("Simulator", "B6") + " adulți): " + v("Simulator", "B10") + " · reducere " + v("Simulator", "B12") + " · Airbnb " + v("Simulator", "B13") + " · " + v("Simulator", "B14"));
for (let r = 5; r <= 20; r++) console.log("  " + String(v("Simulator", "D" + r)).padEnd(52) + ["E", "F", "G", "H"].map(c => { const x = v("Simulator", c + r); return typeof x === "number" ? (Math.abs(x) < 2 && r >= 18 ? (x * 100).toFixed(1) + "%" : Math.round(x)) : x; }).join(" | "));

// 6. Calendar + Verificare
console.log("\nCalendar: " + [5, 6, 62, 63, 70, 369].map(r => `${D(v("Calendar", "A" + r))} ${v("Calendar", "C" + r)} ${v("Calendar", "F" + r)}/${v("Calendar", "G" + r)}/${v("Calendar", "H" + r)}/${v("Calendar", "I" + r)}`).join(" · "));
console.log("Verificare: " + [6, 7, 8, 9, 10, 11, 12].map(r => v("Verificare", "H" + r)).join(", ") + " · ultima zi " + D(v("Verificare", "J6")) + " · " + v("Verificare", "J7"));
console.log("Perioade Stare: " + [6, 7, 8, 9, 10, 11, 12].map(r => v("Perioade", "W" + r)).join(", ") + " · aplicat (Crăciun) " + ["Q", "R", "S", "T", "U", "V"].map(c => v("Perioade", c + 8)).join("/"));
console.log("\n" + (fails ? "EȘECURI: " + fails : "TOATE VERIFICĂRILE OK"));
process.exit(fails ? 1 : 0);
