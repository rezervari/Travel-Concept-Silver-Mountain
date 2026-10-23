/**
 * A13 Travel Concept — primire solicitări de rezervare de pe site (Google Apps Script).
 *
 * Ce face, la fiecare solicitare trimisă din formularul de pe site:
 *   1. trimite un e-mail HTML către proprietar (contul Google care a publicat scriptul), cu Reply-To = oaspetele;
 *   2. trimite oaspetelui un e-mail HTML de confirmare a PRIMIRII solicitării (nu confirmă rezervarea);
 *   3. adaugă un rând în foaia „Solicitări” din Google Sheet-ul de care e legat scriptul,
 *      cu sursa vizitei (UTM / referrer) și rezultatul verificării.
 *
 * Prețul, nopțile și taxele se recalculează aici din pricing.json de pe site, iar perioada se verifică
 * față de booked-dates.json: e-mailurile nu depind de ce trimite browserul.
 *
 * Adresa de e-mail a proprietarului NU apare nicăieri în cod: se ia din contul care rulează scriptul.
 * Instalare și actualizare: vezi apps-script/README.md (după orice modificare: Deploy → versiune nouă).
 */

var BRAND = "A13 Travel Concept";
var SITE_URL = "https://rezervari.github.io/Travel-Concept-Silver-Mountain/";
var HERO_IMG = SITE_URL + "hero-apartament.jpg";
var PHONE_DISPLAY = "0744 332 234";
var PHONE_TEL = "+40744332234";
var WHATSAPP_URL = "https://wa.me/40744332234";
var SHEET_NAME = "Solicitări";
var SHEET_HEADERS = ["Primită la", "Nume", "Telefon", "Email", "Check-in", "Check-out", "Nopți",
                     "Adulți", "Copii", "Preț bază", "Reducere %", "Total RON", "Status",
                     "Sursă", "Referrer", "Verificare", "Tarif"];
var MAX_PER_EMAIL_PER_HOUR = 3;   // anti-abuz: același oaspete
var MAX_PER_HOUR_TOTAL = 10;      // anti-abuz: total
var TAX_TOURIST = 7;              // RON / adult / noapte (la fel ca TAX_TOURIST din script.js)
var TAX_SALVAMONT = 5;            // RON / adult / noapte (la fel ca TAX_SALVAMONT din script.js)
var SITE_JSON_CACHE_SEC = 120;    // cât păstrăm în cache pricing.json / booked-dates.json
var MAX_GUESTS = 4;               // capacitate: adulți + copii (ca MAX_GUESTS din script.js)
var FLEX_MARKUP_PCT = 10;         // tariful flexibil = nerambursabil + 10% (ca FLEX_MARKUP_PCT din script.js)
var FLEX_CANCEL_DAYS = 14;        // anulare gratuită până cu 14 zile înainte de sosire
var FLEX_MIN_LEAD_DAYS = 15;      // flexibil doar pentru sosiri peste cel puțin 15 zile

// Cromatica site-ului (styles.css :root)
var C = {
  blueDark: "#003580",
  blueMid: "#0071c2",
  yellow: "#febb02",
  bg: "#f5f5f5",
  white: "#ffffff",
  ink: "#262626",
  gray: "#6b6b6b",
  line: "#e7e7e7",
  green: "#008009",
  headerSub: "#cfe0f5",
  blueTint: "#eef5fc",
  yellowTint: "#fff6d9",
  yellowInk: "#7a5800"
};
var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/* ============================== WEB APP ============================== */

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // Honeypot: câmp invizibil pe site, completat doar de roboți → răspundem „ok” și ignorăm.
    if (data.website) return json({ ok: true });

    var r = validate(data);
    if (r.error) return json({ ok: false, error: r.error });

    if (!rateLimitOk(r.email)) {
      return json({ ok: false, error: "rate_limit" });
    }

    r.notes = verifyStay(r);

    // Fără cotă de e-mail: rândul rămâne în Sheet, iar site-ul trece pe varianta mailto
    // (oaspetele îți trimite solicitarea din clientul lui de e-mail).
    if (MailApp.getRemainingDailyQuota() < 2) {
      logRow(r, "Fără e-mail (cotă)");
      return json({ ok: false, error: "quota" });
    }

    var owner = Session.getEffectiveUser().getEmail();
    var sheetUrl = logRow(r, r.notes.length ? "De verificat" : "Nouă");

    MailApp.sendEmail({
      to: owner,
      replyTo: r.email,
      subject: ownerSubject(r),
      body: ownerText(r),
      htmlBody: ownerHtml(r, sheetUrl),
      name: "Site " + BRAND
    });

    // Confirmarea pentru oaspete nu blochează solicitarea: tu ai primit-o deja.
    try {
      MailApp.sendEmail({
        to: r.email,
        replyTo: owner,
        subject: guestSubject(r),
        body: guestText(r),
        htmlBody: guestHtml(r),
        name: BRAND
      });
    } catch (errGuest) {
      console.error(errGuest);
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server" });
  }
}

// Verificare rapidă că web app-ul e publicat (deschide URL-ul în browser).
// ?cal=<cheie>: calendarul iCal „A13 Direct” (calendar.gs), pentru platforme și site.
// Proprietarul, autentificat cu contul lui, vede în schimb panoul de control (panou.gs).
function doGet(e) {
  if (e && e.parameter && e.parameter.cal && typeof calServeFeed === "function") return calServeFeed(e.parameter.cal);
  if (typeof pnAllowed === "function" && pnAllowed()) return pnServe();
  return json({ ok: true, service: BRAND + " rezervari" });
}

