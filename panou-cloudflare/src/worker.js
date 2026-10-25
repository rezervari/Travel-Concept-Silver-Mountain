// Panoul A13 pe Cloudflare: aceeași pagină ca în Apps Script (apps-script/Panou.html), instalabilă ca aplicație.
// Datele și acțiunile vin tot din Apps Script (doPost → pnApi din panou.gs, cu cheia secretă PN_API_TOKEN). Aici:
//  - Cloudflare Access în față (doar proprietarul) + verificarea tokenului Access (JWT) în cod, ca a doua barieră;
//  - ultimele date ale panoului păstrate în KV (cron la 5 minute) → pagina se deschide imediat;
//  - fișierele aplicației (manifest, iconițe, service worker) din public/ — fără date, servite direct de Cloudflare;
//  - pornirea orară a workflow-ului GitHub „Update calendar” (calendarul vizitatorilor de pe site), vezi mai jos.
// Secrete (npx wrangler secret put …): PN_API_TOKEN, OWNER_EMAIL, GITHUB_DISPATCH_TOKEN. Restul în wrangler.toml. Vezi README.md.
import PANEL_HTML from "../../apps-script/Panou.html";

const SNAPSHOT_KEY = "snapshot";
const FRESH_MS = 5.5 * 60 * 1000;          // pnData(false) primește datele păstrate cât sunt mai noi de atât
const APPS_SCRIPT_TIMEOUT_MS = 90 * 1000;  // „Sincronizează” (checkinSync + datele) poate dura ~1 minut
const CALENDAR_EVERY_MS = 55 * 60 * 1000;  // „Update calendar” pornit dacă nu a mai rulat de atât (cron la 5 min → ~orar)
const GITHUB_TIMEOUT_MS = 20 * 1000;
const FNS = new Set(["pnData", "pnSyncNow", "pnDismiss", "pnBlock", "pnUnblock", "pnSetRequestStatus"]);
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!(await accessEmail(request, env))) return text(403, "Acces refuzat.");
    if (url.pathname === "/" && request.method === "GET") return page(env);
    if (url.pathname === "/api" && request.method === "POST") return api(request, env, ctx);
    return text(404, "Not found");
  },

  // La 5 minute: datele panoului de la Apps Script → KV, ca pagina să se deschidă fără așteptare;
  // plus „Update calendar” pe GitHub, dacă e timpul (independent: o eroare la una nu o oprește pe cealaltă).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(appsScript(env, "pnData", [false]).then((r) => store(env, r)));
    ctx.waitUntil(dispatchCalendar(env).catch((e) => console.error("Update calendar: " + e.message)));
  }
};

/* ---------------------------------- pagina ---------------------------------- */

const HEAD = [
  "<title>Panou A13</title>",
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="robots" content="noindex, nofollow">',
  '<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">',
  '<link rel="icon" href="/icon-192.png" type="image/png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Panou A13">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<script>window.A13_API = "/api"; if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});</script>'
].join("\n");

async function page(env) {
  let snap = await readSnapshot(env);
  if (!snap) {
    try {
      snap = await appsScript(env, "pnData", [false]);
      await store(env, snap);
    } catch (e) {
      return text(502, "Panoul nu a putut lua datele de la Apps Script: " + e.message + "\nReîncarcă pagina peste un minut.");
    }
  }
  // Funcții ca înlocuitori: datele pot conține „$” (String.replace ar interpreta $& / $1).
  const html = PANEL_HTML.replace("<!--A13_HEAD-->", () => HEAD).replace("<?!= data ?>", () => snap.json);
  return new Response(html, { headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8" } });
}

/* ---------------------------------- acțiuni ---------------------------------- */

// { fn, args } din pagină (același „call” ca google.script.run) → Apps Script → datele noi ale panoului.
async function api(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch (e) { return text(400, "Cerere invalidă."); }
  const fn = String((body && body.fn) || "");
  if (!FNS.has(fn)) return text(400, "Funcție necunoscută.");
  const args = Array.isArray(body.args) ? body.args.slice(0, 3) : [];

  if (fn === "pnData" && !args[0]) {
    const snap = await readSnapshot(env);
    if (snap && Date.now() - snap.now < FRESH_MS) return json(snap.json);
  }
  try {
    const r = await appsScript(env, fn, args);
    ctx.waitUntil(store(env, r));
    return json(r.json);
  } catch (e) {
    return text(502, e.message);
  }
}

/* ---------------------------------- Apps Script ---------------------------------- */

// POST la implementarea „Calendar” (Anyone): Apps Script răspunde cu 302 spre googleusercontent, fetch îl urmează.
async function appsScript(env, fn, args) {
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ api: fn, token: env.PN_API_TOKEN, args }),
    redirect: "follow",
    signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS)
  });
  const body = await res.text();
  if (!res.ok) throw new Error("Apps Script a răspuns HTTP " + res.status);
  let data;
  try { data = JSON.parse(body); } catch (e) { throw new Error("Apps Script a trimis un răspuns neașteptat"); }
  if (data && data.ok === false) throw new Error("Apps Script: " + data.error);
  if (!data || !data.now) throw new Error("Apps Script: date incomplete");
  return { json: body, now: Number(data.now) };
}

