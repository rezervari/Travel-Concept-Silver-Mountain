# CLAUDE.md — context de lucru A13 Travel Concept

> Fișier de context pentru Claude. Citește-l la începutul fiecărei sesiuni și actualizează secțiunea „Stare curentă” la finalul fiecărei sarcini.
> Ultima actualizare: 2026-09-23

## Proiect
- Site de rezervări directe (fără comision) pentru apartamentul **A13 Travel Concept – Silver Mountain**, Poiana Brașov.
- Producție: https://rezervari.github.io/Travel-Concept-Silver-Mountain/ (GitHub Pages, repo `rezervari/Travel-Concept-Silver-Mountain`, branch `main`).
- Stack: HTML/CSS/JS vanilla, fără framework-uri. Limba site-ului: română.

## Flux de lucru
1. Sursa de adevăr = acest folder local (clona repo-ului).
2. Claude citește și editează fișierele direct aici; creează fișiere/foldere noi când e nevoie.
3. Claude livrează la final: lista fișierelor modificate + mesaj de commit gata de copiat.
4. Mircea face deploy din PowerShell/Cursor:
   ```
   git add -A
   git commit -m "mesaj"
   git push
   ```
5. Workflow-urile GitHub Actions fac commit-uri automate (`booked-dates.json`, `pricing.json`, `index.html`) → **înainte de o sesiune nouă: `git pull`**, altfel apar conflicte la push.
6. Verificarea deploy-ului: se citește site-ul live și se compară cu local.

## Structură fișiere
| Fișier | Rol |
|---|---|
| `index.html` | Pagina unică. Conține meta SEO, OG, JSON-LD (`#lodging`, `#website`, FAQPage). Secțiuni: hero, #apartament, #galerie, #zona, #facilitati, #recenzii, #disponibilitate, #harta, #intrebari, #rezervare, trust |
| `styles.css` | Toate stilurile |
| `script.js` | IIFE; calendar, prețuri, galerie/lightbox, recenzii, formular (submit prin `mailto`) |
| `booked-dates.json` | Zile ocupate — **generat automat**, nu se editează manual |
| `pricing.json` | Tarife — **generat automat** din `pricing/tarife.xlsx` |
| `reviews.json` | Recenzii Google/Booking/Airbnb — editat manual (vezi `RECENZII-README.md`) |
| `pricing/tarife.xlsx` | Sursa tarifelor (Mircea o editează) |
| `images/<categorie>/N.jpg` | Galerie: living, dormitor-mare, dormitor-mic, baie-mare, baie-mic, terasa-living, terasa-dormitoare. Variante `N-600.webp` (miniatură) + `N.webp` (lightbox) — **generate automat** |
| `images/gallery.json` | Lista pozelor pe categorii (galeria nu mai sondează 1..max → fără 404) — **generat automat** |
| `images/zona/` | schi, drumetii, wellness, restaurante, brasov (.jpg + `X-800.webp` generat automat) |
| `hero-apartament.jpg` | Imagine LCP hero (1024×683); servit ca `hero-apartament-828.webp` / `hero-apartament.webp` prin `<picture>` + preload `imagesrcset` |
| `optimize-images.cjs` | Generează toate WebP-urile + `images/gallery.json` (sharp) |
| favicon-uri, `icon-*.png`, `site.webmanifest` | PWA/icons |
| `robots.txt`, `sitemap.xml` | SEO tehnic (actualizează `lastmod` la modificări de conținut) |

## Automatizări (GitHub Actions, `.github/workflows/`)
| Workflow | Declanșare | Script | Scrie |
|---|---|---|---|
| `update-calendar.yml` | la 3 ore + manual | `update-calendar.cjs` (ICS public Google Calendar) | `booked-dates.json` |
| `update-pricing.yml` | push pe `pricing/tarife.xlsx` + manual | `update-pricing.cjs` (npm `xlsx`) | `pricing.json` |
| `update-schema.yml` | push pe `reviews.json` + manual | `update-schema.cjs` | `aggregateRating` + `review` din JSON-LD în `index.html` |
| `optimize-images.yml` | push pe `images/**/*.jpg`, `hero-apartament.jpg` + manual | `optimize-images.cjs` (npm `sharp`) | `*.webp`, `images/gallery.json` |