function validate(d) {
  function str(v, max) { return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, max); }
  function num(v, min, max) { var n = Number(v); return isFinite(n) && n >= min && n <= max ? n : null; }

  var r = {
    name: str(d.name, 100),
    phone: str(d.phone, 40),
    email: str(d.email, 120),
    checkin: str(d.checkin, 10),
    checkout: str(d.checkout, 10),
    nights: num(d.nights, 1, 60),
    adults: num(d.adults, 1, MAX_GUESTS),
    children: num(d.children, 0, MAX_GUESTS - 1),
    rawTotal: num(d.rawTotal, 0, 1000000),
    discountPct: num(d.discountPct, 0, 100) || 0,
    total: num(d.total, 0, 1000000),
    taxTourist: num(d.taxTourist, 0, 100000) || 0,
    taxSalvamont: num(d.taxSalvamont, 0, 100000) || 0,
    source: str(d.source, 120),
    referrer: str(d.referrer, 120),
    rate: str(d.rate, 20) === "flexibil" ? "flexibil" : "nerambursabil"
  };

  if (!r.name || !r.phone) return { error: "missing" };
  if (r.adults !== null && r.children !== null && r.adults + r.children > MAX_GUESTS) return { error: "capacity" };
  // Numele apare în e-mailul trimis oaspetelui: fără linkuri sau adrese în el.
  if (/https?:|www\.|:\/\/|@/i.test(r.name)) return { error: "name" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return { error: "email" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(r.checkout) || r.checkout <= r.checkin) {
    return { error: "dates" };
  }
  var span = Math.round((parseDay(r.checkout) - parseDay(r.checkin)) / 86400000);
  if (span < 1 || span > 60) return { error: "dates" };
  if (r.nights === null || r.adults === null || r.children === null || r.total === null) return { error: "invalid" };
  return r;
}

function rateLimitOk(email) {
  var cache = CacheService.getScriptCache();
  var keyE = "e_" + email.toLowerCase(), keyT = "total";
  var nE = Number(cache.get(keyE) || 0), nT = Number(cache.get(keyT) || 0);
  if (nE >= MAX_PER_EMAIL_PER_HOUR || nT >= MAX_PER_HOUR_TOTAL) return false;
  cache.put(keyE, String(nE + 1), 3600);
  cache.put(keyT, String(nT + 1), 3600);
  return true;
}

function logRow(r, status) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return ""; // script nelegat de un Sheet → doar e-mailuri
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(SHEET_HEADERS);
    sh.setFrozenRows(1);
  } else {
    // Foaie creată de o versiune mai veche: completează antetele care lipsesc la final.
    var hdr = sh.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
    SHEET_HEADERS.forEach(function (h, i) { if (hdr[i] === "") sh.getRange(1, i + 1).setValue(h); });
  }
  // Telefonul se scrie ca text ("'"), altfel Sheets îl face număr și pierde 0-ul din față (0726… → 726…).
  sh.appendRow([new Date(), r.name, "'" + r.phone, r.email, r.checkin, r.checkout, r.nights,
                r.adults, r.children, r.rawTotal, r.discountPct, r.total, status,
                r.source || "necunoscută", r.referrer, (r.notes || []).join("; ") || "OK",
                rateLabel(r)].map(safeCell));
  return ss.getUrl();
}

