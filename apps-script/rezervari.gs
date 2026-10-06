/**
 * A13 Travel Concept — primire solicitări de rezervare de pe site (Google Apps Script).
 *
 * Ce face, la fiecare solicitare trimisă din formularul de pe site:
 *   1. trimite un e-mail către proprietar (contul Google care a publicat scriptul), cu Reply-To = oaspetele;
 *   2. trimite oaspetelui un e-mail de confirmare a PRIMIRII solicitării (nu confirmă rezervarea);
 *   3. adaugă un rând în foaia „Solicitări” din Google Sheet-ul de care e legat scriptul.
 *
 * Adresa de e-mail a proprietarului NU apare nicăieri în cod: se ia din contul care rulează scriptul.
 * Instalare: vezi apps-script/README.md.
 */

var BRAND = "A13 Travel Concept";
var SHEET_NAME = "Solicitări";
var MAX_PER_EMAIL_PER_HOUR = 3;   // anti-abuz: același oaspete
var MAX_PER_HOUR_TOTAL = 30;      // anti-abuz: total

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

    var owner = Session.getEffectiveUser().getEmail();
    var subject = "Solicitare rezervare " + BRAND + " — " + r.checkin + " → " + r.checkout + " (" + r.name + ")";

    MailApp.sendEmail({
      to: owner,
      replyTo: r.email,
      subject: subject,
      body: ownerBody(r),
      name: "Site " + BRAND
    });

    MailApp.sendEmail({
      to: r.email,
      replyTo: owner,
      subject: "Am primit solicitarea ta — " + BRAND + " (" + r.checkin + " → " + r.checkout + ")",
      body: guestBody(r),
      name: BRAND
    });

    logRow(r);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server" });
  }
}

// Verificare rapidă că web app-ul e publicat (deschide URL-ul în browser).
function doGet() {
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
    adults: num(d.adults, 1, 4),
    children: num(d.children, 0, 2),
    rawTotal: num(d.rawTotal, 0, 1000000),
    discountPct: num(d.discountPct, 0, 100) || 0,
    total: num(d.total, 0, 1000000),
    taxTourist: num(d.taxTourist, 0, 100000) || 0,
    taxSalvamont: num(d.taxSalvamont, 0, 100000) || 0
  };

  if (!r.name || !r.phone) return { error: "missing" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return { error: "email" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(r.checkout) || r.checkout <= r.checkin) {
    return { error: "dates" };
  }
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

function priceLines(r) {
  return (
    "Preț de bază: " + r.rawTotal + " RON\n" +
    (r.discountPct > 0 ? "Reducere aplicată: -" + r.discountPct + "%\n" : "") +
    "Total: " + r.total + " RON\n\n" +
    "Taxe incluse în total (doar adulți):\n" +
    "- Taxă turistică: " + r.taxTourist + " RON\n" +
    "- Taxă Salvamont: " + r.taxSalvamont + " RON\n"
  );
}

function ownerBody(r) {
  return (
    "Solicitare nouă de rezervare — " + BRAND + " (Silver Mountain, Poiana Brașov)\n\n" +
    "Nume: " + r.name + "\n" +
    "Telefon: " + r.phone + "\n" +
    "Email: " + r.email + "\n\n" +
    "Check-in: " + r.checkin + "\n" +
    "Check-out: " + r.checkout + "\n" +
    "Nopți: " + r.nights + "\n" +
    "Adulți: " + r.adults + "\n" +
    "Copii: " + r.children + "\n\n" +
    priceLines(r) + "\n" +
    "Răspunde direct la acest e-mail pentru a-i scrie oaspetelui.\n"
  );
}

function guestBody(r) {
  return (
    "Bună, " + r.name + "!\n\n" +
    "Îți mulțumim pentru solicitarea de rezervare la " + BRAND + " – Silver Mountain, Poiana Brașov.\n" +
    "Am primit-o și revenim cu un răspuns în cel mai scurt timp.\n\n" +
    "IMPORTANT: acesta este doar un e-mail de confirmare a primirii. Rezervarea devine fermă abia după confirmarea noastră.\n\n" +
    "Detaliile solicitării:\n" +
    "Check-in: " + r.checkin + " (după ora 16:00)\n" +
    "Check-out: " + r.checkout + " (până la ora 11:00)\n" +
    "Nopți: " + r.nights + "\n" +
    "Oaspeți: " + r.adults + " adulți" + (r.children ? ", " + r.children + " copii" : "") + "\n\n" +
    priceLines(r) + "\n" +
    "Condiții: plata integrală se face după confirmarea rezervării; suma nu se returnează în caz de anulare.\n\n" +
    "Pentru orice întrebare, răspunde la acest e-mail.\n\n" +
    "Cu drag,\n" + BRAND + "\n" +
    "https://rezervari.github.io/Travel-Concept-Silver-Mountain/\n"
  );
}

function logRow(r) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return; // script nelegat de un Sheet → doar e-mailuri
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Primită la", "Nume", "Telefon", "Email", "Check-in", "Check-out", "Nopți",
                  "Adulți", "Copii", "Preț bază", "Reducere %", "Total RON", "Status"]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), r.name, r.phone, r.email, r.checkin, r.checkout, r.nights,
                r.adults, r.children, r.rawTotal, r.discountPct, r.total, "Nouă"]);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Rulează o dată din editor (▶ Run) ca să acorzi permisiunile și să primești un e-mail de test.
function testSolicitare() {
  var me = Session.getEffectiveUser().getEmail();
  var res = doPost({ postData: { contents: JSON.stringify({
    name: "Test Site", phone: "0700000000", email: me,
    checkin: "2026-12-10", checkout: "2026-12-12", nights: 2, adults: 2, children: 0,
    rawTotal: 2600, discountPct: 0, total: 2600, taxTourist: 28, taxSalvamont: 20
  }) } });
  console.log(res.getContent());
}
