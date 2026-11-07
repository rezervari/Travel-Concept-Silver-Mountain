// Alertă „postare de modificat”: unele postări de pe Facebook/Instagram spun că anumite nopți sunt libere
// (lista în .github/social-claims.json). Pasul rulează în workflow-ul „Update calendar”, după ce update-calendar.cjs
// a scris booked-dates.json: compară versiunea veche (cea din commit) cu cea nouă și, dacă o rezervare sau o blocare
// NOUĂ ocupă nopți din intervalele promise, trimite un mesaj pe Telegram (botul A13, cu sunet).
// Nu oprește niciodată workflow-ul: orice eroare devine doar un avertisment în log.
//
//   node check-social-claims.cjs <booked-dates vechi> <booked-dates nou> [claims.json]
//
// Fără TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (sau cu SOCIAL_CLAIMS_DRY=1) doar afișează mesajul.
// SOCIAL_CLAIMS_NOW = data/ora curentă simulată (pentru teste).
const fs = require("fs");

const DAY = 86400000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

// „2026-12-21” sau „2026-12-21T00:00:00.000Z” -> ms la miezul nopții UTC
function dayMs(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function todayInRomania(now) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).reduce((o, x) => (o[x.type] = x.value, o), {});
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}

// Nopțile ocupate (ms) dintr-un booked-dates.json; intervalele au „end” exclusiv.
function occupiedNights(file) {
  const set = new Set();
  const ranges = file && Array.isArray(file.ranges) ? file.ranges : [];
  for (const r of ranges) {
    const a = dayMs(r.start), b = dayMs(r.end);
    if (!isFinite(a) || !isFinite(b)) continue;
    for (let t = a; t < b; t += DAY) set.add(t);
  }
  return set;
}

function dm(t) {
  const d = new Date(t);
  return d.getUTCDate() + "." + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function nopti(n) {
  return n === 1 ? "o noapte" : n + " nopți";
}

// [t1, t2, t3, t5] -> „21.12 – 23.12 (3 nopți), 25.12 (o noapte)”
function describe(nights) {
  const list = nights.slice().sort((a, b) => a - b);
  const groups = [];
  for (const t of list) {
    const g = groups[groups.length - 1];
    if (g && t === g.last + DAY) { g.last = t; g.n++; } else groups.push({ first: t, last: t, n: 1 });
  }
  return groups.map(g => (g.n === 1 ? dm(g.first) : dm(g.first) + " – " + dm(g.last)) + " (" + nopti(g.n) + ")").join(", ");
}

function roDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", day: "numeric", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .replace(",", ", ora");
}

function buildAlerts(oldFile, newFile, claimsFile, now) {
  const before = occupiedNights(oldFile);
  const after = occupiedNights(newFile);
  const today = todayInRomania(now);
  const alerts = [];
  const claims = claimsFile && Array.isArray(claimsFile.claims) ? claimsFile.claims : [];
  for (const c of claims) {
    if (c.watchUntil && today >= dayMs(c.watchUntil)) continue;
    const lines = [];
    for (const r of c.ranges || []) {
      const fresh = [];
      let free = 0;
      for (let t = Math.max(dayMs(r.from), today); t < dayMs(r.to); t += DAY) {
        if (after.has(t) && !before.has(t)) fresh.push(t);
        if (!after.has(t)) free++;
      }
      if (!fresh.length) continue;
      lines.push("• " + r.label + ": s-a ocupat " + describe(fresh) + ". " +
        (free ? "Mai " + (free === 1 ? "este liberă o noapte" : "sunt libere " + free + " nopți") + " din perioadă." : "Perioada e acum ocupată complet."));
    }
    if (!lines.length) continue;
    const published = c.scheduled && now >= new Date(c.scheduled);
    const where = c.where || "Facebook + Instagram";
    const meta = /Facebook|Instagram/.test(where);
    const google = /Google/.test(where);
    const how = published
      ? "Editează textul postării" + (meta ? " în Business Suite → Conținut → Publicate (Facebook și Instagram)" : "") +
        (meta && google ? " și" : "") + (google ? " în profilul Google → Postări" : "") + "."
      : "Postarea nu e încă publicată: modific-o sau șterge-o" +
        (meta ? " din Business Suite → Conținut → Programate (Facebook și Instagram)" : "") +
        (meta && google ? " și" : "") + (google ? " din profilul Google → Postări" : "") + ".";
    alerts.push([
      "⚠️ Postare de modificat",
      c.post + " (" + where + ", " + (published ? "publicată" : "programată") +
        (c.scheduled ? " pe " + roDateTime(c.scheduled) : "") + ") spune că aceste nopți sunt libere, dar calendarul s-a schimbat:",
      ...lines,
      how,
    ].join("\n"));
  }
  return alerts;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || process.env.SOCIAL_CLAIMS_DRY === "1") {
    console.log("(fără trimitere pe Telegram)\n" + text);
    return;
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("Telegram a răspuns " + res.status);
  console.log("Alertă trimisă pe Telegram:\n" + text);
}

async function main() {
  const [oldPath, newPath, claimsPath = ".github/social-claims.json"] = process.argv.slice(2);
  const now = process.env.SOCIAL_CLAIMS_NOW ? new Date(process.env.SOCIAL_CLAIMS_NOW) : new Date();
  const alerts = buildAlerts(readJson(oldPath, {}), readJson(newPath, {}), readJson(claimsPath, {}), now);
  if (!alerts.length) {
    console.log("Postări: nicio nouă suprapunere cu datele promise ca libere.");
    return;
  }
  for (const a of alerts) await sendTelegram(a);
}

if (require.main === module) {
  main().catch(e => console.log("::warning::Verificarea postărilor a eșuat: " + e.message));
}

module.exports = { buildAlerts, main };