// Textul trimis de vizitator nu trebuie interpretat ca formulă (=, +, -, @ la început).
function safeCell(v) {
  return (typeof v === "string" && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

/* ============================== VERIFICARE SEJUR ============================== */

// Recalculează nopțile, prețul (aceeași logică ca computeStay din script.js) și taxele din fișierele
// site-ului și verifică suprapunerea cu zilele ocupate. Valorile calculate aici le înlocuiesc pe cele
// trimise de browser. Întoarce observațiile pentru proprietar (listă goală = totul corespunde).
function verifyStay(r) {
  var notes = [];
  var nights = Math.round((parseDay(r.checkout) - parseDay(r.checkin)) / 86400000);
  if (nights !== r.nights) notes.push("Nopți: site " + r.nights + ", calculat " + nights);
  r.nights = nights;
  r.taxTourist = TAX_TOURIST * r.adults * nights;
  r.taxSalvamont = TAX_SALVAMONT * r.adults * nights;

  var pricing = fetchSiteJson("pricing.json");
  if (!pricing) {
    notes.push("pricing.json indisponibil — prețul trimis de site nu a putut fi verificat");
  } else {
    var raw = 0, discountable = 0, unpriced = [];
    for (var i = 0; i < nights; i++) {
      var day = addDays(r.checkin, i), s = seasonFor(pricing, day);
      if (s && typeof s.price === "number") {
        raw += s.price;
        if (seasonHasDiscounts(s)) discountable += s.price;
      } else unpriced.push(day);
    }
    if (unpriced.length) {
      notes.push("Nopți fără tarif definit: " + unpriced.join(", "));
      r.priceUnconfirmed = true;
    } else {
      var first = seasonFor(pricing, r.checkin);
      var tiers = (first && first.discountTiers && first.discountTiers.length) ? first.discountTiers : (pricing.defaultDiscountTiers || []);
      var pct = 0;
      tiers.forEach(function (t) { if (nights >= t.minNights && t.discount > pct) pct = t.discount; });
      var total = Math.round(raw - discountable + discountable * (100 - pct) / 100);
      r.baseTotal = total; // tariful nerambursabil
      if (r.rate === "flexibil") {
        if (flexAllowed(pricing, r.checkin, nights)) {
          total = Math.round(total * (100 + FLEX_MARKUP_PCT) / 100);
        } else {
          notes.push("Tarif flexibil indisponibil pentru aceste date (sărbători sau sosire în mai puțin de " + FLEX_MIN_LEAD_DAYS + " zile) — tratat ca nerambursabil");
          r.rate = "nerambursabil";
        }
      }
      if (total !== r.total) notes.push("Preț: site " + ron(r.total) + ", calculat " + ron(total));
      r.rawTotal = raw;
      r.discountPct = pct;
      r.total = total;
      var minNights = (first && typeof first.minNights === "number") ? first.minNights : (pricing.globalMinNights || 1);
      if (nights < minNights) notes.push("Sejur sub minimul de " + minNights + " nopți");
    }
  }

  var booked = fetchSiteJson("booked-dates.json");
  if (!booked) {
    notes.push("booked-dates.json indisponibil — disponibilitatea nu a putut fi verificată");
  } else {
    var busy = [];
    for (var j = 0; j < nights; j++) {
      var d = addDays(r.checkin, j);
      var hit = (booked.ranges || []).some(function (b) {
        return String(b.start).slice(0, 10) <= d && d < String(b.end).slice(0, 10);
      });
      if (hit) busy.push(d);
    }
    if (busy.length) notes.push("Suprapunere cu zile ocupate: " + busy.join(", "));
  }
  return notes;
}

// Tariful flexibil: doar dacă toate nopțile cad în sezoane cu politica „flexibil” (coloana „Politică anulare”
// din Excel → seasons[].cancellation; dacă lipsește: sezoane cu reduceri pe durată, adică nu „tarif fix” de
// sărbători) și sosirea e peste cel puțin FLEX_MIN_LEAD_DAYS zile (aceeași regulă ca flexAvailable din script.js).
function flexAllowed(pricing, checkin, nights) {
  var today = Utilities.formatDate(new Date(), "Europe/Bucharest", "yyyy-MM-dd");
  if (checkin < addDays(today, FLEX_MIN_LEAD_DAYS)) return false;
  for (var i = 0; i < nights; i++) {
    var s = seasonFor(pricing, addDays(checkin, i));
    if (!s || !seasonIsFlexible(s)) return false;
  }
  return true;
}

// Nopțile din sezoanele fără reduceri pe durată (Crăciun, Revelion: toate pragurile 0%) rămân la preț întreg,
// chiar dacă sejurul începe înainte de ele (aceeași regulă ca seasonHasDiscounts din script.js).
function seasonHasDiscounts(s) {
  return !s.discountTiers || !s.discountTiers.length ||
    s.discountTiers.some(function (t) { return t.discount > 0; });
}

function seasonIsFlexible(s) {
  if (typeof s.cancellation === "string") return s.cancellation.indexOf("flexibil") === 0;
  return (s.discountTiers || []).some(function (t) { return t.discount > 0; });
}

function rateLabel(r) {
  return r.rate === "flexibil" ? "Flexibil (+" + FLEX_MARKUP_PCT + "%)" : "Nerambursabil";
}

// Ultima zi în care anularea e gratuită la tariful flexibil: „6 decembrie 2026”.
function flexDeadline(r) { return longDate(addDays(r.checkin, -FLEX_CANCEL_DAYS)); }

function seasonFor(pricing, iso) {
  var list = pricing.seasons || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].start <= iso && iso <= list[i].end) return list[i];
  }
  return null;
}