async function readSnapshot(env) {
  const r = await env.PANOU_KV.getWithMetadata(SNAPSHOT_KEY);
  if (!r.value || !r.metadata || !r.metadata.now) return null;
  return { json: r.value, now: Number(r.metadata.now) };
}

function store(env, snap) {
  return env.PANOU_KV.put(SNAPSHOT_KEY, snap.json, { metadata: { now: snap.now } });
}

/* ---------------------------------- GitHub: „Update calendar” ---------------------------------- */

// booked-dates.json (zilele ocupate de pe site, folosite și de rezervari.gs la verificarea solicitărilor) îl scrie
// workflow-ul „Update calendar”. Programarea lui GitHub („17 * * * *”) rulează în realitate doar de 4–6 ori pe zi,
// cu pauze de 3–6 ore → de aici îl pornim (workflow_dispatch) când ultima rulare, de orice fel, e mai veche de 55 de
// minute și nu e nimic în curs. O rulare programată recentă amână pornirea; programarea rămâne ca rezervă.
// Token fine-grained doar pe acest repo, cu „Actions: Read and write” (secretul GITHUB_DISPATCH_TOKEN); fără el, nimic.
async function dispatchCalendar(env, now = Date.now()) {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPO || !env.GITHUB_WORKFLOW) return "off";
  const base = "https://api.github.com/repos/" + env.GITHUB_REPO + "/actions/workflows/" + env.GITHUB_WORKFLOW;
  const headers = {
    authorization: "Bearer " + env.GITHUB_DISPATCH_TOKEN,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "a13-panou"
  };
  const res = await fetch(base + "/runs?per_page=1", { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  if (!res.ok) throw new Error("lista rulărilor: GitHub HTTP " + res.status);
  const run = ((await res.json()).workflow_runs || [])[0];
  if (run && (run.status !== "completed" || now - Date.parse(run.created_at) < CALENDAR_EVERY_MS)) return "skip";
  const go = await fetch(base + "/dispatches", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_REF || "main" }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)
  });
  if (!go.ok) throw new Error("pornire: GitHub HTTP " + go.status);
  console.log("Update calendar pornit (ultima rulare: " + (run ? run.created_at : "niciuna") + ")");
  return "dispatched";
}

/* ---------------------------------- Cloudflare Access ---------------------------------- */

// Tokenul pus de Access în fiecare cerere (Cf-Access-Jwt-Assertion): semnătura cu cheile echipei, aplicația (aud),
// emitentul, expirarea și adresa = proprietarul (OWNER_EMAIL, una sau mai multe, separate prin virgulă).
// Fără Access configurat corect, Worker-ul nu dă nimic (nici dacă cineva dezactivează Access din greșeală).
let KEYS = null, KEYS_AT = 0;

async function accessEmail(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64text(parts[0]));
    payload = JSON.parse(b64text(parts[1]));
  } catch (e) { return null; }
  const now = Date.now() / 1000;
  if (header.alg !== "RS256" || ![].concat(payload.aud || []).includes(env.ACCESS_AUD) ||
      payload.iss !== "https://" + env.ACCESS_TEAM_DOMAIN || !(payload.exp > now) || (payload.nbf && payload.nbf > now + 60)) return null;
  const email = String(payload.email || "").toLowerCase();
  const owners = String(env.OWNER_EMAIL).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!owners.includes(email)) return null;
  const key = await accessKey(env, header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64bytes(parts[2]),
                                        new TextEncoder().encode(parts[0] + "." + parts[1]));
  return ok ? email : null;
}

// Cheile publice ale echipei Access, ținute o oră; o cheie necunoscută (rotire) → recitire, cel mult o dată la 5 minute.
async function accessKey(env, kid) {
  const age = Date.now() - KEYS_AT;
  if (!KEYS || age > 3600e3 || (!KEYS[kid] && age > 300e3)) {
    try {
      const res = await fetch("https://" + env.ACCESS_TEAM_DOMAIN + "/cdn-cgi/access/certs");
      const data = await res.json();
      const keys = {};
      for (const k of data.keys || []) {
        keys[k.kid] = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      }
      KEYS = keys;
      KEYS_AT = Date.now();
    } catch (e) {
      if (!KEYS) return null;
    }
  }
  return KEYS[kid] || null;
}

function b64bytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64text(s) { return new TextDecoder().decode(b64bytes(s)); }

/* ---------------------------------- răspunsuri ---------------------------------- */

function json(body) {
  return new Response(body, { headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" } });
}

function text(status, body) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" } });
}