Scripturi locale opționale: `update-google-reviews.js` (necesită `GOOGLE_PLACES_API_KEY` în env), `ask-gemini.js` (necesită `GEMINI_API_KEY`). Nu se hardcodează chei.

## Reguli tehnice învățate
- `package.json` are `"type": "module"` → orice script cu `require()` trebuie să fie `.cjs`.
- Fiecare entitate JSON-LD are `@id` unic (`#lodging`, `#website`) — altfel Google raportează dubluri.
- „A13 Travel Concept” rămâne în title, meta description, OG, JSON-LD, H1 hero, footer, chiar dacă brandul vizual e „Travel Concept”.
- Nu edita manual `aggregateRating`/`review` din JSON-LD — le suprascrie `update-schema.cjs`.
- Perioadele fără sezon în `tarife.xlsx` blochează intenționat rezervarea (fără preț implicit).
- Imagini din surse externe: doar licență liberă (Unsplash/Pexels), descărcate și urcate de Mircea.
- Site-ul live poate rămâne în urmă față de local → la bug-uri, verifică întâi live-ul.
- Imagini: Mircea urcă DOAR JPG (`images/<categorie>/N.jpg`, numerotare 1,2,3…); WebP + `gallery.json` le face workflow-ul. Nu se editează manual. JPG-urile rămân pentru OG/JSON-LD și ca fallback (JS trece pe JPG dacă WebP lipsește).
- Nu pune imagini de conținut ca `background-image` fără `image-set()` WebP; `.hero-photo` NU mai are background (se descărca hero-ul de 2 ori).
- A11Y Lighthouse: text ≥ 4.5:1 contrast (zile trecute `#707070`, fără tarif `#666` pe `#f2f2f2`, scor recenzii `#8a6000`); ținte de atingere ≥ 24×24 (dot-urile recenziilor au buton 24px + punct vizual în `::before`); titluri fără salt de nivel (lunile calendarului sunt `h3`).
- Cache-ul GitHub Pages e fix 10 min (nu se poate schimba) — ignoră auditul „cache TTL”.
- Footer: ordinea vizuală pe mobil e controlată cu `order` în CSS (markup: brand, contact, locație, sejur) — păstrează clasele `.foot-brand/.foot-contact/.foot-loc/.foot-stay`.
- Adresa de e-mail NU se afișează și NU apare în HTML: `#footMail` deschide `mailto:` doar la click, din `CONTACT_EMAIL` (compus din bucăți în `script.js`) — protecție anti-scraping.

## Politici afișate pe site
- Check-in după 16:00, check-out până la 11:00.
- Plată integrală după confirmare; suma nu se returnează la anulare.
- Preț de pornire afișat: 700 RON/noapte; reduceri pe durată din `pricing.json`.

## Stare curentă
- [ ] Validare în Google Search Console a fix-ului JSON-LD (`#lodging`) după deploy — de confirmat.
- [x] Secțiunea politică plată/anulare + ore check-in/out — implementată.
- [x] Imagini `images/zona/` — urcate.
- [x] Pipeline tarife din Excel — implementat.
- [x] Fix-uri accesibilitate PageSpeed (2026-09-23): contrast recenzii/calendar, ținte dot-uri recenzii, ordine titluri calendar.
- [x] Optimizare imagini PageSpeed (2026-09-23): WebP responsive pentru hero, galerie, zona + manifest galerie; de verificat PSI după deploy (țintă LCP mobil < 2,0 s).
- [x] Footer responsive (2026-09-23): 4 coloane desktop (brand, contact, locație, sejur), 2×2 la ≤900px; pe mobil (≤700px) brand full-width, Locație | Sejur pe 2 coloane, Contact full-width cu 3 butoane (Telefon `tel:+40744332234`, WhatsApp `wa.me/40744332234`, E-mail).

## Idei / backlog
- (de completat)