function addDays(iso, n) {
  var d = parseDay(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Fișier public al site-ului (pricing.json / booked-dates.json), cu cache scurt.
function fetchSiteJson(name) {
  var cache = CacheService.getScriptCache(), key = "site_" + name;
  try {
    var text = cache.get(key);
    if (!text) {
      var res = UrlFetchApp.fetch(SITE_URL + name + "?t=" + Date.now(), { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) return null;
      text = res.getContentText();
      cache.put(key, text, SITE_JSON_CACHE_SEC);
    }
    return JSON.parse(text);
  } catch (err) {
    console.error(err);
    return null;
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================== FORMATARE ============================== */

var ZILE = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"];
var LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie",
            "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
var LUNI_SCURT = ["ian.", "feb.", "mar.", "apr.", "mai", "iun.", "iul.", "aug.", "sept.", "oct.", "nov.", "dec."];

function parseDay(iso) {
  var p = iso.split("-");
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// „marți” / „8 decembrie 2026”
function weekday(iso) { return ZILE[parseDay(iso).getUTCDay()]; }
function longDate(iso) { var d = parseDay(iso); return d.getUTCDate() + " " + LUNI[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
// „8 – 11 dec. 2026” / „28 dec. 2026 – 2 ian. 2027”
function rangeShort(a, b) {
  var x = parseDay(a), y = parseDay(b);
  if (x.getUTCFullYear() !== y.getUTCFullYear()) {
    return x.getUTCDate() + " " + LUNI_SCURT[x.getUTCMonth()] + " " + x.getUTCFullYear() + " – " +
           y.getUTCDate() + " " + LUNI_SCURT[y.getUTCMonth()] + " " + y.getUTCFullYear();
  }
  if (x.getUTCMonth() !== y.getUTCMonth()) {
    return x.getUTCDate() + " " + LUNI_SCURT[x.getUTCMonth()] + " – " +
           y.getUTCDate() + " " + LUNI_SCURT[y.getUTCMonth()] + " " + y.getUTCFullYear();
  }
  return x.getUTCDate() + " – " + y.getUTCDate() + " " + LUNI_SCURT[y.getUTCMonth()] + " " + y.getUTCFullYear();
}
// 3315 → „3.315 RON”
function ron(n) {
  var v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " RON";
}
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
function guestsLabel(r) {
  return plural(r.adults, "adult", "adulți") + (r.children ? ", " + plural(r.children, "copil", "copii") : "");
}
function firstName(name) { return name.split(/\s+/)[0]; }
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// 0722 123 456 → 40722123456 (pentru wa.me)
function waNumber(phone) {
  var d = String(phone).replace(/[^\d+]/g, "");
  if (d.indexOf("+") === 0) return d.slice(1);
  if (d.indexOf("00") === 0) return d.slice(2);
  if (d.indexOf("0") === 0) return "40" + d.slice(1);
  return d;
}
function nowRo() {
  return Utilities.formatDate(new Date(), "Europe/Bucharest", "dd.MM.yyyy, HH:mm");
}

/* ============================== SUBIECTE + TEXT SIMPLU ============================== */

// Prețul afișat: „preț de confirmat” când datele nu au tarif publicat pe site.
function totalLabel(r) { return r.priceUnconfirmed ? "preț de confirmat" : ron(r.total); }

function ownerSubject(r) {
  return (r.notes && r.notes.length ? "[De verificat] " : "") +
         "Solicitare nouă · " + rangeShort(r.checkin, r.checkout) + " · " + plural(r.nights, "noapte", "nopți") +
         " · " + r.name + " · " + totalLabel(r) + (r.rate === "flexibil" ? " · flexibil" : "");
}
function guestSubject(r) {
  return "Am primit solicitarea ta · " + BRAND + " · " + rangeShort(r.checkin, r.checkout);
}

// Totalul tarifului nerambursabil (fără suplimentul flexibil).
function baseTotalOf(r) {
  if (typeof r.baseTotal === "number") return r.baseTotal;
  return r.rate === "flexibil" ? Math.round(r.total * 100 / (100 + FLEX_MARKUP_PCT)) : r.total;
}

// Condițiile de anulare pentru tariful ales (text simplu, folosit și în HTML după esc()).
function cancellationText(r) {
  var pay = "După confirmare, plata integrală se face prin transfer bancar în contul Travel Concept International SRL, în 24 de ore (altfel rezervarea expiră). ";
  var cancel = r.rate === "flexibil"
    ? "Tarif flexibil: anulare gratuită până pe " + flexDeadline(r) + " (cu " + FLEX_CANCEL_DAYS + " zile înainte de sosire), cu rambursarea integrală a sumei; după această dată, suma achitată nu se rambursează. "
    : "Tarif nerambursabil: dacă anulezi, nu te prezinți sau pleci mai devreme, suma achitată nu se rambursează. ";
  return pay + cancel + "Dacă noi nu putem asigura cazarea, îți returnăm integral suma.";
}

function priceText(r) {
  if (r.priceUnconfirmed) return "Preț: îl confirmăm în răspunsul la solicitare (datele nu au tarif publicat pe site).\n";
  var base = baseTotalOf(r);
  return (
    "Preț " + plural(r.nights, "noapte", "nopți") + ": " + ron(r.rawTotal) + "\n" +
    (r.discountPct > 0 ? "Reducere sejur (-" + r.discountPct + "%): -" + ron(r.rawTotal - base) + "\n" : "") +
    (r.rate === "flexibil" ? "Tarif flexibil (+" + FLEX_MARKUP_PCT + "%): +" + ron(r.total - base) + "\n" : "") +
    "TOTAL: " + ron(r.total) + " · tarif " + rateLabel(r).toLowerCase() + "\n" +
    "Taxe locale incluse în total: taxă turistică " + ron(r.taxTourist) + ", taxă Salvamont " + ron(r.taxSalvamont) + "\n"
  );
}

function ownerText(r) {
  return (
    "Solicitare nouă de rezervare — " + BRAND + "\n\n" +
    "Oaspete: " + r.name + "\nTelefon: " + r.phone + "\nE-mail: " + r.email + "\n\n" +
    "Check-in: " + cap(weekday(r.checkin)) + ", " + longDate(r.checkin) + " (după 16:00)\n" +
    "Check-out: " + cap(weekday(r.checkout)) + ", " + longDate(r.checkout) + " (până la 11:00)\n" +
    "Durată: " + plural(r.nights, "noapte", "nopți") + "\nOaspeți: " + guestsLabel(r) + "\n\n" +
    priceText(r) + "\n" +
    "Sursa vizitei: " + (r.source || "necunoscută") + "\n" +
    (r.notes && r.notes.length ? "DE VERIFICAT: " + r.notes.join("; ") + "\n" : "") + "\n" +
    "Răspunde direct la acest e-mail pentru a-i scrie oaspetelui.\n"
  );
}

function guestText(r) {
  return (
    "Bună, " + firstName(r.name) + "!\n\n" +
    "Îți mulțumim pentru solicitarea de rezervare la " + BRAND + " – Silver Mountain, Poiana Brașov.\n" +
    "Am primit-o și îți răspundem în cel mult 2 ore (între 08:00 și 22:00; solicitările de noapte, dimineața).\n\n" +
    "Acesta este un e-mail de confirmare a primirii. Rezervarea devine fermă după confirmarea noastră.\n\n" +
    "Check-in: " + cap(weekday(r.checkin)) + ", " + longDate(r.checkin) + ", după ora 16:00\n" +
    "Check-out: " + cap(weekday(r.checkout)) + ", " + longDate(r.checkout) + ", până la ora 11:00\n" +
    "Durată: " + plural(r.nights, "noapte", "nopți") + "\nOaspeți: " + guestsLabel(r) + "\n\n" +
    priceText(r) + "\n" +
    "Condiții: " + cancellationText(r) + "\n" +
    "Condițiile complete: " + SITE_URL + "conditii-rezervare.html\n\n" +
    "Întrebări? Răspunde la acest e-mail, sună-ne la " + PHONE_DISPLAY + " sau scrie-ne pe WhatsApp: " + WHATSAPP_URL + "\n\n" +
    "Cu drag,\nEchipa " + BRAND + "\n" + SITE_URL + "\n"
  );
}

/* ============================== COMPONENTE HTML ============================== */
// Doar tabele + stiluri inline (compatibil Gmail, Outlook, Apple Mail, Yahoo).

function layout(preheader, inner) {
  return (
    '<!DOCTYPE html><html lang="ro" xmlns="http://www.w3.org/1999/xhtml"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + esc(BRAND) + '</title>' +
    '<style>' +
      'a{text-decoration:none;}' +
      '@media only screen and (max-width:620px){' +
        '.container{width:100%!important;}' +
        '.px{padding-left:22px!important;padding-right:22px!important;}' +
        '.stack{display:block!important;width:100%!important;}' +
        '.stack-gap{padding-top:12px!important;padding-left:0!important;}' +
        '.h1{font-size:24px!important;line-height:31px!important;}' +
        '.total{font-size:24px!important;}' +
      '}' +
    '</style></head>' +
    '<body style="margin:0;padding:0;background:' + C.bg + ';-webkit-text-size-adjust:100%;">' +
    // preheader (textul de previzualizare din inbox)
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:' + C.bg + ';">' +
      esc(preheader) + '&#8199;&#65279;&#847;'.repeat(40) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.bg + '" style="background:' + C.bg + ';">' +
    '<tr><td align="center" style="padding:28px 12px 36px;">' +
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
    '<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">' +
      inner +
    '</table>' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '</td></tr></table></body></html>'
  );
}

// Bara de antet, identică vizual cu header-ul site-ului (fundal albastru închis + insigna galbenă A13)
function headerBar(rightLabel) {
  return (
    '<tr><td bgcolor="' + C.blueDark + '" style="background:' + C.blueDark + ';border-radius:12px 12px 0 0;padding:18px 28px;" class="px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td valign="middle" width="40" style="width:40px;">' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td width="36" height="36" align="center" valign="middle" bgcolor="' + C.yellow + '" style="width:36px;height:36px;background:' + C.yellow + ';border-radius:8px;' +
              'font-family:' + FONT + ';font-size:13px;font-weight:800;color:' + C.blueDark + ';letter-spacing:.2px;">A13</td>' +
          '</tr></table>' +
        '</td>' +
        '<td valign="middle" style="padding-left:12px;font-family:' + FONT + ';">' +
          '<div style="font-size:16px;line-height:20px;font-weight:800;color:' + C.white + ';letter-spacing:.2px;">' + esc(BRAND) + '</div>' +
          '<div style="font-size:12px;line-height:16px;color:' + C.headerSub + ';margin-top:2px;">Silver Mountain · Poiana Brașov</div>' +
        '</td>' +
        (rightLabel
          ? '<td valign="middle" align="right" style="font-family:' + FONT + ';font-size:12px;line-height:16px;color:' + C.headerSub + ';white-space:nowrap;">' + esc(rightLabel) + '</td>'
          : '') +
      '</tr></table>' +
    '</td></tr>'
  );
}

function heroImage() {
  return (
    '<tr><td style="padding:0;line-height:0;font-size:0;" bgcolor="' + C.blueDark + '">' +
      '<a href="' + SITE_URL + '" target="_blank"><img src="' + HERO_IMG + '" width="600" alt="Livingul apartamentului A13 Travel Concept din Silver Mountain, Poiana Brașov" ' +
      'style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;"></a>' +
    '</td></tr>'
  );
}

function bodyOpen() {
  return '<tr><td bgcolor="' + C.white + '" style="background:' + C.white + ';padding:34px 36px 30px;font-family:' + FONT + ';color:' + C.ink + ';" class="px">';
}
function bodyClose() { return '</td></tr>'; }

function eyebrow(text) {
  return '<div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:' + C.blueMid + ';margin:0 0 10px;">' + esc(text) + '</div>';
}
function h1(text) {
  return '<h1 class="h1" style="margin:0 0 14px;font-size:28px;line-height:35px;font-weight:800;color:' + C.blueDark + ';">' + text + '</h1>';
}
function p(html, extra) {
  return '<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:' + C.ink + ';' + (extra || "") + '">' + html + '</p>';
}
function pill(text, bg, color) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 26px;"><tr>' +
      '<td bgcolor="' + bg + '" style="background:' + bg + ';border-radius:999px;padding:7px 14px;font-size:13px;line-height:16px;font-weight:700;color:' + color + ';">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:' + color + ';vertical-align:middle;margin-right:7px;"></span>' +
        '<span style="vertical-align:middle;">' + esc(text) + '</span>' +
      '</td></tr></table>'
  );
}
function sectionTitle(text) {
  return '<div style="font-size:13px;line-height:18px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:' + C.blueDark + ';margin:0 0 12px;">' + esc(text) + '</div>';
}
function spacer(h) { return '<div style="height:' + h + 'px;line-height:' + h + 'px;font-size:0;">&nbsp;</div>'; }

// Card cu check-in / check-out (două coloane, se stivuiesc pe telefon) + rând durată/oaspeți
function stayCard(r) {
  function col(label, iso, time, gapClass) {
    return (
      '<td class="stack' + (gapClass ? ' stack-gap' : '') + '" width="50%" valign="top" style="width:50%;' + (gapClass ? 'padding-left:10px;' : 'padding-right:10px;') + '">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          '<td bgcolor="' + C.white + '" style="background:' + C.white + ';border:1px solid ' + C.line + ';border-radius:10px;padding:16px 18px;">' +
            '<div style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:' + C.gray + ';">' + label + '</div>' +
            '<div style="font-size:19px;line-height:25px;font-weight:800;color:' + C.blueDark + ';margin-top:6px;">' + esc(longDate(iso)) + '</div>' +
            '<div style="font-size:14px;line-height:20px;color:' + C.ink + ';margin-top:2px;">' + esc(cap(weekday(iso))) + ' · ' + time + '</div>' +
          '</td></tr></table>' +
      '</td>'
    );
  }
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + C.blueTint + '" style="background:' + C.blueTint + ';border-radius:12px;">' +
      '<tr><td style="padding:16px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          col("Check-in", r.checkin, "după ora 16:00", false) +
          col("Check-out", r.checkout, "până la ora 11:00", true) +
        '</tr></table>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>' +
          '<td style="font-size:14px;line-height:20px;color:' + C.ink + ';padding:0 4px;">' +
            '<strong style="color:' + C.blueDark + ';">' + plural(r.nights, "noapte", "nopți") + '</strong>' +
            '<span style="color:' + C.gray + ';">&nbsp;&nbsp;·&nbsp;&nbsp;</span>' +
            '<strong style="color:' + C.blueDark + ';">' + esc(guestsLabel(r)) + '</strong>' +
          '</td>' +
        '</tr></table>' +
      '</td></tr>' +
    '</table>'
  );
}

// Tabel de preț: bază, reducere, total, taxe incluse
function priceTable(r) {
  if (r.priceUnconfirmed) {
    return noteBox("<strong style=\"color:" + C.blueDark + ";\">Preț de confirmat.</strong> " +
                   "Pentru aceste date nu există încă tarif publicat pe site; prețul îl comunicăm în răspunsul nostru.");
  }
  var base = baseTotalOf(r);
  var disc = r.rawTotal - base;
  var perNight = r.nights ? Math.round(r.total / r.nights) : r.total;
  function row(label, value, opts) {
    opts = opts || {};
    return (
      '<tr>' +
        '<td style="padding:9px 0;font-size:15px;line-height:22px;color:' + (opts.color || C.ink) + ';' + (opts.top ? 'border-top:1px solid ' + C.line + ';' : '') + '">' + label + '</td>' +
        '<td align="right" style="padding:9px 0;font-size:15px;line-height:22px;white-space:nowrap;color:' + (opts.color || C.ink) + ';' + (opts.bold ? 'font-weight:700;' : '') + (opts.top ? 'border-top:1px solid ' + C.line + ';' : '') + '">' + value + '</td>' +
      '</tr>'
    );
  }
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      row("Cazare · " + plural(r.nights, "noapte", "nopți"), esc(ron(r.rawTotal))) +
      (r.discountPct > 0 ? row("Reducere sejur (−" + r.discountPct + "%)", "−" + esc(ron(disc)), { color: C.green, bold: true }) : "") +
      (r.rate === "flexibil" ? row("Tarif flexibil (+" + FLEX_MARKUP_PCT + "%) · anulare gratuită până pe " + esc(flexDeadline(r)), "+" + esc(ron(r.total - base))) : "") +
      row("Tarif", esc(rateLabel(r)), { top: true, bold: true }) +
      '<tr>' +
        '<td style="padding:14px 0 4px;border-top:2px solid ' + C.blueDark + ';font-size:15px;line-height:22px;font-weight:800;color:' + C.blueDark + ';">Total</td>' +
        '<td align="right" class="total" style="padding:14px 0 4px;border-top:2px solid ' + C.blueDark + ';font-size:26px;line-height:30px;font-weight:800;color:' + C.blueDark + ';white-space:nowrap;">' + esc(ron(r.total)) + '</td>' +
      '</tr>' +
      '<tr><td colspan="2" align="right" style="padding:0 0 4px;font-size:13px;line-height:18px;color:' + C.gray + ';">în medie ' + esc(ron(perNight)) + ' / noapte</td></tr>' +
    '</table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>' +
      '<td bgcolor="' + C.bg + '" style="background:' + C.bg + ';border-radius:8px;padding:12px 14px;font-size:13px;line-height:20px;color:' + C.gray + ';">' +
        '<strong style="color:' + C.ink + ';">Taxe locale incluse în preț</strong> (doar pentru adulți): ' +
        'taxă turistică ' + esc(ron(r.taxTourist)) + ' · taxă Salvamont ' + esc(ron(r.taxSalvamont)) + '.' +
      '</td></tr></table>'
  );
}

function button(href, label, bg, color, border) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 10px 0;"><tr>' +
      '<td bgcolor="' + bg + '" style="background:' + bg + ';border-radius:8px;' + (border ? 'border:1px solid ' + border + ';' : '') + '">' +
        '<a href="' + href + '" target="_blank" style="display:inline-block;padding:12px 20px;font-family:' + FONT + ';font-size:14px;line-height:18px;font-weight:700;color:' + color + ';text-decoration:none;border-radius:8px;">' + label + '</a>' +
      '</td></tr></table>'
  );
}

function steps(items) {
  var html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">';
  items.forEach(function (it, i) {
    html +=
      '<tr>' +
        '<td width="40" valign="top" style="width:40px;padding:0 0 16px;">' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
            '<td width="28" height="28" align="center" valign="middle" bgcolor="' + C.yellow + '" style="width:28px;height:28px;background:' + C.yellow + ';border-radius:28px;font-size:13px;font-weight:800;color:' + C.blueDark + ';">' + (i + 1) + '</td>' +
          '</tr></table>' +
        '</td>' +
        '<td valign="top" style="padding:3px 0 16px;font-size:15px;line-height:22px;color:' + C.ink + ';">' +
          '<strong style="color:' + C.blueDark + ';">' + it[0] + '</strong><br>' +
          '<span style="color:' + C.gray + ';font-size:14px;line-height:21px;">' + it[1] + '</span>' +
        '</td>' +
      '</tr>';
  });
  return html + '</table>';
}

function noteBox(html) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td bgcolor="' + C.blueTint + '" style="background:' + C.blueTint + ';border-left:4px solid ' + C.blueMid + ';border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;line-height:21px;color:' + C.ink + ';">' + html + '</td>' +
    '</tr></table>'
  );
}

