// Releul botului Telegram A13 (cheltuielile trimise pe Telegram, apps-script/fin-telegram.gs).
// Telegram trimite fiecare mesaj aici (webhook). Worker-ul răspunde imediat „ok” (altfel Telegram retrimite mesajul)
// și îl dă mai departe la Apps Script, care verifică cheia webhook-ului și chatul, scrie în tabel și răspunde pe Telegram.
// De ce nu direct la Apps Script: acolo un POST primește o redirecționare 302, iar Telegram o socotește eroare și retrimite.
// Fără secrete aici: cheia (antetul X-Telegram-Bot-Api-Secret-Token) se compară în Apps Script. Filtre: doar POST,
// doar de pe IP-urile Telegram, doar un update cu update_id. Publicare, din acest folder: npx wrangler@4 deploy

const APPS_SCRIPT_TIMEOUT_MS = 25 * 1000;
// Adresele de pe care Telegram trimite webhook-urile (core.telegram.org/bots/webhooks).
const TELEGRAM_NETS = [["149.154.160.0", 20], ["91.108.4.0", 22]];

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return text(404, "Not found");
    const secret = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return text(404, "Not found");
    if (!fromTelegram(request.headers.get("cf-connecting-ip") || "")) return text(404, "Not found");
    let update;
    try { update = await request.json(); } catch (e) { return text(400, "Bad request"); }
    if (!update || typeof update.update_id !== "number") return text(400, "Bad request");
    ctx.waitUntil(forward(env, secret, update));
    return text(200, "ok");
  }
};

async function forward(env, secret, update) {
  try {
    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ tgRelay: 1, secret, update }),
      redirect: "follow",
      signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS)
    });
    if (!res.ok) console.error("Apps Script a răspuns HTTP " + res.status + " (update " + update.update_id + ")");
  } catch (e) {
    console.error("Apps Script: " + e.message + " (update " + update.update_id + ")");
  }
}

export function fromTelegram(ip) {
  const n = ipv4(ip);
  if (n === null) return false;
  return TELEGRAM_NETS.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4(net) & mask) >>> 0);
  });
}

function ipv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip).trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function text(status, body) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
