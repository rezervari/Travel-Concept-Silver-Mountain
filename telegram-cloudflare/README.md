# Releul botului Telegram (`a13-telegram`)

Worker Cloudflare care primește mesajele trimise botului @A13TravelConceptBot (webhook) și le dă mai departe la Apps Script. Acolo `fin-telegram.gs` trece cheltuielile în „A13 – Sejururi și cheltuieli”.

- Adresa: https://a13-telegram.mircea-george-vulcanescu.workers.dev/ (aceeași în `FIN_TG_RELAY_URL` din `fin-telegram.gs`).
- Fără secrete și fără Cloudflare Access: Telegram nu se poate autentifica la Access. Worker-ul acceptă doar `POST` de pe IP-urile Telegram, cu antetul `X-Telegram-Bot-Api-Secret-Token`. Cheia se compară în Apps Script (`FIN_TG_SECRET`, generată de `finTgSetup`), apoi se verifică chatul (`TG_CHAT_ID`).
- Răspunde imediat „ok”, ca Telegram să nu retrimită mesajul. Trimite mai departe la implementarea „Calendar” (`APPS_SCRIPT_URL` din `wrangler.toml`), în fundal (`ctx.waitUntil`, max. 25 s).

## Publicare

```bash
npx wrangler@4 deploy
```

Apoi, o singură dată, în editorul Apps Script: `finTgSetup` (pornește webhook-ul și comenzile botului). Starea: `finTgStatus`. Oprire: `finTgStop`.

Erori: `npx wrangler@4 tail a13-telegram`.