function warnBox(html) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>' +
      '<td bgcolor="' + C.yellowTint + '" style="background:' + C.yellowTint + ';border-left:4px solid ' + C.yellow + ';border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;line-height:21px;color:' + C.yellowInk + ';">' + html + '</td>' +
    '</tr></table>'
  );
}

function divider() {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;"><tr><td style="border-top:1px solid ' + C.line + ';font-size:0;line-height:0;">&nbsp;</td></tr></table>';
}

function footer(lines) {
  return (
    '<tr><td bgcolor="' + C.blueDark + '" style="background:' + C.blueDark + ';border-radius:0 0 12px 12px;padding:22px 36px;font-family:' + FONT + ';" class="px">' +
      '<div style="font-size:14px;line-height:20px;font-weight:800;color:' + C.white + ';">' + esc(BRAND) + '</div>' +
      '<div style="font-size:12px;line-height:19px;color:' + C.headerSub + ';margin-top:4px;">' + lines + '</div>' +
    '</td></tr>'
  );
}

/* ============================== E-MAIL OASPETE ============================== */

function guestHtml(r) {
  var inner =
    headerBar("") +
    heroImage() +
    bodyOpen() +
      eyebrow("Solicitare primită") +
      h1("Mulțumim, " + esc(firstName(r.name)) + "!") +
      p("Am primit solicitarea ta de rezervare la <strong>" + esc(BRAND) + "</strong>, în complexul Silver Mountain din Poiana Brașov. " +
        "Verificăm disponibilitatea și îți răspundem în cel mult 2 ore (între 08:00 și 22:00; solicitările de noapte, dimineața).") +
      pill("În așteptarea confirmării", C.yellowTint, C.yellowInk) +

      sectionTitle("Sejurul tău") +
      stayCard(r) +
      spacer(28) +

      sectionTitle("Detalii preț") +
      priceTable(r) +

      divider() +

      sectionTitle("Ce urmează") +
      steps([
        ["Verificăm disponibilitatea", "Ne asigurăm că perioada aleasă este liberă pe toate canalele de rezervare."],
        ["Îți confirmăm rezervarea", "Primești confirmarea și datele de plată. Plătești prin transfer bancar în 24 de ore; rezervarea devine fermă când primim plata."],
        ["Pregătim sosirea ta", "Înainte de check-in îți trimitem toate informațiile necesare pentru sosire."]
      ]) +

      noteBox("<strong style=\"color:" + C.blueDark + ";\">Condiții de rezervare.</strong> " + esc(cancellationText(r)) + " " +
              '<a href="' + SITE_URL + 'conditii-rezervare.html" target="_blank" style="color:' + C.blueMid + ';text-decoration:underline;">Condițiile complete</a>') +

      divider() +

      p("<strong style=\"color:" + C.blueDark + ";\">Ai întrebări?</strong> Răspunde direct la acest e-mail sau contactează-ne:", "margin-bottom:16px;") +
      button(WHATSAPP_URL, "Scrie-ne pe WhatsApp", C.blueMid, C.white) +
      button("tel:" + PHONE_TEL, "Sună: " + PHONE_DISPLAY, C.white, C.blueDark, C.blueDark) +
      spacer(10) +
      p("Cu drag,<br><strong style=\"color:" + C.blueDark + ";\">Echipa " + esc(BRAND) + "</strong>", "margin:14px 0 0;") +
    bodyClose() +
    footer(
      "Complex Silver Mountain · Poiana Brașov<br>" +
      '<a href="' + SITE_URL + '" target="_blank" style="color:' + C.yellow + ';text-decoration:none;font-weight:700;">Rezervă direct, fără comisioane</a>' +
      '<br>Travel Concept International SRL · CUI RO15288158 · <a href="mailto:travel@travelconcept.ro" style="color:' + C.headerSub + ';">travel@travelconcept.ro</a>' +
      '<br><span style="color:#9fb6d6;">Ai primit acest e-mail pentru că ai trimis o solicitare de rezervare pe site-ul nostru.</span>'
    );

  return layout(
    "Am primit solicitarea ta pentru " + rangeShort(r.checkin, r.checkout) + " · " + plural(r.nights, "noapte", "nopți") + " · " + totalLabel(r) + ". Îți răspundem în cel mult 2 ore.",
    inner
  );
}

