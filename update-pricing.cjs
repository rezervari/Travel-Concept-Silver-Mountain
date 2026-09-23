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
 * Rulare manuală:  node update-pricing.cjs
 * Rulare automată: .github/workflows/update-pricing.yml (la push pe pricing/tarife.xlsx)
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
  { minNights: 2, discount: 10 }, { minNights: 3, discount: 15 },
  { minNights: 4, discount: 20 }, { minNights: 5, discount: 25 },
  { minNights: 6, discount: 30 }, { minNights: 7, discount: 33 }
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
  var sheet = workbook.Sheets[workbook.SheetNames[0]];
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

  var output = {
    currency: CURRENCY,
    defaultPrice: DEFAULT_PRICE_FALLBACK,
    globalMinNights: GLOBAL_MIN_NIGHTS,
    defaultDiscountTiers: DEFAULT_DISCOUNT_TIERS_FALLBACK,
    seasons: seasons,
    generatedAt: new Date().toISOString(),
    generatedFrom: path.relative(__dirname, SOURCE_XLSX).split(path.sep).join("/")
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log("pricing.json generat cu succes — " + seasons.length + " sezoane:");
  seasons.forEach(function(s){
    console.log("  - " + s.id + ": " + s.start + " → " + s.end + " · " + s.price + " RON · min " + s.minNights + " nopți");
  });
}

main();
