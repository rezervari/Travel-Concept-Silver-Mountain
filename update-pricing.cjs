"use strict";
/**
 * update-pricing.cjs
 *
 * Citește fișierul Excel cu politica de prețuri (pricing/tarife.xlsx) și
 * regenerează pricing.json în formatul consumat de script.js.
 *
 * Format așteptat în Excel (rând de header cu aceste coloane, în orice ordine):
 *   id | label | Data inceput | Data sfarsit | pret referinta | 2 zile | 3 zile | ... | N zile
 *
 * - Coloanele "N zile" sunt detectate automat (oricâte, nu doar 2-7).
 * - O celulă goală la o coloană "N zile" înseamnă că acel prag NU este permis
 *   (ex: gol la "2 zile" => sejur minim mai mare pentru acel sezon).
 * - minNights al sezonului = prima coloană "N zile" completată (cea mai mică).
 * - Perioadele NEACOPERITE de niciun sezon rămân intenționat fără tarif ->
 *   script.js blochează rezervarea în acele zile (fără fallback de preț implicit).
 *
 * Opțional (pentru mesajul „pe platforme același sejur costă de la…” din rezumat):
 *   - foaia „Prețuri de setat”: prețurile ACTUALE de pe platforme pe perioadă (coloanele „Booking ACUM”,
 *     „Airbnb ACUM”, „Travelminit ACUM”; dacă lipsesc, cele țintă) → seasons[].ota;
 *   - foaia „Setări” (fostă „Platforme”): reducerea automată Booking (mobil), dacă platformele aplică reducerile
 *     pe durată, reducerile săptămânală/lunară Airbnb → otaComparison; rândul „Scara standard” → defaultDiscountTiers;
 *   - foaia „Perioade” (fostă „Sezoane”): coloana „Politică anulare” → seasons[].cancellation;
 *   - foaia „Date actuale”: data verificării (prima dată zz.ll.aaaa din primele rânduri) → otaComparison.checkedAt.
 *   Fără aceste foi, pricing.json rămâne ca înainte și site-ul nu afișează comparația.
 *
 * Rulare manuală:  node update-pricing.cjs
 * Rulare automată: .github/workflows/update-pricing.yml (la push pe pricing/tarife.xlsx sau pe acest script)
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCE_XLSX = path.join(__dirname, "pricing", "tarife.xlsx");
const OUTPUT_JSON = path.join(__dirname, "pricing.json");

const CURRENCY = "RON";
const GLOBAL_MIN_NIGHTS = 2;
const DEFAULT_PRICE_FALLBACK = 700; // folosit DOAR daca pricing.json nu poate fi incarcat deloc in browser (eroare retea)
const DEFAULT_DISCOUNT_TIERS_FALLBACK = [
  { minNights: 2, discount: 10 }, { minNights: 3, discount: 12 },
  { minNights: 4, discount: 15 }, { minNights: 5, discount: 20 },
  { minNights: 6, discount: 25 }, { minNights: 7, discount: 33 }
];

// 25569 = numarul de zile intre epoca Excel (1899-12-30) si epoca Unix (1970-01-01).
// Conversie pur aritmetica, ancorata fix in UTC -- evita complet obiectele Date
// (si orice ambiguitate de fus orar la construirea/citirea lor).
function excelSerialToISODate(serial){
  var ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0,10);
}

function toISODate(value){
  if(typeof value === "number"){
    return excelSerialToISODate(value);
  }
  if(value instanceof Date){
    // Fallback defensiv (nu ar trebui sa apara -- nu citim cu cellDates:true),
    // tot cu gettere UTC pentru consecventa.
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString().slice(0,10);
  }
  var d = new Date(value);
  if(isNaN(d.getTime())) throw new Error('Dată invalidă în Excel: "' + value + '"');
  return d.toISOString().slice(0,10);
}

function normalize(s){
  return String(s == null ? "" : s).trim().toLowerCase()
    .replace(/ă/g,"a").replace(/â/g,"a").replace(/î/g,"i").replace(/ș/g,"s").replace(/ş/g,"s").replace(/ț/g,"t").replace(/ţ/g,"t");
}

function main(){
  if(!fs.existsSync(SOURCE_XLSX)){
    throw new Error("Nu găsesc fișierul sursă: " + SOURCE_XLSX);
  }

  var workbook = XLSX.readFile(SOURCE_XLSX); // fara cellDates: citim serialele brute, convertite manual mai jos
  // Fișierul master de prețuri are mai multe foi (Sezoane, Platforme, Prețuri de setat...);
  // site-ul citește foaia generată „Export site”. Fallback: prima foaie (format vechi).
  var exportName = workbook.SheetNames.find(function(n){ return normalize(n) === "export site"; });
  var sheet = workbook.Sheets[exportName || workbook.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  var headerRowIndex = rows.findIndex(function(r){
    return r.some(function(c){ return normalize(c) === "id"; });
  });
  if(headerRowIndex === -1) throw new Error('Nu găsesc rândul de header (coloana "id") în Excel.');

  var header = rows[headerRowIndex].map(function(c){ return c == null ? "" : String(c).trim(); });

  var col = {
    id: header.findIndex(function(h){ return normalize(h) === "id"; }),
    label: header.findIndex(function(h){ return normalize(h) === "label"; }),
    start: header.findIndex(function(h){ return normalize(h).indexOf("data inceput") === 0; }),
    end: header.findIndex(function(h){ return normalize(h).indexOf("data sfarsit") === 0; }),
    price: header.findIndex(function(h){ return normalize(h).indexOf("pret referinta") === 0; })
  };
  Object.keys(col).forEach(function(key){
    if(col[key] === -1) throw new Error('Nu găsesc coloana "' + key + '" în header-ul Excel-ului.');
  });

  // Coloane de reducere: orice header de forma "N zile" -- detectate dinamic, oricate ar fi
  var nightCols = [];
  header.forEach(function(h, idx){
    var m = /^(\d+)\s*zile$/i.exec(normalize(h));
    if(m) nightCols.push({ nights: parseInt(m[1],10), idx: idx });
  });
  nightCols.sort(function(a,b){ return a.nights - b.nights; });
  if(!nightCols.length) throw new Error('Nu găsesc coloane de reducere (format "N zile") în header.');

  var dataRows = rows.slice(headerRowIndex + 1).filter(function(r){
    return r[col.id] != null && String(r[col.id]).trim() !== "";
  });
  if(!dataRows.length) throw new Error("Nu găsesc niciun rând de date sub header.");

  var seasons = dataRows.map(function(r){
    var id = String(r[col.id]).trim();
    var label = String(r[col.label] == null ? "" : r[col.label]).trim();
    var start = toISODate(r[col.start]);
    var end = toISODate(r[col.end]);
    var price = Number(r[col.price]);
    if(!isFinite(price)) throw new Error('Preț invalid pentru sezonul "' + id + '".');

    var discountTiers = [];
    nightCols.forEach(function(nc){
      var raw = r[nc.idx];
      if(raw === null || raw === undefined || raw === "") return; // celula goala = prag nepermis
      var pct = Math.round(Number(raw) * 100);
      if(!isFinite(pct)) throw new Error('Reducere invalidă pentru "' + id + '" la ' + nc.nights + ' nopți.');
      discountTiers.push({ minNights: nc.nights, discount: pct });
    });
    if(!discountTiers.length) throw new Error('Sezonul "' + id + '" nu are niciun prag de nopți definit (toate coloanele "N zile" sunt goale).');

    var minNights = discountTiers[0].minNights; // prima coloana completata = sejur minim

    return { id: id, label: label, start: start, end: end, price: price, minNights: minNights, discountTiers: discountTiers };
  });

  // Validare: fara suprapuneri intre sezoane
  var sorted = seasons.slice().sort(function(a,b){ return new Date(a.start) - new Date(b.start); });
  for(var i=1;i<sorted.length;i++){
    if(new Date(sorted[i].start) <= new Date(sorted[i-1].end)){
      throw new Error('Sezoanele "' + sorted[i-1].id + '" și "' + sorted[i].id + '" se suprapun.');
    }
  }

  readCancellationPolicies(workbook, seasons);
  var otaComparison = readOtaComparison(workbook, seasons);

  var output = {
    currency: CURRENCY,
    defaultPrice: DEFAULT_PRICE_FALLBACK,
    globalMinNights: GLOBAL_MIN_NIGHTS,
    defaultDiscountTiers: readDefaultTiers(workbook) || DEFAULT_DISCOUNT_TIERS_FALLBACK,
    seasons: seasons,
    generatedAt: new Date().toISOString(),
    generatedFrom: path.relative(__dirname, SOURCE_XLSX).split(path.sep).join("/")
  };
  if(otaComparison) output.otaComparison = otaComparison;

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log("pricing.json generat cu succes — " + seasons.length + " sezoane:");
  seasons.forEach(function(s){
    console.log("  - " + s.id + ": " + s.start + " → " + s.end + " · " + s.price + " RON · min " + s.minNights + " nopți" +
      (s.ota ? " · platforme " + JSON.stringify(s.ota) : ""));
  });
  if(otaComparison) console.log("Comparație platforme: " + JSON.stringify(otaComparison));
}

// Prima foaie găsită dintre numele date (numele noi primele, apoi cele vechi: „Perioade”/„Sezoane”, „Setări”/„Platforme”).
function findSheet(workbook){
  var names = Array.prototype.slice.call(arguments, 1);
  for(var i = 0; i < names.length; i++){
    var found = workbook.SheetNames.find(function(n){ return normalize(n) === normalize(names[i]); });
    if(found) return workbook.Sheets[found];
  }
  return null;
}

// Header-ele din Excel au rânduri noi și spații multiple („Booking\nACUM”) → comparăm pe text normalizat.
function headerKey(h){ return normalize(h).replace(/\s+/g, " "); }

// Coloana ID din foile cu perioade: „ID perioadă” (acum) sau „ID sezon” (formatul vechi).
function isIdHeader(c){ var k = headerKey(c); return k === "id perioada" || k === "id sezon"; }

// Scara standard de reduceri pe durată din „Setări” (rândul „Scara standard”, coloanele B–G = 2…7+ nopți)
// → defaultDiscountTiers (rezumatul de pe site + comparația Airbnb 2–6 nopți). null dacă lipsește sau e incompletă.
function readDefaultTiers(workbook){
  var sheet = findSheet(workbook, "Setări", "Platforme");
  if(!sheet) return null;
  var row = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
    .find(function(r){ return headerKey(r[0]) === "scara standard"; });
  if(!row) return null;
  var tiers = [];
  for(var i = 1; i <= 6; i++){
    var v = Number(row[i]);
    if(row[i] === null || row[i] === "" || !isFinite(v)) return null;
    tiers.push({ minNights: i + 1, discount: Math.round(v * 100) });
  }
  return tiers;
}

// Politica de anulare pe perioadă din foaia „Perioade” (coloana „Politică anulare…”: „Flexibil 14 zile” /
// „Nerambursabil”) → seasons[].cancellation, normalizat („flexibil 14 zile” / „nerambursabil”).
// Site-ul oferă tariful direct flexibil doar în perioadele „flexibil”. Fără foaie/coloană: nimic de adăugat.
function readCancellationPolicies(workbook, seasons){
  var sheet = findSheet(workbook, "Perioade", "Sezoane");
  if(!sheet) return;
  var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  var hIdx = rows.findIndex(function(r){ return r.some(isIdHeader); });
  if(hIdx === -1) return;
  var cId = rows[hIdx].findIndex(isIdHeader);
  var header = rows[hIdx].map(headerKey);
  var cPol = header.findIndex(function(h){ return h.indexOf("politica anulare") === 0; });
  if(cPol === -1) return;
  var byId = {};
  rows.slice(hIdx + 1).forEach(function(r){
    if(r[cId] == null || r[cPol] == null) return;
    var pol = headerKey(r[cPol]);
    if(pol) byId[String(r[cId]).trim()] = pol;
  });
  seasons.forEach(function(s){ if(byId[s.id]) s.cancellation = byId[s.id]; });
}

// Prețurile de pe platforme pe sezon + regulile lor de reducere. Întoarce null dacă datele lipsesc.
function readOtaComparison(workbook, seasons){
  var priceSheet = findSheet(workbook, "Prețuri de setat");
  if(!priceSheet) return null;
  var rows = XLSX.utils.sheet_to_json(priceSheet, { header: 1, raw: true, defval: null });
  var hIdx = rows.findIndex(function(r){ return r.some(isIdHeader); });
  if(hIdx === -1) return null;
  var header = rows[hIdx].map(headerKey);
  function colOf(names){
    for(var i = 0; i < names.length; i++){
      var idx = header.indexOf(names[i]);
      if(idx !== -1) return idx;
    }
    return -1;
  }
  var cId = rows[hIdx].findIndex(isIdHeader);
  var cols = {
    booking: colOf(["booking acum", "booking standard rate"]),
    airbnb: colOf(["airbnb acum", "airbnb pret / noapte"]),
    travelminit: colOf(["travelminit acum", "travelminit pret / noapte"])
  };

  var byId = {};
  rows.slice(hIdx + 1).forEach(function(r){
    if(r[cId] == null || String(r[cId]).trim() === "") return;
    var ota = {};
    Object.keys(cols).forEach(function(k){
      var v = cols[k] === -1 ? NaN : Number(r[cols[k]]);
      if(isFinite(v) && v > 0) ota[k] = Math.round(v);
    });
    if(Object.keys(ota).length) byId[String(r[cId]).trim()] = ota;
  });

  var matched = 0;
  seasons.forEach(function(s){
    if(byId[s.id]){ s.ota = byId[s.id]; matched++; }
  });
  if(!matched) return null;

  // Reguli din foaia „Setări” / „Platforme” (coloanele: Setare | Site direct | Booking.com | Airbnb | Travelminit)
  var rules = { bookingMobileDiscount: 0, bookingUsesSiteDiscounts: true, airbnbUsesSiteDiscounts: false, travelminitUsesSiteDiscounts: false, airbnbWeeklyDiscount: 0, airbnbMonthlyDiscount: 0 };
  var platSheet = findSheet(workbook, "Setări", "Platforme");
  if(platSheet){
    var pr = XLSX.utils.sheet_to_json(platSheet, { header: 1, raw: true, defval: null });
    var pct = function(v){ var n = Number(v); return isFinite(n) ? Math.round(n * 1000) / 10 : 0; };
    pr.forEach(function(r){
      var label = headerKey(r[0]);
      if(label.indexOf("reducere automata a platformei") === 0) rules.bookingMobileDiscount = pct(r[2]);
      else if(label.indexOf("aplica reducerile pe durata") === 0){
        rules.bookingUsesSiteDiscounts = Number(r[2]) === 1;
        rules.airbnbUsesSiteDiscounts = Number(r[3]) === 1;
        rules.travelminitUsesSiteDiscounts = Number(r[4]) === 1;
      }
      else if(label.indexOf("reducere saptamanala") === 0) rules.airbnbWeeklyDiscount = pct(r[1]);
      else if(label.indexOf("reducere lunara") === 0) rules.airbnbMonthlyDiscount = pct(r[1]);
    });
  }

  // Data verificării prețurilor (de ex. „… verificate live în conturi pe 21.10.2026 …”)
  var checkedAt = null;
  var dateSheet = findSheet(workbook, "Date actuale");
  if(dateSheet){
    XLSX.utils.sheet_to_json(dateSheet, { header: 1, raw: false, defval: "" }).slice(0, 4).some(function(r){
      return r.some(function(c){
        var m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(c));
        if(m){ checkedAt = m[3] + "-" + m[2] + "-" + m[1]; return true; }
        return false;
      });
    });
  }

  return {
    checkedAt: checkedAt,
    bookingMobileDiscount: rules.bookingMobileDiscount,
    bookingUsesSiteDiscounts: rules.bookingUsesSiteDiscounts,
    airbnbUsesSiteDiscounts: rules.airbnbUsesSiteDiscounts,
    travelminitUsesSiteDiscounts: rules.travelminitUsesSiteDiscounts,
    airbnbWeeklyDiscount: rules.airbnbWeeklyDiscount,
    airbnbMonthlyDiscount: rules.airbnbMonthlyDiscount
  };
}

main();