/* ============================== E-MAIL PROPRIETAR ============================== */

function ownerHtml(r, sheetUrl) {
  var replySubject = "Rezervare " + BRAND + " · " + rangeShort(r.checkin, r.checkout);
  var replyHref = "mailto:" + encodeURIComponent(r.email) + "?subject=" + encodeURIComponent(replySubject);
  var waHref = "https://wa.me/" + waNumber(r.phone) + "?text=" + encodeURIComponent(
    "Bună ziua, " + firstName(r.name) + "! Vă scriu de la " + BRAND + " în legătură cu solicitarea de rezervare pentru " + rangeShort(r.checkin, r.checkout) + ".");

  function contactRow(label, value, href) {
    return (
      '<tr>' +
        '<td width="80" valign="top" style="width:80px;padding:6px 0;font-size:13px;line-height:20px;color:' + C.gray + ';">' + label + '</td>' +
        '<td valign="top" style="padding:6px 0;font-size:15px;line-height:20px;font-weight:700;color:' + C.ink + ';word-break:break-word;">' +
          (href ? '<a href="' + href + '" style="color:' + C.blueMid + ';text-decoration:none;">' + esc(value) + '</a>' : esc(value)) +
        '</td>' +
      '</tr>'
    );
  }

  var inner =
    headerBar("") +
    bodyOpen() +
      eyebrow("Solicitare nouă · " + nowRo()) +
      h1(esc(rangeShort(r.checkin, r.checkout))) +
      '<div style="font-size:15px;line-height:22px;color:' + C.gray + ';margin:-6px 0 22px;">' +
        plural(r.nights, "noapte", "nopți") + ' · ' + esc(guestsLabel(r)) + ' · ' +
        '<strong style="color:' + C.blueDark + ';">' + esc(totalLabel(r)) + '</strong>' +
      '</div>' +
      (r.notes && r.notes.length
        ? warnBox('<strong>De verificat:</strong><br>' + r.notes.map(esc).join('<br>'))
        : '') +

      sectionTitle("Oaspete") +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + C.line + ';border-radius:10px;"><tr><td style="padding:14px 18px;">' +
        '<div style="font-size:19px;line-height:25px;font-weight:800;color:' + C.blueDark + ';margin-bottom:6px;">' + esc(r.name) + '</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
          contactRow("Telefon", r.phone, "tel:" + r.phone.replace(/[^\d+]/g, "")) +
          contactRow("E-mail", r.email, "mailto:" + encodeURIComponent(r.email)) +
        '</table>' +
      '</td></tr></table>' +
      spacer(16) +
      button(replyHref, "Răspunde pe e-mail", C.blueMid, C.white) +
      button("tel:" + r.phone.replace(/[^\d+]/g, ""), "Sună", C.white, C.blueDark, C.blueDark) +
      button(waHref, "WhatsApp", C.white, C.blueDark, C.blueDark) +
      spacer(18) +

      sectionTitle("Sejur") +
      stayCard(r) +
      spacer(28) +

      sectionTitle("Preț (recalculat din tarifele site-ului)") +
      priceTable(r) +
      spacer(22) +

      sectionTitle("Sursa vizitei") +
      p(esc(r.source || "necunoscută"), "margin:0;") +

      divider() +

      sectionTitle("De făcut") +
      steps([
        ["Verifică disponibilitatea", "Booking, Airbnb și Travelminit — calendarul site-ului se sincronizează automat de mai multe ori pe zi."],
        ["Confirmă oaspetelui", "Trimite confirmarea și IBAN-ul firmei: plata integrală prin transfer în 24 de ore, altfel rezervarea expiră. " +
          (r.rate === "flexibil"
            ? "Tarif FLEXIBIL: anulare gratuită până pe " + esc(flexDeadline(r)) + " (rambursare integrală)."
            : "Tarif nerambursabil.")],
        ["Blochează datele", "După plată, închide perioada pe platforme ca să nu apară suprapuneri."]
      ]) +
      (sheetUrl
        ? button(sheetUrl, "Deschide evidența solicitărilor", C.yellow, C.blueDark)
        : "") +
      spacer(4) +
      p('Oaspetele a primit automat un e-mail de confirmare a primirii solicitării. ' +
        'Un „Reply” la acest mesaj îi scrie direct oaspetelui.', "margin:10px 0 0;font-size:13px;line-height:20px;color:" + C.gray + ";") +
    bodyClose() +
    footer("Trimis automat de formularul de rezervare de pe " +
      '<a href="' + SITE_URL + '" target="_blank" style="color:' + C.yellow + ';text-decoration:none;font-weight:700;">site</a>.');

  return layout(
    r.name + " · " + plural(r.nights, "noapte", "nopți") + " · " + guestsLabel(r) + " · " + totalLabel(r),
    inner
  );
}

/* ============================== TEST ============================== */

// Rulează o dată din editor (▶ Run) ca să acorzi permisiunile (inclusiv „conectare la un serviciu extern”,
// pentru citirea pricing.json de pe site) și să primești ambele e-mailuri de test.
// Valorile de mai jos corespund tarifului iarna-2026 (1250 RON/noapte, −15% la 3 nopți) → „Verificare: OK”.
function testSolicitare() {
  var me = Session.getEffectiveUser().getEmail();
  var res = doPost({ postData: { contents: JSON.stringify({
    name: "Ana Popescu", phone: "0722 123 456", email: me,
    checkin: "2026-12-08", checkout: "2026-12-11", nights: 3, adults: 2, children: 1,
    rawTotal: 3750, discountPct: 15, total: 3188, taxTourist: 42, taxSalvamont: 30,
    source: "google / organic · gbp · rezervare", referrer: "www.google.com"
  }) } });
  console.log(res.getContent());
}
