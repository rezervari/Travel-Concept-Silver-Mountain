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

## Fișiere generate automat — NU se editează manual
- `booked-dates.json` (din oră în oră, iCal direct de la Booking/Airbnb/Travelminit din secretele `ICS_BOOKING`/`ICS_AIRBNB`/`ICS_TRAVELMINIT`; fără secrete → Google Calendar; commit doar la schimbare), `pricing.json` (din `pricing/tarife.xlsx`),
  `aggregateRating`/`review` din JSON-LD în `index.html` (din `reviews.json`),
  toate `*.webp` + `images/gallery.json` (din JPG-uri) — prin GitHub Actions (`.github/workflows/`).
- Editate manual: `reviews.json` (vezi `RECENZII-README.md`), `pricing/tarife.xlsx` (Mircea).
- La modificări de conținut: actualizează `lastmod` în `sitemap.xml`.

Scripturi locale opționale: `update-google-reviews.js` (necesită `GOOGLE_PLACES_API_KEY` în env), `ask-gemini.js` (necesită `GEMINI_API_KEY`). Nu se hardcodează chei.

## Reguli tehnice învățate
- `package.json` are `"type": "module"` → orice script cu `require()` trebuie să fie `.cjs`.
- Fiecare entitate JSON-LD are `@id` unic (`#lodging`, `#website`) — altfel Google raportează dubluri.
- „A13 Travel Concept” rămâne în title, meta description, OG, JSON-LD, H1 hero, footer, chiar dacă brandul vizual e „Travel Concept”.
- Nu edita manual `aggregateRating`/`review` din JSON-LD — le suprascrie `update-schema.cjs`.
- Perioadele fără sezon în `tarife.xlsx` blochează intenționat rezervarea (fără preț implicit).
- Tarife: „fără discount” = doar coloana sejurului minim completată cu 0%, restul goale (sejururile mai lungi rămân permise; reducerea = max. prag ≤ nopți). Reducerea și sejurul minim se iau din sezonul zilei de check-in; prețul se calculează pe fiecare noapte după sezonul ei.
- Imagini din surse externe: doar licență liberă (Unsplash/Pexels), descărcate și urcate de Mircea.
- Site-ul live poate rămâne în urmă față de local → la bug-uri, verifică întâi live-ul.
- Imagini: Mircea urcă DOAR JPG (`images/<categorie>/N.jpg`, numerotare 1,2,3…); WebP + `gallery.json` le face workflow-ul. Nu se editează manual. JPG-urile rămân pentru OG/JSON-LD și ca fallback (JS trece pe JPG dacă WebP lipsește).
- Nu pune imagini de conținut ca `background-image` fără `image-set()` WebP; `.hero-photo` NU mai are background (se descărca hero-ul de 2 ori).
- A11Y Lighthouse: text ≥ 4.5:1 contrast (zile trecute `#707070`, fără tarif `#666` pe `#f2f2f2`, scor recenzii `#8a6000`); ținte de atingere ≥ 24×24 (dot-urile recenziilor au buton 24px + punct vizual în `::before`); titluri fără salt de nivel (lunile calendarului sunt `h3`).
- Sitemap: `sitemap.xml` (cu extensia image: pentru galerie/zonă, doar JPG-uri) + `sitemap.txt` ca rezervă. `robots.txt` din subfolderul proiectului e IGNORAT de Google (robots contează doar la rădăcina host-ului `rezervari.github.io/`, care dă 404 = acces permis). În Search Console sitemap-ul se trimite ca URL complet, în proprietatea URL-prefix `https://rezervari.github.io/Travel-Concept-Silver-Mountain/`. „Nu s-a putut prelua” la un sitemap nou e frecvent doar stare de așteptare.
- Alt-uri imagini: galerie în `GALLERY_ALTS` din `script.js` (pe categorie + număr poză). Când urci o poză nouă, adaugă-i alt-ul acolo; altfel primește alt generic. Alt descriptiv, ≤ ~125 caractere, brand/locație natural, fără înșirare de cuvinte-cheie. Imaginile din #zona sunt fundaluri CSS (stock), nu au alt și nu contează pentru Google Imagini.
- Cache-ul GitHub Pages e fix 10 min (nu se poate schimba) — ignoră auditul „cache TTL”.
- Footer: ordinea vizuală pe mobil e controlată cu `order` în CSS (markup: brand, contact, locație, sejur) — păstrează clasele `.foot-brand/.foot-contact/.foot-loc/.foot-stay`.
- Ghidul oaspetelui (StayBook) conține date operaționale (WiFi, loc parcare): pe site se prezintă doar conținutul general, fără coduri/parole/număr loc.
- Adresa de e-mail NU se afișează și NU apare în HTML: `#footMail` deschide `mailto:` doar la click, din `CONTACT_EMAIL` (compus din bucăți în `script.js`) — protecție anti-scraping.

