/**
 * postari.gs — calendarul postărilor de pe Facebook, Instagram, Google și TikTok (foaia „Postări” din același Sheet).
 *
 * Un rând = o postare (sau o sarcină cu dată), cu starea pe fiecare platformă:
 *   Programat = pleacă singură (Meta Business Suite / profilul Google) → la 10 minute după oră devine „Publicat”;
 *   Manual    = o faci tu (TikTok): amintire pe Telegram cu o oră înainte (pozele ca album, descrierea gata de copiat,
 *               butoanele Am postat / Amintește-mi în 30 min / Nu postez), încă una la o oră după, apoi rămâne la
 *               „De făcut” în panou și în rezumatul de la 08:00 până o marchezi (cel mult 7 zile);
 *   Făcut / Sărit = marcat de tine (Telegram, panou sau direct în foaie); gol = nu se postează acolo.
 * Postările care promit nopți libere („Nopți libere de la” / „Ultima noapte promisă”): dacă o rezervare sau o blocare
 * nouă ocupă una dintre nopți (booked-dates.json de pe site), primești alertă pe Telegram și „De făcut: postare de
 * modificat”, până apeși „Am modificat”.
 *
 * Rulează din checkinSync (declanșatorul de 10 minute, cod salvat: fără versiune nouă). Butoanele din Telegram ajung
 * prin fin-telegram.gs (finTgCallback → socTgCallback; un link tiktok.com lipit în chat → socTgLink), deci prin
 * implementarea „Calendar”; panoul prin pnPostAction (panou.gs). Instalare: postariInstall din editor (foaia +
 * listele + primele postări). Același proiect Apps Script, motorul Rhino → doar ES5; prefix SOC_/soc.
 */

var SOC_SHEET = "Postări";
var SOC_HEADERS = ["ID", "Data", "Ora", "Temă", "Facebook", "Instagram", "Google", "TikTok", "Descriere TikTok",
                   "Text pe prima poză", "Poze", "Nopți libere de la", "Ultima noapte promisă", "Link TikTok", "Note", "Alerte"];
var SOC_TEXT_COLS = ["ID", "Data", "Ora", "Nopți libere de la", "Ultima noapte promisă"];
var SOC_PLATFORMS = [{ key: "fb", name: "Facebook" }, { key: "ig", name: "Instagram" }, { key: "gb", name: "Google" },
                     { key: "tt", name: "TikTok" }];
var SOC_SCHEDULED = "Programat";
var SOC_MANUAL = "Manual";
var SOC_PUBLISHED = "Publicat";
var SOC_DONE = "Făcut";
var SOC_SKIPPED = "Sărit";
var SOC_STATUSES = [SOC_SCHEDULED, SOC_MANUAL, SOC_PUBLISHED, SOC_DONE, SOC_SKIPPED];
var SOC_REMIND_BEFORE_MIN = 60;    // prima amintire: cu o oră înainte de ora postării
var SOC_REMIND_AGAIN_MIN = 60;     // a doua: la o oră după, dacă nu ai marcat nimic
var SOC_PUSH_UNTIL_MIN = 180;      // după 3 ore nu mai vin amintiri pe Telegram (rămâne la „De făcut” și în rezumat)
var SOC_SNOOZE_MIN = 30;
var SOC_PUBLISHED_AFTER_MIN = 10;  // „Programat” → „Publicat” la 10 minute după oră
var SOC_PENDING_DAYS = 7;          // ce n-ai marcat stă la „De făcut” cel mult 7 zile
var SOC_PANEL_PAST_DAYS = 21;      // panoul arată postările din ultimele 3 săptămâni + toate cele viitoare
var SOC_EMPTY_DAYS = 7;            // „nimic programat în următoarele 7 zile”
var SOC_BOOKED_CACHE_SEC = 300;
var SOC_ALBUM_MAX = 10;            // limita Telegram pentru un album
var SOC_LINKS = {
  meta: "https://business.facebook.com/latest/",
  google: "https://www.google.com/local/business/2493792545162761927/promote/updates",
  tiktok: "https://www.tiktok.com/@a13.travelconcept"
};

/* ============================== INSTALARE ============================== */

// O dată, din editor: foaia „Postări” (liste pe coloanele platformelor, culori, note pe antete) + primele postări
// (cele 6 de pe Facebook / Instagram din 8–22.11.2026, 4 și pe Google, TikTok la toate). Se poate rula din nou:
// nu dublează rândurile (după ID) și nu atinge ce ai scris deja.
function postariInstall() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ciEnsureSheet(ss, SOC_SHEET, SOC_HEADERS);
  socFormatSheet(sh);
  var added = socImport(ss, socStartPosts());
  console.log("Foaia „" + SOC_SHEET + "” e gata. Rânduri noi: " + added + ".");
}

function socFormatSheet(sh) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  function col(h) { return header.indexOf(h) + 1; }
  var list = SpreadsheetApp.newDataValidation().requireValueInList(SOC_STATUSES, true).setAllowInvalid(false)
    .setHelpText("Programat = pleacă singură · Manual = o faci tu (primești amintire) · Publicat / Făcut / Sărit · gol = nu se postează aici").build();
  SOC_PLATFORMS.forEach(function (pf) { sh.getRange(2, col(pf.name), rows, 1).setDataValidation(list); });
  SOC_TEXT_COLS.forEach(function (h) { sh.getRange(2, col(h), rows, 1).setNumberFormat("@"); });
  ["Descriere TikTok", "Text pe prima poză", "Poze", "Note"].forEach(function (h) { sh.getRange(2, col(h), rows, 1).setWrap(true); });
  var widths = { "ID": 150, "Data": 95, "Ora": 55, "Temă": 230, "Facebook": 95, "Instagram": 95, "Google": 95, "TikTok": 95,
                 "Descriere TikTok": 300, "Text pe prima poză": 200, "Poze": 260, "Nopți libere de la": 110,
                 "Ultima noapte promisă": 120, "Link TikTok": 200, "Note": 260, "Alerte": 160 };
  Object.keys(widths).forEach(function (h) { if (col(h)) sh.setColumnWidth(col(h), widths[h]); });
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setVerticalAlignment("middle");
  sh.setFrozenRows(1);
  var notes = {
    "ID": "Îl pune scriptul dacă e gol. Nu-l schimba după ce postarea a primit amintiri (butoanele din Telegram îl folosesc).",
    "Data": "AAAA-LL-ZZ, de exemplu 2026-11-20.",
    "Ora": "HH:MM, de exemplu 19:00 (ora postării programate).",
    "Facebook": "Programat = pleacă singură (Business Suite / profilul Google) și devine Publicat la ora ei.\n" +
                "Manual = o faci tu: amintire pe Telegram cu o oră înainte și încă una la o oră după.\n" +
                "Făcut / Sărit = marcat de tine. Gol = nu se postează aici.",
    "Descriere TikTok": "Textul pe care îl lipești în TikTok (vine în amintirea de pe Telegram, gata de copiat).",
    "Poze": "Câte una pe rând: calea de pe site (images/living/01-….jpg) sau adresa completă. Vin ca album în amintire.",
    "Nopți libere de la": "Doar pentru postările care spun că anumite nopți sunt libere: prima noapte promisă (AAAA-LL-ZZ).",
    "Ultima noapte promisă": "Ultima noapte din perioada promisă (inclusiv). Dacă se ocupă vreuna, primești alertă să modifici postarea.",
    "Alerte": "Le scrie scriptul (amintiri trimise, ore). Nu se editează."
  };
  Object.keys(notes).forEach(function (h) { if (col(h)) sh.getRange(1, col(h)).setNote(notes[h]); });
  var first = col(SOC_PLATFORMS[0].name), span = SOC_PLATFORMS.length;
  var target = sh.getRange(2, first, rows, span);
  var colors = [[SOC_PUBLISHED, "#e9f6ea", "#0b6b1a"], [SOC_DONE, "#e9f6ea", "#0b6b1a"], [SOC_MANUAL, "#fff6d9", "#7a5800"],
                [SOC_SCHEDULED, "#eef5fc", "#003580"], [SOC_SKIPPED, "#efefef", "#6b6b6b"]];
  var keep = sh.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (g) { return g.getColumn() === first && g.getNumColumns() === span; });
  });
  sh.setConditionalFormatRules(keep.concat(colors.map(function (c) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c[0]).setBackground(c[1]).setFontColor(c[2]).setRanges([target]).build();
  })));
}

