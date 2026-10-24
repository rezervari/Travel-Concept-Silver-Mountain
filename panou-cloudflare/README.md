# Panoul A13 pe Cloudflare (aplicație instalabilă)

Aceeași pagină ca panoul din Apps Script (`apps-script/Panou.html`, o singură sursă), servită de un Cloudflare Worker,
ca să se deschidă repede și să se poată instala ca aplicație pe telefon și laptop. **Tot restul rămâne în Apps Script**
(sincronizarea de 10 minute, Gmail, Sheet, yala, e-mailurile, Telegram, calendarul „A13 Direct”).

- Adresa: https://a13-panou.mircea-george-vulcanescu.workers.dev (până la domeniul propriu)
- Worker: `a13-panou` (cont Cloudflare mircea.george.vulcanescu@gmail.com), KV `a13-panou-kv`, cron la 5 minute

```
telefon / laptop → Cloudflare Access (doar proprietarul) → Worker a13-panou → Apps Script (doPost → pnApi)
                                                      ↘ KV: ultimele date (cron 5 min)
```

## Securitate

- **Cloudflare Access** pe „All traffic” (Worker → Access), politica reutilizabilă **„A13 Panou - doar Mircea”**
  (Emails = adresa proprietarului, sesiune 1 lună). Autentificarea: cod pe e-mail (one-time PIN).
- Worker-ul verifică și el tokenul Access (semnătură, AUD, emitent, expirare, e-mail = `OWNER_EMAIL`): dacă Access
  ar fi dezactivat din greșeală, pagina și `/api` răspund tot „Acces refuzat”.
- Spre Apps Script: implementarea „Calendar” (Anyone) + cheia `PN_API_TOKEN` (aceeași în Script Properties și în
  secretul Worker-ului). Cheia nu ajunge niciodată în browser.
- Fișierele din `public/` (manifest, iconițe, service worker) nu conțin date. Service worker-ul nu păstrează nimic
  (panoul are date personale și coduri de ușă).
- Sesiune pierdută (telefon pierdut): Zero Trust → Access controls → Applications → a13-panou → revocă sesiunile,
  sau Zero Trust → Users → utilizatorul → Revoke.

## Configurare

| Ce | Unde |
|---|---|
| `APPS_SCRIPT_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `wrangler.toml` (`[vars]`) |
| `PN_API_TOKEN`, `OWNER_EMAIL` | secrete: `npx wrangler@4 secret put <NUME>` |
| `PN_API_TOKEN` | și în Apps Script → Project Settings → Script Properties |

Cheia nouă (de ex. dacă trebuie schimbată): generată local și trimisă direct în secret + clipboard, fără să apară pe
ecran, apoi lipită în Script Properties:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > k.tmp && clip.exe < k.tmp && npx wrangler@4 secret put PN_API_TOKEN < k.tmp; rm k.tmp
```

## Publicare

Din acest folder (wrangler e deja autentificat pe calculatorul lui Mircea):

```bash
npx wrangler@4 deploy
```

- O modificare în `apps-script/Panou.html` → **și** `wrangler deploy` aici (pagina e inclusă în Worker la publicare),
  **și** Apps Script ca de obicei (panoul vechi rămâne ca rezervă).
- O modificare în `panou.gs` / `rezervari.gs` → Apps Script: salvare + implementarea „Calendar” pe versiune nouă
  (prin ea trec cererile Worker-ului).

## Instalare ca aplicație

- **Android (Chrome):** deschizi adresa → te autentifici cu codul primit pe e-mail → ⋮ → „Instalează aplicația” /
  „Adaugă pe ecranul de pornire”.
- **iPhone (Safari):** deschizi adresa → te autentifici → Partajează → „Adaugă pe ecranul principal”.
- **Laptop (Chrome / Edge):** iconița de instalare din bara de adrese.

Când va exista domeniul propriu: Worker → Domains → Custom domain (ex. `panou.<domeniu>`), aceeași politică Access,
`ACCESS_AUD` nou dacă se schimbă aplicația Access; aplicația instalată se reinstalează o dată (e legată de adresă).