## Politici afișate pe site
- Check-in după 16:00, check-out până la 11:00.
- Plată integrală după confirmare; suma nu se returnează la anulare.
- Nu se afișează „preț de pornire”. Rezumatul rezervării (fără date alese) arată scara reducerilor (`defaultDiscountTiers`) + perioadele de sărbători viitoare (sezoane cu `minNights` > global; „tarif fix” dacă nu au reduceri) — generate din `pricing.json` în `buildSummaryIntro()` (`script.js`). JSON-LD `priceRange`/`lowPrice`/`highPrice` se țin manual în sync cu `tarife.xlsx` (acum 900–1800).
- Capacitate: max. 4 adulți + max. 2 copii (selecturi `#fadults` 1–4, `#fchildren` 0–2).
- Taxe locale INCLUSE în preț, doar pentru adulți, calculate pe noapte: taxă turistică 7 RON/adult/noapte, taxă Salvamont 5 RON/adult/noapte (constante `TAX_TOURIST`/`TAX_SALVAMONT` în `script.js`). Afișate informativ în rezumat și în e-mailul de solicitare; NU se adaugă la total.

## Stare curentă
- [ ] Validare în Google Search Console a fix-ului JSON-LD (`#lodging`) după deploy — de confirmat.
- [x] Secțiunea politică plată/anulare + ore check-in/out — implementată.
- [x] Imagini `images/zona/` — urcate.
- [x] Pipeline tarife din Excel — implementat.
- [x] Alt-uri descriptive pentru hero, galerie (18 poze), lightbox (2026-09-23).
- [ ] Sitemap în Search Console (2026-09-23): sitemap.xml validat live (200, XML valid); adăugat image sitemap + sitemap.txt; de retrimis și de urmărit 3–7 zile.
- [x] Fix-uri accesibilitate PageSpeed (2026-09-23): contrast recenzii/calendar, ținte dot-uri recenzii, ordine titluri calendar.
- [x] Optimizare imagini PageSpeed (2026-09-23): WebP responsive pentru hero, galerie, zona + manifest galerie; de verificat PSI după deploy (țintă LCP mobil < 2,0 s).
- [x] Footer responsive (2026-09-23): 4 coloane desktop (brand, contact, locație, sejur), 2×2 la ≤900px; pe mobil (≤700px) brand full-width, Locație | Sejur pe 2 coloane, Contact full-width cu 3 butoane (Telefon `tel:+40744332234`, WhatsApp `wa.me/40744332234`, E-mail).

- [x] Secțiune nouă `#ghid` „Ghidul oaspetelui” (2026-09-23), între #facilitati și #recenzii: beneficii, machetă telefon CSS (aria-hidden), grilă 6 capitole, CTA „Rezervă Direct”. Iconițe noi în sprite: key, phone, pin, coffee, lifebuoy, door. Linkul public către ghidul StayBook NU e pus pe site (ghidul conține date WiFi/loc parcare) — decizie Mircea dacă îl adăugăm.

- [x] Formular rezervare (2026-09-23): câmpuri Adulți/Copii, validare capacitate, rând „Oaspeți” + bloc „Taxe incluse în preț” în rezumat, oaspeți + taxe în e-mailul `mailto`. FAQ (vizibil + JSON-LD) și highlight-ul apartamentului actualizate la „4 adulți + 2 copii”.

- [x] Tarife iarnă 2026–2027 (2026-09-23) în `tarife.xlsx`: iarna-2026 1300 (min 2, reduceri 10–33%), Crăciun 1500 (min 3, fără reducere), Revelion 1800 (min 4, fără reducere), iarna-2027 1350, Vacanță schi 1450 (min 2, reduceri 10–33%). După 07.03.2027 nu există sezon → rezervări blocate.
- [x] Rezumat rezervare (2026-09-23): eliminat „Prețul pornește de la 700 RON/noapte”; înlocuit cu scara reducerilor + perioade de sărbători (dinamic din `pricing.json`). JSON-LD actualizat la 900–1800 RON.

- [ ] Sincronizare calendar directă (2026-10-06): `update-calendar.cjs` citește iCal-urile platformelor, cron orar `17 * * * *`. De pus secretele în GitHub și de rulat manual workflow-ul. Calendarul Google importa de fapt Booking („CLOSED - Not available” 21.12.2026 → +18 luni = date închise pe Booking).

## Idei / backlog
- (de completat)