// Adaugă la final rândurile cu ID-uri care nu există încă. Întoarce câte a adăugat.
function socImport(ss, list) {
  var sh = ciEnsureSheet(ss, SOC_SHEET, SOC_HEADERS);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var have = {};
  socLoad(ss).posts.forEach(function (p) { if (p.id) have[p.id] = 1; });
  var rows = list.filter(function (p) { return !have[p["ID"]]; }).map(function (p) {
    return header.map(function (h) {
      var v = p[h] == null ? "" : p[h];
      return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v;
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  return rows.length;
}

// Primele postări (programate de Claude pe 07.11.2026 în Business Suite și pe profilul Google; TikTok din aplicație).
function socStartPosts() {
  var P = "images/", L = P + "living/", DM = P + "dormitor-mare/", Dm = P + "dormitor-mic/", T = P + "terasa-living/";
  function post(id, date, title, google, photos, hook, tt, extra) {
    var o = { "ID": id, "Data": date, "Ora": "19:00", "Temă": title, "Facebook": SOC_SCHEDULED, "Instagram": SOC_SCHEDULED,
              "Google": google ? SOC_SCHEDULED : "", "TikTok": SOC_MANUAL, "Descriere TikTok": tt, "Text pe prima poză": hook,
              "Poze": photos.join("\n") };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  return [
    post("20261108-bun-venit", "2026-11-08", "Bun venit la A13", true,
      ["hero-apartament.jpg", T + "01-terasa-living-vedere-padure-brazi-a13-poiana-brasov.jpg",
       DM + "01-dormitor-mare-pat-dublu-fereastra-padure-a13-poiana-brasov.jpg", Dm + "02-dormitor-mic-pat-matrimonial-tablou-a13-poiana-brasov.jpg",
       P + "baie-dormitor-mare/01-baie-dormitor-mare-cada-lavoar-a13-poiana-brasov.jpg",
       L + "03-bucatarie-utilata-espressor-plita-cuptor-a13-poiana-brasov.jpg", L + "02-living-open-space-bucatarie-scara-a13-poiana-brasov.jpg"],
      "Apartamentul nostru din Poiana Brașov 🌲",
      "Duplex pentru 4 în Silver Mountain: șemineu, terasă spre pădure, 2 dormitoare cu baie proprie. Rezervi direct, fără comision: a13.travelconcept.ro #poianabrasov #brasov #munte #cazare #romania",
      { "Note": "După publicare o poți fixa sus pe profil (Pin)." }),
    post("20261111-sarbatori", "2026-11-11", "Crăciun și Revelion la munte", true,
      ["hero-apartament.jpg", L + "01-living-semineu-canapea-fotolii-a13-poiana-brasov.jpg", L + "02-living-open-space-bucatarie-scara-a13-poiana-brasov.jpg",
       DM + "02-dormitor-mare-pat-tv-birou-usa-balcon-a13-poiana-brasov.jpg", L + "03-bucatarie-utilata-espressor-plita-cuptor-a13-poiana-brasov.jpg"],
      "Revelion la munte? Încă e liber 🎆",
      "Crăciun 21–27 dec. (min. 3 nopți) și Revelion 28 dec. – 4 ian. (min. 5 nopți), încă libere la A13, Silver Mountain, Poiana Brașov. a13.travelconcept.ro #revelion #craciun #poianabrasov #munte #brasov",
      { "Nopți libere de la": "2026-12-21", "Ultima noapte promisă": "2027-01-04",
        "Note": "Spune că sărbătorile sunt libere: dacă se ocupă, vine alertă să modifici textul." }),
    post("20261113-semineu", "2026-11-13", "Seara la șemineu", false,
      [L + "01-living-semineu-canapea-fotolii-a13-poiana-brasov.jpg", "hero-apartament.jpg",
       L + "02-living-open-space-bucatarie-scara-a13-poiana-brasov.jpg", L + "03-bucatarie-utilata-espressor-plita-cuptor-a13-poiana-brasov.jpg"],
      "Ziua pe pârtie, seara la șemineu 🔥",
      "Șemineu pe lemne, canapea, brazi pe fereastră. A13, Silver Mountain, Poiana Brașov. a13.travelconcept.ro #poianabrasov #semineu #munte #iarna #brasov"),
    post("20261116-dormitoare", "2026-11-16", "Două dormitoare, două băi", true,
      [DM + "01-dormitor-mare-pat-dublu-fereastra-padure-a13-poiana-brasov.jpg", DM + "03-dormitor-mare-pat-dublu-baie-proprie-a13-poiana-brasov.jpg",
       P + "baie-dormitor-mare/01-baie-dormitor-mare-cada-lavoar-a13-poiana-brasov.jpg", Dm + "01-dormitor-mic-pat-dublu-usa-balcon-a13-poiana-brasov.jpg",
       Dm + "02-dormitor-mic-pat-matrimonial-tablou-a13-poiana-brasov.jpg", P + "baie-dormitor-mic/01-baie-dormitor-mic-cabina-dus-a13-poiana-brasov.jpg",
       P + "balcon-dormitoare/01-balcon-inchis-dormitoare-vedere-padure-a13-poiana-brasov.jpg"],
      "2 dormitoare, 2 băi, 4 prieteni",
      "Fiecare dormitor cu baia lui: bun pentru două cupluri sau o familie de 4. Reducere de la 15% la 3 nopți (în afara sărbătorilor). a13.travelconcept.ro #poianabrasov #vacanta #munte #cazare #brasov",
      { "Note": "Scrie reducerile (15% la 3 nopți … 30% la 7): dacă se schimbă scara, modifică textul." }),
    post("20261119-terasa", "2026-11-19", "Terasa și complexul Silver Mountain", false,
      [T + "01-terasa-living-vedere-padure-brazi-a13-poiana-brasov.jpg", T + "02-terasa-living-fotolii-masa-umbrela-a13-poiana-brasov.jpg",
       P + "balcon-dormitoare/01-balcon-inchis-dormitoare-vedere-padure-a13-poiana-brasov.jpg"],
      "Ieși din living direct în pădure 🌲",
      "Terasă spre pădure, în complexul Silver Mountain din Poiana Brașov (filmat vara). a13.travelconcept.ro #poianabrasov #padure #munte #brasov #romania"),
    post("20261122-sosire", "2026-11-22", "Sosire fără chei", true,
      [L + "02-living-open-space-bucatarie-scara-a13-poiana-brasov.jpg", Dm + "02-dormitor-mic-pat-matrimonial-tablou-a13-poiana-brasov.jpg",
       DM + "01-dormitor-mare-pat-dublu-fereastra-padure-a13-poiana-brasov.jpg",
       P + "baie-dormitor-mare/02-baie-dormitor-mare-cada-toaleta-suspendata-a13-poiana-brasov.jpg"],
      "Check-in fără chei 🔑",
      "Primești un cod personal pentru ușă și intri când ajungi, după 16:00. A13, Silver Mountain, Poiana Brașov. a13.travelconcept.ro #poianabrasov #selfcheckin #munte #cazare #brasov"),
    { "ID": "20261110-tiktok-2fa", "Data": "2026-11-10", "Ora": "10:00", "Temă": "Pornește verificarea în doi pași pe TikTok",
      "TikTok": SOC_MANUAL, "Note": "În aplicația TikTok: Profil → ☰ → Setări și confidențialitate → Securitate → Verificare în 2 pași." },
    { "ID": "20261124-facebook-nume", "Data": "2026-11-24", "Ora": "10:00", "Temă": "Numele scurt al Paginii Facebook: a13.travelconcept",
      "Facebook": SOC_MANUAL, "Note": "Din setările Paginii → Nume de utilizator (merge după primele postări). Apoi spune-i lui Claude, ca să pună linkul pe site." }
  ];
}

/* ============================== CITIRE / SCRIERE ============================== */

// { sheet, header, col, posts } — null sheet dacă foaia nu există (postari.gs neinstalat).
function socLoad(ss) {
  var sh = ss.getSheetByName(SOC_SHEET);
  if (!sh || sh.getLastRow() < 2 || !sh.getLastColumn()) return { sheet: sh, header: [], col: {}, posts: [] };
  var width = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  var range = sh.getRange(2, 1, sh.getLastRow() - 1, width);
  var values = range.getValues(), shown = range.getDisplayValues();
  var posts = [];
  values.forEach(function (v, i) {
    if (v.every(function (x) { return x === "" || x == null; })) return;
    posts.push(socParse(header, v, shown[i], i + 2));
  });
  return { sheet: sh, header: header, col: ciHeaderIndex(header), posts: posts };
}

function socParse(header, v, shown, rowNum) {
  var raw = {}, disp = {};
  header.forEach(function (h, k) { raw[h] = v[k]; disp[h] = String(shown[k] == null ? "" : shown[k]).trim(); });
  function txt(h) { return disp[h] || ""; }
  var p = {
    row: rowNum,
    id: txt("ID"),
    date: socIso(raw["Data"]),
    time: socHm(txt("Ora")),
    title: txt("Temă") || "(fără temă)",
    st: {},
    ttText: txt("Descriere TikTok"),
    hook: txt("Text pe prima poză"),
    photos: socPhotos(txt("Poze")),
    from: socIso(raw["Nopți libere de la"]),
    last: socIso(raw["Ultima noapte promisă"]),
    link: txt("Link TikTok"),
    note: txt("Note"),
    flags: txt("Alerte")
  };
  SOC_PLATFORMS.forEach(function (pf) { p.st[pf.key] = socStatus(txt(pf.name)); });
  p.at = p.date && p.time ? ciAt(p.date, Number(p.time.slice(0, 2))) + Number(p.time.slice(3, 5)) * 60000 : null;
  p.isTask = !p.ttText && !p.photos.length && !SOC_PLATFORMS.some(function (pf) {
    return p.st[pf.key] === SOC_SCHEDULED || p.st[pf.key] === SOC_PUBLISHED;
  });
  return p;
}

function socIso(v) {
  var s = ciIso(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// „19:00”, „7:05”, „19.00”, „19:00:00”, „7:00 PM” → „19:00” (gol dacă nu se înțelege)
function socHm(s) {
  var m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(s || "").trim());
  if (!m) return "";
  var h = Number(m[1]), min = Number(m[2]);
  if (m[3]) { var pm = /p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return "";
  return ciPad(h) + ":" + ciPad(min);
}

// Starea scrisă de mână, fără grijă la diacritice / litere mari. Necunoscută → gol (nu se postează acolo).
function socStatus(s) {
  var k = socFold(s);
  for (var i = 0; i < SOC_STATUSES.length; i++) if (socFold(SOC_STATUSES[i]) === k) return SOC_STATUSES[i];
  return "";
}

function socFold(s) {
  return String(s || "").toLowerCase().trim().replace(/[ăâ]/g, "a").replace(/î/g, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
}

function socPhotos(s) {
  return String(s || "").split(/[\n;]+/).map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    return /^https:\/\//i.test(x) ? x : /^[\w.\-\/]+\.(jpe?g|png|webp)$/i.test(x) ? SITE_URL + x.replace(/^\/+/, "") : "";
  }).filter(Boolean).slice(0, SOC_ALBUM_MAX);
}

function socSet(L, p, header, value) {
  var c = L.col[header];
  if (c == null) return;
  L.sheet.getRange(p.row, c + 1).setValue(value);
}

function socSetStatus(L, p, pf, status) {
  socSet(L, p, pf.name, status);
  p.st[pf.key] = status;
}

/* ---------- coloana „Alerte” (ce s-a trimis deja) ---------- */

function socHas(p, key) { return (";" + p.flags + ";").indexOf(";" + key + ";") >= 0; }

// Valoarea unui marcaj „prefix…” (ex. „z:” → ora până la care e amânată amintirea), null dacă lipsește.
function socFlagValue(p, prefix) {
  var parts = p.flags ? p.flags.split(";") : [];
  for (var i = 0; i < parts.length; i++) if (parts[i].indexOf(prefix) === 0) return parts[i].slice(prefix.length);
  return null;
}

function socWriteFlags(L, p, parts) {
  p.flags = parts.filter(Boolean).join(";");
  socSet(L, p, "Alerte", p.flags);
}

function socFlag(L, p, key) {
  if (socHas(p, key)) return;
  socWriteFlags(L, p, (p.flags ? p.flags.split(";") : []).concat([key]));
}

function socUnflag(L, p, prefix) {
  var parts = p.flags ? p.flags.split(";") : [];
  var keep = parts.filter(function (x) { return x !== prefix && x.indexOf(prefix) !== 0; });
  if (keep.length !== parts.length) socWriteFlags(L, p, keep);
}

function socSetFlagValue(L, p, prefix, value) {
  var parts = (p.flags ? p.flags.split(";") : []).filter(function (x) { return x.indexOf(prefix) !== 0; });
  parts.push(prefix + value);
  socWriteFlags(L, p, parts);
}

// ID-ul din butoanele Telegram / panou: cel din foaie, sau „#rând” dacă nu se poate folosi (prea lung, cu „:”).
function socRef(p) { return p.id && p.id.length <= 40 && /^[\w.\-]+$/.test(p.id) ? p.id : "#" + p.row; }

function socFind(L, ref) {
  ref = String(ref || "");
  var m = /^#(\d+)$/.exec(ref);
  return L.posts.filter(function (p) { return m ? p.row === Number(m[1]) : p.id === ref; })[0] || null;
}

// Postările fără ID primesc unul (data + ora + numărul rândului dacă e nevoie).
function socEnsureIds(L) {
  var used = {};
  L.posts.forEach(function (p) { if (p.id) used[p.id] = 1; });
  L.posts.forEach(function (p) {
    if (p.id || !p.date) return;
    var base = p.date.replace(/-/g, "") + "-" + (p.time || "0000").replace(":", ""), id = base, n = 2;
    while (used[id]) id = base + "-" + n++;
    used[id] = 1;
    p.id = id;
    socSet(L, p, "ID", id);
  });
}

/* ============================== SINCRONIZAREA (la 10 minute) ============================== */

function socSync(ctx) {
  var L = socLoad(ctx.ss || SpreadsheetApp.getActiveSpreadsheet());
  if (!L.sheet || !L.posts.length) return;
  socEnsureIds(L);
  L.posts.forEach(function (p) {
    if (!p.at) return;
    var pub = [];
    SOC_PLATFORMS.forEach(function (pf) {
      if (p.st[pf.key] === SOC_SCHEDULED && ctx.now >= p.at + SOC_PUBLISHED_AFTER_MIN * 60000) {
        socSetStatus(L, p, pf, SOC_PUBLISHED);
        pub.push(pf.name);
      }
    });
    if (pub.length) ciLog(ctx, "Postare publicată", "", "«" + p.title + "» · " + pub.join(", ") + " · " + socWhen(p, ctx.now));
    socRemind(ctx, L, p);
  });
  try {
    socClaims(ctx, L);
  } catch (e) {
    console.warn("Postări · nopți promise: " + (e && e.message || e));   // site-ul are propria supraveghere (calSiteHealth)
  }
}

// Platformele încă de făcut de tine (Manual).
function socPending(p) {
  return SOC_PLATFORMS.filter(function (pf) { return p.st[pf.key] === SOC_MANUAL; });
}

function socRemind(ctx, L, p) {
  var pend = socPending(p), now = ctx.now;
  if (!pend.length || now > p.at + SOC_PENDING_DAYS * 86400000) return;
  var z = socFlagValue(p, "z:");
  if (z != null) {
    if (now >= Number(z)) {
      socUnflag(L, p, "z:");
      socSendReminder(p, pend, "snooze", now);
    }
    return;
  }
  var inWindow = now >= p.at - SOC_REMIND_BEFORE_MIN * 60000 && now <= p.at + SOC_PUSH_UNTIL_MIN * 60000;
  if (!socHas(p, "r1")) {
    if (inWindow && socSendReminder(p, pend, "first", now)) socFlag(L, p, "r1");
    return;
  }
  if (!socHas(p, "r2") && inWindow && now >= p.at + SOC_REMIND_AGAIN_MIN * 60000 && socSendReminder(p, pend, "again", now)) {
    socFlag(L, p, "r2");
  }
}

/* ---------- mesajele de pe Telegram ---------- */

// kind: first (cu o oră înainte, cu pozele) / again (la o oră după) / snooze (după „Amintește-mi în 30 min”).
// Întoarce true dacă s-a încercat trimiterea (Telegram configurat), ca amintirea să nu se repete la fiecare rulare.
function socSendReminder(p, pend, kind, now) {
  if (typeof tgReady !== "function" || !tgReady()) return false;
  var tt = pend.some(function (pf) { return pf.key === "tt"; });
  if (kind === "first" && tt && p.photos.length) {
    try {   // un album are 2–10 poze; o singură poză pleacă simplu
      if (p.photos.length === 1) tgApi("sendPhoto", { chat_id: socChat(), photo: p.photos[0], disable_notification: true });
      else tgApi("sendMediaGroup", { chat_id: socChat(), disable_notification: true,
        media: p.photos.map(function (u) { return { type: "photo", media: u }; }) });
    } catch (e) {
      console.warn("Postări · album: " + tgClean(e));
    }
  }
  try {
    socTgSend(socReminderHtml(p, pend, kind, now), socReminderKeyboard(p, pend), true);
  } catch (e) {
    console.warn("Postări · amintire: " + tgClean(e));
  }
  return true;
}

function socReminderHtml(p, pend, kind, now) {
  var names = socJoin(pend.map(function (pf) { return pf.name; }));
  var auto = SOC_PLATFORMS.filter(function (pf) { return p.st[pf.key] === SOC_SCHEDULED || p.st[pf.key] === SOC_PUBLISHED; })
    .map(function (pf) { return pf.name; });
  var lines = [];
  if (p.isTask) {
    lines.push("🔔 <b>De făcut: " + tgEsc(p.title) + "</b>");
    lines.push(tgEsc(socWhen(p, now)) + (kind === "again" ? " · încă nemarcat" : ""));
    if (p.note) lines.push(tgEsc(p.note));
  } else {
    var mins = Math.round((p.at - now) / 60000);
    lines.push("📣 <b>" + (mins > 0 ? "Peste " + mins + " min, la " + p.time + ": " : "") + "«" + tgEsc(p.title) + "»</b>" +
               (mins > 0 ? "" : " · " + tgEsc(socWhen(p, now))));
    if (auto.length) lines.push(tgEsc(socJoin(auto)) + (mins > 0 ? " pleacă singure." : " au plecat singure."));
    lines.push("👉 <b>" + tgEsc(names) + "</b> e la tine" + (mins > -30
      ? ": postează între " + socClock(p.at - 15 * 60000) + " și " + socClock(p.at + 30 * 60000) + "."
      : ": postează când poți." + (kind === "again" ? " Încă nu l-ai marcat." : "")));
    if (pend.some(function (pf) { return pf.key === "tt"; })) {
      if (p.photos.length) {
        lines.push(kind === "first"
          ? "🖼️ Pozele (" + p.photos.length + ") sunt în albumul de mai sus: atinge o poză → ⋮ → Salvează în galerie; în TikTok alegi Foto."
          : "🖼️ Pozele sunt în albumul trimis la " + socClock(p.at - SOC_REMIND_BEFORE_MIN * 60000) + ".");
      }
      if (p.hook) lines.push("Text pe prima poză:\n<pre><code class=\"language-Poza\">" + tgEsc(p.hook) + "</code></pre>");
      if (p.ttText) lines.push("Descriere TikTok — atinge textul ca să-l copiezi:\n<pre><code class=\"language-TikTok\">" + tgEsc(p.ttText) + "</code></pre>");
      lines.push("Înainte de Postează: Mai multe opțiuni → Dezvăluie conținutul → Marca ta.");
    }
    if (p.note && kind === "first") lines.push("📝 " + tgEsc(p.note));
  }
  return lines.join("\n");
}

function socReminderKeyboard(p, pend) {
  var ref = socRef(p), kb = [], row = [];
  pend.forEach(function (pf) {
    row.push({ text: (p.isTask ? "Făcut" : "Am postat pe " + pf.name) + (p.isTask && pend.length > 1 ? " · " + pf.name : ""),
               callback_data: "sp:d:" + ref + ":" + pf.key });
    if (row.length === 2) { kb.push(row); row = []; }
  });
  if (row.length) kb.push(row);
  kb.push([{ text: "Amintește-mi în " + SOC_SNOOZE_MIN + " min", callback_data: "sp:z:" + ref },
           { text: p.isTask ? "Sar peste" : "Nu postez", callback_data: "sp:s:" + ref }]);
  var links = [];
  if (pend.some(function (pf) { return pf.key === "tt"; }) && !p.isTask) links.push({ text: "Deschide TikTok", url: SOC_LINKS.tiktok });
  var panel = PropertiesService.getScriptProperties().getProperty(TG_PANEL_PROPERTY);
  if (panel && /^https:\/\//.test(panel)) links.push({ text: "Panou", url: panel });
  if (links.length) kb.push(links);
  return kb;
}

function socChat() { return PropertiesService.getScriptProperties().getProperty(TG_CHAT_PROPERTY); }

// Mesaj cu butoane de răspuns (callback) și/sau linkuri. Aruncă eroare dacă Telegram refuză.
function socTgSend(html, keyboard, sound) {
  var payload = { chat_id: socChat(), text: html, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: !sound };
  if (keyboard && keyboard.length) payload.reply_markup = { inline_keyboard: keyboard };
  try {
    return tgApi("sendMessage", payload);
  } catch (e) {
    payload.text = tgPlain(html).slice(0, TG_MAX_CHARS);   // HTML respins: același text, simplu
    delete payload.parse_mode;
    return tgApi("sendMessage", payload);
  }
}

/* ============================== ACȚIUNI (Telegram, panou) ============================== */

// action: done / skip / undo / snooze / claimok. pfKey: fb / ig / gb / tt (la skip, gol = tot ce e de făcut).
// Întoarce { post, toast, reply } sau aruncă o eroare cu un text de arătat.
function socAction(ref, pfKey, action, via) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Sincronizarea automată rulează chiar acum. Încearcă din nou peste un minut.");
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var L = socLoad(ss), p = socFind(L, ref), now = new Date().getTime();
    if (!p) throw new Error("Nu mai găsesc postarea în foaia „" + SOC_SHEET + "”.");
    var pf = SOC_PLATFORMS.filter(function (x) { return x.key === pfKey; })[0] || null;
    var ctx = { ss: ss, events: [] }, out = { post: p, toast: "", reply: "" };
    if (action === "done") {
      if (!pf) throw new Error("Platformă necunoscută.");
      if (p.st[pf.key] === SOC_DONE) { out.toast = pf.name + ": era deja marcat."; return out; }
      if (p.st[pf.key] !== SOC_MANUAL) throw new Error(pf.name + " nu e de făcut la această postare (" + (p.st[pf.key] || "gol") + ").");
      socSetStatus(L, p, pf, SOC_DONE);
      socSetFlagValue(L, p, "t:" + pf.key + ":", String(now));
      if (!socPending(p).length) socUnflag(L, p, "z:");
      ciLog(ctx, p.isTask ? "Sarcină făcută" : "Postare făcută: " + pf.name, "", "«" + p.title + "» (din " + via + ")");
      out.toast = p.isTask ? "Notat: făcut" : "Notat: " + pf.name + " postat";
      if (pf.key === "tt" && !p.isTask && !p.link) {
        out.reply = "✅ Am notat <b>TikTok</b> la «" + tgEsc(p.title) + "» (" + socClock(now) + ").\n" +
                    "Dacă vrei, lipește aici linkul postării TikTok și îl pun în foaie.";
      }
    } else if (action === "skip") {
      var list = pf ? [pf] : socPending(p);
      list = list.filter(function (x) { return p.st[x.key] === SOC_MANUAL; });
      if (!list.length) { out.toast = "Nimic de sărit."; return out; }
      list.forEach(function (x) { socSetStatus(L, p, x, SOC_SKIPPED); socSetFlagValue(L, p, "t:" + x.key + ":", String(now)); });
      socUnflag(L, p, "z:");
      ciLog(ctx, p.isTask ? "Sarcină sărită" : "Postare sărită: " + socJoin(list.map(function (x) { return x.name; })), "",
            "«" + p.title + "» (din " + via + ")");
      out.toast = "Notat: sărit";
    } else if (action === "undo") {
      if (!pf || (p.st[pf.key] !== SOC_DONE && p.st[pf.key] !== SOC_SKIPPED)) throw new Error("Nu e nimic de refăcut aici.");
      socSetStatus(L, p, pf, SOC_MANUAL);
      socUnflag(L, p, "t:" + pf.key + ":");
      ciLog(ctx, "Postare marcată ca nefăcută: " + pf.name, "", "«" + p.title + "» (din " + via + ")");
      out.toast = pf.name + ": de făcut din nou";
    } else if (action === "snooze") {
      if (!socPending(p).length) { out.toast = "E deja marcat."; return out; }
      var until = now + SOC_SNOOZE_MIN * 60000;
      socSetFlagValue(L, p, "z:", String(until));
      out.toast = "Îți amintesc la " + socClock(until);
    } else if (action === "claimok") {
      socUnflag(L, p, "claim");
      ciLog(ctx, "Postare modificată (nopți ocupate)", "", "«" + p.title + "» (din " + via + ")");
      out.toast = "Notat: postare modificată";
    } else {
      throw new Error("Acțiune necunoscută.");
    }
    if (ctx.events.length) ciAppendLog(ctx);
    SpreadsheetApp.flush();
    return out;
  } finally {
    lock.releaseLock();
  }
}

// Din finTgCallback (fin-telegram.gs): butoanele „sp:<acțiune>:<postare>[:<platformă>]”.
function socTgCallback(cb, parts) {
  var act = { d: "done", s: "skip", z: "snooze", c: "claimok" }[parts[0]] || "";
  var chatId = cb.message && cb.message.chat && cb.message.chat.id, msgId = cb.message && cb.message.message_id;
  var res;
  try {
    res = socAction(parts[1], parts[2] || "", act, "Telegram");
  } catch (e) {
    finTgAnswer(cb.id, String(e && e.message || e).slice(0, 190));
    return;
  }
  finTgAnswer(cb.id, res.toast);
  var p = res.post, pend = act === "claimok" ? [] : socPending(p);
  if (act !== "snooze" && chatId && msgId) {   // butoanele rămase pe mesaj: doar platformele încă de făcut
    try {
      tgApi("editMessageReplyMarkup", { chat_id: chatId, message_id: msgId,
                                        reply_markup: { inline_keyboard: pend.length ? socReminderKeyboard(p, pend) : [] } });
    } catch (e) {}
  }
  if (res.reply) { try { socTgSend(res.reply, null, false); } catch (e) {} }
}

// Din finTgMessage: un link tiktok.com lipit în chat → coloana „Link TikTok” a postării recente (și TikTok = Făcut).
function socTgLink(text) {
  var m = /https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/\S+/i.exec(text);
  if (!m) return finTgSend("Nu am găsit linkul TikTok în mesaj.");
  var url = m[0].replace(/[).,;]+$/, "");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return finTgSend("Sincronizarea automată rulează chiar acum. Trimite linkul din nou peste un minut.");
  var msg;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), L = socLoad(ss), now = new Date().getTime();
    var cands = L.posts.filter(function (p) {
      return p.at && !p.isTask && !p.link && (p.st.tt === SOC_DONE || p.st.tt === SOC_MANUAL) &&
             p.at >= now - SOC_PENDING_DAYS * 86400000 && p.at <= now + 3 * 3600000;
    }).sort(function (a, b) { return Math.abs(now - a.at) - Math.abs(now - b.at); });
    var p = cands[0];
    if (!p) {
      msg = "Nu găsesc o postare TikTok recentă fără link. Pune-l direct în foaia „" + SOC_SHEET + "”, coloana „Link TikTok”.";
    } else {
      var ctx = { ss: ss, events: [] };
      socSet(L, p, "Link TikTok", url);
      if (p.st.tt === SOC_MANUAL) {
        socSetStatus(L, p, SOC_PLATFORMS[3], SOC_DONE);
        socSetFlagValue(L, p, "t:tt:", String(now));
        if (!socPending(p).length) socUnflag(L, p, "z:");
        ciLog(ctx, "Postare făcută: TikTok", "", "«" + p.title + "» (link din Telegram)");
      }
      ciLog(ctx, "Link TikTok salvat", "", "«" + p.title + "»: " + url);
      ciAppendLog(ctx);
      SpreadsheetApp.flush();
      msg = "🔗 Am pus linkul la «" + tgEsc(p.title) + "» (" + tgEsc(socWhen(p, now)) + ")" + (cands.length > 1
        ? ". Dacă era pentru altă postare, mută-l în foaie." : ".");
    }
  } finally {
    lock.releaseLock();
  }
  return finTgSend(msg);
}

// /postari în chatul botului: ce ai de făcut acum și ce urmează în 14 zile (cu butoanele de marcat).
function socTgList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), now = new Date().getTime();
  var ctx = { now: now, today: Utilities.formatDate(new Date(now), CI_TZ, "yyyy-MM-dd"), dismissed: {} };
  var S = socPanel(ss, ctx);
  if (!S) return finTgSend("Foaia „" + SOC_SHEET + "” nu există încă (în editor: postariInstall).");
  var due = S.posts.filter(function (v) { return v.due; });
  var next = S.posts.filter(function (v) { return v.at && v.at > now && !v.due && v.date <= ciAddDays(ctx.today, 14); });
  var lines = ["📣 <b>Postări</b>"], kb = [];
  if (due.length) {
    lines.push("\n<b>De făcut acum</b>");
    due.forEach(function (v) {
      lines.push("• " + tgEsc(socCap(socWhenView(v, ctx))) + " · «" + tgEsc(v.title) + "» — " +
                 tgEsc(socJoin(v.pending.map(socPfName))) + " la tine");
      v.pending.forEach(function (k) {
        if (kb.length < 6) kb.push([{ text: (v.isTask ? "Făcut" : "Am postat pe " + socPfName(k)) + " · " + v.title.slice(0, 28),
                                     callback_data: "sp:d:" + v.id + ":" + k }]);
      });
    });
    var first = due.filter(function (v) { return v.pending.indexOf("tt") >= 0 && v.ttText; })[0];
    if (first) lines.push("\nDescriere TikTok pentru «" + tgEsc(first.title) + "»:\n<pre><code class=\"language-TikTok\">" + tgEsc(first.ttText) + "</code></pre>");
  }
  lines.push("\n<b>Următoarele 14 zile</b>");
  if (next.length) {
    next.forEach(function (v) { lines.push("• " + tgEsc(socCap(socWhenView(v, ctx))) + " · «" + tgEsc(v.title) + "» — " + tgEsc(socWho(v))); });
  } else {
    lines.push("Nimic programat.");
  }
  if (S.emptySoon) lines.push("\n⚠️ Nimic programat în următoarele " + SOC_EMPTY_DAYS + " zile.");
  kb.push([{ text: "Foaia „" + SOC_SHEET + "”", url: S.sheetUrl }]);
  return finTgSend(lines.join("\n"), kb);
}

