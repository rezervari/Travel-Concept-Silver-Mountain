# A13 Travel Concept — sincronizare calendar & galerie foto

## Galerie foto
Pune pozele în folderele din `images/`, numite `1.jpg`, `2.jpg`, `3.jpg`... (fiecare categorie acceptă până la 6-8 poze):
- `images/living/` — living, luat masa, bucătărie
- `images/dormitor-mare/`
- `images/baie-mare/`
- `images/dormitor-mic/`
- `images/baie-mic/`
- `images/terasa-living/`
- `images/terasa-dormitoare/`

Pozele apar automat pe site, fără modificări de cod. Categoriile fără poze afișează un mesaj discret cu calea unde trebuie adăugate.

## Calendar (disponibilitate)

Pagina citește disponibilitatea instant din `booked-dates.json` (fișier local, nu mai apelează Google live). Acest fișier trebuie regenerat periodic.

## Regenerare manuală
```
node update-calendar.cjs
```

## Automatizare la câteva ore

**Opțiune A — server propriu (cPanel/VPS) cu cron:**
Adaugă în crontab (exemplu: la fiecare 3 ore):
```
0 */3 * * * cd /calea/catre/site && node update-calendar.cjs
```

**Opțiune B — GitHub Pages, fără server:**
Creează `.github/workflows/update-calendar.yml`:
```yaml
name: Update calendar
on:
  schedule:
    - cron: "0 */3 * * *"
  workflow_dispatch:
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node update-calendar.cjs
      - run: |
          git config user.name "bot"
          git config user.email "bot@users.noreply.github.com"
          git add booked-dates.json
          git commit -m "update calendar" || echo "no changes"
          git push
```

Nu ai nevoie de Node.js instalat pe calculatorul tău dacă folosești Opțiunea B — rulează automat pe GitHub.
