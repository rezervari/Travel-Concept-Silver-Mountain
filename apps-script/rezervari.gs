/**
 * A13 Travel Concept — primire solicitări de rezervare de pe site (Google Apps Script).
 *
 * Ce face, la fiecare solicitare trimisă din formularul de pe site:
 *   1. trimite un e-mail HTML către proprietar (contul Google care a publicat scriptul), cu Reply-To = oaspetele;
 *   2. trimite oaspetelui un e-mail HTML de confirmare a PRIMIRII solicitării (nu confirmă rezervarea);
 *   3. adaugă un rând în foaia „Solicitări” din Google Sheet-ul de care e legat scriptul.
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
var MAX_PER_EMAIL_PER_HOUR = 3;   // anti-abuz: același oaspete
var MAX_PER_HOUR_TOTAL = 30;      // anti-abuz: total

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

    var owner = Session.getEffectiveUser().getEmail();
    var sheetUrl = logRow(r);

    MailApp.sendEmail({
      to: owner,
      replyTo: r.email,
      subject: ownerSubject(r),
      body: ownerText(r),
      htmlBody: ownerHtml(r, sheetUrl),
      name: "Site " + BRAND
    });

    MailApp.sendEmail({
      to: r.email,
      replyTo: owner,
      subject: guestSubject(r),
      body: guestText(r),
      htmlBody: guestHtml(r),
      name: BRAND
    });

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

function logRow(r) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return ""; // script nelegat de un Sheet → doar e-mailuri
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Primită la", "Nume", "Telefon", "Email", "Check-in", "Check-out", "Nopți",
                  "Adulți", "Copii", "Preț bază", "Reducere %", "Total RON", "Status"]);
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), r.name, r.phone, r.email, r.checkin, r.checkout, r.nights,
                r.adults, r.children, r.rawTotal, r.discountPct, r.total, "Nouă"]);
  return ss.getUrl();
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

function ownerSubject(r) {
  return "Solicitare nouă · " + rangeShort(r.checkin, r.checkout) + " · " + plural(r.nights, "noapte", "nopți") +
         " · " + r.name + " · " + ron(r.total);
}
function guestSubject(r) {
  return "Am primit solicitarea ta · " + BRAND + " · " + rangeShort(r.checkin, r.checkout);
}

function priceText(r) {
  var disc = r.rawTotal - r.total;
  return (
    "Preț " + plural(r.nights, "noapte", "nopți") + ": " + ron(r.rawTotal) + "\n" +
    (r.discountPct > 0 ? "Reducere sejur (-" + r.discountPct + "%): -" + ron(disc) + "\n" : "") +
    "TOTAL: " + ron(r.total) + "\n" +
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
    "Răspunde direct la acest e-mail pentru a-i scrie oaspetelui.\n"
  );
}

function guestText(r) {
  return (
    "Bună, " + firstName(r.name) + "!\n\n" +
    "Îți mulțumim pentru solicitarea de rezervare la " + BRAND + " – Silver Mountain, Poiana Brașov.\n" +
    "Am primit-o și revenim cu un răspuns în cel mai scurt timp.\n\n" +
    "Acesta este un e-mail de confirmare a primirii. Rezervarea devine fermă după confirmarea noastră.\n\n" +
    "Check-in: " + cap(weekday(r.checkin)) + ", " + longDate(r.checkin) + ", după ora 16:00\n" +
    "Check-out: " + cap(weekday(r.checkout)) + ", " + longDate(r.checkout) + ", până la ora 11:00\n" +
    "Durată: " + plural(r.nights, "noapte", "nopți") + "\nOaspeți: " + guestsLabel(r) + "\n\n" +
    priceText(r) + "\n" +
    "Condiții: plata integrală se face după confirmarea rezervării; suma nu se returnează în caz de anulare.\n\n" +
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
  var disc = r.rawTotal - r.total;
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
        "Verificăm disponibilitatea și revenim cu un răspuns în cel mai scurt timp.") +
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
        ["Îți confirmăm rezervarea", "Primești confirmarea și detaliile de plată. Rezervarea devine fermă după confirmarea noastră."],
        ["Pregătim sosirea ta", "Înainte de check-in îți trimitem toate informațiile necesare pentru sosire."]
      ]) +

      noteBox("<strong style=\"color:" + C.blueDark + ";\">Condiții de rezervare.</strong> Plata integrală se face după confirmarea rezervării. " +
              "În caz de anulare, suma achitată nu se returnează.") +

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
      '<br><span style="color:#9fb6d6;">Ai primit acest e-mail pentru că ai trimis o solicitare de rezervare pe site-ul nostru.</span>'
    );

  return layout(
    "Am primit solicitarea ta pentru " + rangeShort(r.checkin, r.checkout) + " · " + plural(r.nights, "noapte", "nopți") + " · " + ron(r.total) + ". Revenim în cel mai scurt timp.",
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
        '<strong style="color:' + C.blueDark + ';">' + esc(ron(r.total)) + '</strong>' +
      '</div>' +

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

      sectionTitle("Preț calculat pe site") +
      priceTable(r) +

      divider() +

      sectionTitle("De făcut") +
      steps([
        ["Verifică disponibilitatea", "Booking, Airbnb și Travelminit — calendarul site-ului se sincronizează din oră în oră."],
        ["Confirmă oaspetelui", "Trimite confirmarea și detaliile de plată (plata integrală, nerambursabilă)."],
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
    r.name + " · " + plural(r.nights, "noapte", "nopți") + " · " + guestsLabel(r) + " · " + ron(r.total),
    inner
  );
}

/* ============================== TEST ============================== */

// Rulează o dată din editor (▶ Run) ca să acorzi permisiunile și să primești ambele e-mailuri de test.
function testSolicitare() {
  var me = Session.getEffectiveUser().getEmail();
  var res = doPost({ postData: { contents: JSON.stringify({
    name: "Ana Popescu", phone: "0722 123 456", email: me,
    checkin: "2026-12-08", checkout: "2026-12-11", nights: 3, adults: 2, children: 1,
    rawTotal: 3900, discountPct: 15, total: 3315, taxTourist: 42, taxSalvamont: 30
  }) } });
  console.log(res.getContent());
}