/* ============================== NOPȚILE PROMISE ============================== */

// Postările cu „Nopți libere de la / Ultima noapte promisă”, până la prima noapte promisă: o rezervare sau o blocare
// NOUĂ (față de ultima verificare, marcajul „occ:”) pe nopțile promise → alertă o dată + „De făcut” până la „Am modificat”.
function socClaims(ctx, L) {
  var list = L.posts.filter(function (p) { return socClaimActive(ctx, p); });
  if (!list.length) return;
  var booked = socBookedNights(ctx.now, false);
  if (!booked) return;
  list.forEach(function (p) {
    var c = socClaimNights(p, booked);
    var key = c.occupied.map(function (iso) { return iso.replace(/-/g, ""); }).join(".");
    var prev = socFlagValue(p, "occ:");
    if (prev === key) return;
    socSetFlagValue(L, p, "occ:", key);
    if (prev == null) return;   // prima verificare: doar se notează ce e ocupat acum
    var before = prev ? prev.split(".") : [];
    var fresh = c.occupied.filter(function (iso) { return before.indexOf(iso.replace(/-/g, "")) < 0; });
    if (!fresh.length) return;  // doar s-au eliberat nopți
    socFlag(L, p, "claim");
    var free = c.total - c.occupied.length;
    ciLog(ctx, "Postare de modificat", "", "«" + p.title + "»: s-au ocupat " + socNightsText(fresh) + "; libere " + free + " din " + c.total);
    if (typeof tgReady === "function" && tgReady()) {
      var html = "⚠️ <b>Postare de modificat: «" + tgEsc(p.title) + "»</b>\n" +
        "Spune că nopțile " + tgEsc(socRangeText(p.from, p.last)) + " sunt libere, dar s-au ocupat: <b>" + tgEsc(socNightsText(fresh)) + "</b>.\n" +
        (free ? "Mai " + (free === 1 ? "e liberă o noapte" : "sunt libere " + free + " nopți") + " din " + c.total + "." : "Perioada e acum ocupată complet.") + "\n\n" +
        socEditHow(p, ctx.now);
      var kb = [[{ text: "Am modificat", callback_data: "sp:c:" + socRef(p) }]];
      var links = socEditLinks(p);
      if (links.length) kb.push(links);
      try { socTgSend(html, kb, true); } catch (e) { console.warn("Postări · alertă: " + tgClean(e)); }
    }
  });
}

function socClaimActive(ctx, p) {
  if (!p.from || !p.last || p.last < p.from || ctx.today >= p.from) return false;
  return SOC_PLATFORMS.some(function (pf) { return p.st[pf.key] && p.st[pf.key] !== SOC_SKIPPED; });
}

function socClaimNights(p, booked) {
  var occupied = [], total = 0;
  for (var iso = p.from; iso <= p.last && total < 400; iso = ciAddDays(iso, 1)) {
    total++;
    if (booked[iso]) occupied.push(iso);
  }
  return { total: total, occupied: occupied };
}

// Unde se modifică: în Business Suite (Facebook / Instagram) și pe profilul Google; înainte de oră = Programate.
function socEditHow(p, now) {
  var meta = ["fb", "ig"].some(function (k) { return p.st[k] && p.st[k] !== SOC_SKIPPED; });
  var google = p.st.gb && p.st.gb !== SOC_SKIPPED;
  var tt = p.st.tt === SOC_DONE;
  var where = [];
  if (meta) where.push("Business Suite → Conținut → " + (p.at && now >= p.at ? "Publicate" : "Programate"));
  if (google) where.push("profilul Google → Postări");
  if (tt) where.push("TikTok (descrierea postării)");
  return where.length ? "Modifică textul în " + socJoin(where) + ", apoi apasă „Am modificat”." : "Modifică textul, apoi apasă „Am modificat”.";
}

function socEditLinks(p) {
  var out = [];
  if (["fb", "ig"].some(function (k) { return p.st[k] && p.st[k] !== SOC_SKIPPED; })) out.push({ text: "Business Suite", url: SOC_LINKS.meta });
  if (p.st.gb && p.st.gb !== SOC_SKIPPED) out.push({ text: "Profilul Google", url: SOC_LINKS.google });
  return out;
}

// Nopțile ocupate din booked-dates.json de pe site ({ "2026-12-21": true, … }), în cache 5 minute; null dacă nu se poate citi.
function socBookedNights(now, force) {
  var cache = CacheService.getScriptCache();
  var hit = force ? null : cache.get("soc_booked");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  try {
    var res = UrlFetchApp.fetch(SITE_URL + "booked-dates.json?t=" + now, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error("HTTP " + res.getResponseCode());
    var data = JSON.parse(res.getContentText()), set = {};
    (data.ranges || []).forEach(function (r) {
      var a = String(r.start || "").slice(0, 10), b = String(r.end || "").slice(0, 10), n = 0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return;
      for (var iso = a; iso < b && n < 800; iso = ciAddDays(iso, 1), n++) set[iso] = true;
    });
    cache.put("soc_booked", JSON.stringify(set), SOC_BOOKED_CACHE_SEC);
    return set;
  } catch (e) {
    console.warn("Postări · booked-dates.json: " + (e && e.message || e));
    return null;
  }
}

/* ============================== PANOU ȘI REZUMAT ============================== */

// Pentru pnBuild (panou.gs): postările din ultimele 3 săptămâni + cele viitoare. null dacă foaia nu există.
function socPanel(ss, ctx) {
  var L = socLoad(ss);
  if (!L.sheet) return null;
  var from = ciAddDays(ctx.today, -SOC_PANEL_PAST_DAYS), booked = null, needBooked = false;
  var list = L.posts.filter(function (p) { return p.date && p.date >= from; });
  list.forEach(function (p) { if (socClaimActive(ctx, p)) needBooked = true; });
  if (needBooked) booked = socBookedNights(ctx.now, false);
  list.sort(function (a, b) { return (a.at || ciAt(a.date, 0)) - (b.at || ciAt(b.date, 0)); });
  var posts = list.map(function (p) { return socView(ctx, p, booked); });
  var horizon = ciAddDays(ctx.today, SOC_EMPTY_DAYS);
  var upcoming = L.posts.filter(function (p) { return p.at && p.at > ctx.now && !p.isTask && socActivePost(p); });
  var lastPlanned = upcoming.reduce(function (m, p) { return p.date > m ? p.date : m; }, "");
  var undated = L.posts.filter(function (p) { return !p.at; }).length;
  return {
    ok: true,
    sheetUrl: ss.getUrl() + "#gid=" + L.sheet.getSheetId(),
    posts: posts,
    emptySoon: !upcoming.some(function (p) { return p.date <= horizon; }),
    lastPlanned: lastPlanned,
    undated: undated,
    pending: posts.filter(function (v) { return v.due; }).length,
    links: SOC_LINKS
  };
}

function socActivePost(p) {
  return SOC_PLATFORMS.some(function (pf) { return p.st[pf.key] && p.st[pf.key] !== SOC_SKIPPED; });
}

function socView(ctx, p, booked) {
  var pend = socPending(p);
  var v = {
    id: socRef(p), date: p.date, time: p.time, at: p.at, title: p.title, note: p.note, isTask: p.isTask,
    ttText: p.ttText, hook: p.hook, photos: p.photos, link: p.link,
    phase: !p.at ? "undated" : p.date === ctx.today ? "today" : p.at < ctx.now ? "past" : "upcoming",
    platforms: SOC_PLATFORMS.filter(function (pf) { return p.st[pf.key]; }).map(function (pf) {
      var t = socFlagValue(p, "t:" + pf.key + ":");
      return { key: pf.key, name: pf.name, st: p.st[pf.key], at: t ? Number(t) : null };
    }),
    pending: pend.map(function (pf) { return pf.key; }),
    // de făcut acum: de la o oră înainte, cel mult 7 zile după
    due: !!(p.at && pend.length && ctx.now >= p.at - SOC_REMIND_BEFORE_MIN * 60000 && ctx.now <= p.at + SOC_PENDING_DAYS * 86400000),
    late: !!(p.at && pend.length && ctx.now > p.at + 30 * 60000),
    claim: null
  };
  if (p.from && p.last && p.last >= p.from) {
    var c = booked ? socClaimNights(p, booked) : null;
    v.claim = { from: p.from, last: p.last, watching: socClaimActive(ctx, p), todo: socHas(p, "claim") && socClaimActive(ctx, p),
                total: c ? c.total : null, free: c ? c.total - c.occupied.length : null,
                occupied: c ? socNightsText(c.occupied) : "", how: socEditHow(p, ctx.now), links: socEditLinks(p) };
  }
  return v;
}

// „De făcut” din panou (și din rezumatul de la 08:00): ce ai de postat, postările de modificat, calendarul gol.
function socTodo(ctx, S) {
  if (!S || !S.ok) return [];
  var out = [];
  S.posts.forEach(function (v) {
    if (v.due) {
      var names = socJoin(v.pending.map(function (k) { return socPfName(k); }));
      var auto = v.platforms.filter(function (x) { return x.st === SOC_SCHEDULED || x.st === SOC_PUBLISHED; }).map(function (x) { return x.name; });
      var detail = (v.at < ctx.now ? "Trebuia " + socWhenView(v, ctx) : socCap(socWhenView(v, ctx))) + ".";
      if (v.isTask) detail += v.note ? " " + v.note : "";
      else if (auto.length) detail += " " + socJoin(auto) + (v.at > ctx.now ? " pleacă singure." : " au plecat singure.");
      var item = { id: "soc|" + v.id, kind: "social", level: v.late || v.phase === "today" ? "high" : "normal",
        title: v.isTask ? "De făcut: " + v.title : names + " de postat: «" + v.title + "»",
        detail: detail, nr: "", texts: [], links: [], soc: { id: v.id, pending: v.pending, isTask: v.isTask } };
      if (!v.isTask && v.pending.indexOf("tt") >= 0) {
        if (v.hook) item.texts.push({ label: "Text pe prima poză", text: v.hook });
        if (v.ttText) item.texts.push({ label: "Descriere TikTok", text: v.ttText });
        item.links.push({ label: "Deschide TikTok", href: SOC_LINKS.tiktok });
      }
      out.push(item);
    }
    if (v.claim && v.claim.todo) {
      out.push({ id: "soc|claim|" + v.id + "|" + v.claim.occupied, kind: "alert", level: "high",
        title: "Postare de modificat: «" + v.title + "»",
        detail: "Promite nopțile " + socRangeText(v.claim.from, v.claim.last) + ", dar s-au ocupat: " + (v.claim.occupied || "câteva") +
                (v.claim.free != null ? " (libere " + v.claim.free + " din " + v.claim.total + ")" : "") + ". " + v.claim.how,
        nr: "", texts: [], links: v.claim.links.map(function (l) { return { label: l.text, href: l.url }; }),
        soc: { id: v.id, claim: true } });
    }
  });
  if (S.emptySoon) {
    out.push({ id: "soc|gol|" + socWeekStart(ctx.today), kind: "social", level: "normal",
      title: "Nicio postare în următoarele " + SOC_EMPTY_DAYS + " zile",
      detail: (S.lastPlanned ? "Ultima programată: " + socDm(S.lastPlanned) + ". " : "") +
              "Spune-i lui Claude ce vrei să postezi (o programează în Business Suite și pe Google și pune rândul aici) sau adaugă tu un rând în foaia „" + SOC_SHEET + "”.",
      nr: "", texts: [], links: [{ label: "Foaia „" + SOC_SHEET + "”", href: S.sheetUrl }] });
  }
  return out.filter(function (t) { return !ctx.dismissed[t.id]; });
}

// Paragraful 📣 din rezumatul de la 08:00 (telegram.gs). Lunea și bilanțul săptămânii trecute.
function socSummary(d) {
  var S = d.social;
  if (!S || !S.ok) return "";
  var today = d.today, tomorrow = ciAddDays(today, 1), lines = [];
  S.posts.filter(function (v) { return v.date === today || v.date === tomorrow; }).forEach(function (v) {
    lines.push((v.date === today ? "Azi" : "Mâine") + " " + (v.time || "") + " · " + (v.isTask ? tgEsc(v.title) : "«" + tgEsc(v.title) + "»") +
               " — " + tgEsc(socWho(v)));
  });
  if (S.emptySoon) lines.push("⚠️ Nimic programat în următoarele " + SOC_EMPTY_DAYS + " zile" + (S.lastPlanned ? " (ultima: " + socDm(S.lastPlanned) + ")" : "") + ".");
  if (parseDay(today).getUTCDay() === 1) lines = lines.concat(socWeekly(d));
  return lines.length ? "📣 <b>Postări</b>\n" + lines.join("\n") : "";
}

// Bilanțul săptămânii trecute (luni–duminică) + planul săptămânii care începe.
function socWeekly(d) {
  var S = d.social, today = d.today, a = ciAddDays(today, -7), b = ciAddDays(today, -1), out = [];
  var past = S.posts.filter(function (v) { return !v.isTask && v.date >= a && v.date <= b; });
  if (past.length) {
    var per = SOC_PLATFORMS.map(function (pf) {
      var on = past.map(function (v) { return v.platforms.filter(function (x) { return x.key === pf.key; })[0]; }).filter(Boolean);
      if (!on.length) return "";
      // „Programat” cu ora trecută = a plecat (doar sincronizarea n-a apucat să-l treacă pe „Publicat”)
      var ok = on.filter(function (x) { return x.st === SOC_PUBLISHED || x.st === SOC_DONE || x.st === SOC_SCHEDULED; }).length;
      return pf.name + " " + ok + "/" + on.length;
    }).filter(Boolean);
    out.push("📊 Săptămâna trecută (" + socDm(a) + "–" + socDm(b) + "): " + past.length + (past.length === 1 ? " postare" : " postări") + " · " + per.join(" · "));
  } else {
    out.push("📊 Săptămâna trecută (" + socDm(a) + "–" + socDm(b) + "): nicio postare.");
  }
  var since = ciAt(a, 0), until = ciAt(today, 0);
  var reqs = (d.requests || []).filter(function (q) { return q.at >= since && q.at < until; });
  var social = reqs.filter(function (q) { return /facebook|instagram|tiktok|\bfb\b|\big\b/i.test(q.source || ""); });
  out.push("Solicitări de pe site venite din rețele: " + social.length + " (din " + reqs.length + " în total)");
  var next = S.posts.filter(function (v) { return !v.isTask && v.date >= today && v.date <= ciAddDays(today, 6); });
  var manual = 0;
  next.forEach(function (v) { manual += v.pending.length; });
  out.push("🗓️ Săptămâna aceasta: " + (next.length ? next.length + (next.length === 1 ? " postare" : " postări") + " (" +
           next.map(function (v) { return socDm(v.date); }).join(", ") + ")" + (manual ? " · de făcut de tine: " + manual : "") : "nimic programat") + ".");
  return out;
}

function socWho(v) {
  if (v.isTask) return v.pending.length ? "de făcut de tine" : "făcut ✓";
  var auto = v.platforms.filter(function (x) { return x.st === SOC_SCHEDULED || x.st === SOC_PUBLISHED; }).map(function (x) { return x.name; });
  var parts = [];
  if (auto.length) parts.push(socJoin(auto) + " " + (auto.length === 1 ? "programată" : "programate"));
  v.platforms.forEach(function (x) {
    if (x.st === SOC_MANUAL) parts.push(x.name + " la tine");
    if (x.st === SOC_DONE) parts.push(x.name + " făcut ✓");
  });
  return parts.join(" · ") || "fără platforme";
}

/* ============================== MĂRUNȚIȘURI ============================== */

function socPfName(key) {
  return (SOC_PLATFORMS.filter(function (pf) { return pf.key === key; })[0] || { name: key }).name;
}

// [a, b, c] → „a, b și c”
function socJoin(list) {
  return list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " și " + list[list.length - 1];
}

function socClock(ms) { return Utilities.formatDate(new Date(ms), CI_TZ, "HH:mm"); }

function socCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function socDm(iso) { return iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) : ""; }

// „azi la 19:00” / „ieri la 19:00” / „mâine la 19:00” / „miercuri, 11.11 la 19:00”
function socWhen(p, now) {
  if (!p.date) return "fără dată";
  var today = Utilities.formatDate(new Date(now), CI_TZ, "yyyy-MM-dd");
  var day = p.date === today ? "azi" : p.date === ciAddDays(today, -1) ? "ieri" : p.date === ciAddDays(today, 1) ? "mâine"
    : weekday(p.date) + ", " + socDm(p.date);
  return day + (p.time ? " la " + p.time : "");
}

function socWhenView(v, ctx) {
  return socWhen({ date: v.date, time: v.time }, ctx.now);
}

function socRangeText(a, b) { return a === b ? socDm(a) : socDm(a) + "–" + socDm(b); }

// [2026-12-23, 2026-12-24, 2026-12-26] → „23.12–24.12, 26.12”
function socNightsText(list) {
  var groups = [];
  list.slice().sort().forEach(function (iso) {
    var g = groups[groups.length - 1];
    if (g && ciAddDays(g[1], 1) === iso) g[1] = iso; else groups.push([iso, iso]);
  });
  return groups.map(function (g) { return socRangeText(g[0], g[1]); }).join(", ");
}

function socWeekStart(iso) {
  var dow = (parseDay(iso).getUTCDay() + 6) % 7;
  return ciAddDays(iso, -dow);
}
