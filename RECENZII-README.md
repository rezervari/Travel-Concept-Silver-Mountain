# Cum actualizezi recenziile pe site (zero costuri, ~5 min/lună)

Toate 4 platformele (Google, Booking.com, Airbnb, Travelminit) se actualizează manual, în
același fișier: `reviews.json`. Nu există niciun API gratuit oficial la
niciuna dintre ele — Booking/Airbnb nu au avut niciodată, iar Google Places
API cere obligatoriu un cont de facturare (card) legat de proiect, chiar dacă
rămâi sub pragul gratuit.

## 1. Actualizează scorul general (`platforms`)

Deschide `reviews.json` și, pentru fiecare platformă, pune rating-ul și
numărul total de recenzii afișat pe pagina publică a locației:

```json
"google": {
  "label": "Google",
  "url": "https://maps.app.goo.gl/cZQhVEtjvEc3Wof48",
  "rating": 4.9,
  "totalReviews": 52,
  "scaleMax": 5
},
"booking": {
  "label": "Booking.com",
  "url": "PUNE_LINKUL_TĂU_BOOKING",
  "rating": 9.5,
  "totalReviews": 35,
  "scaleMax": 10
},
"airbnb": {
  "label": "Airbnb",
  "url": "PUNE_LINKUL_TĂU_AIRBNB",
  "rating": 4.9,
  "totalReviews": 24,
  "scaleMax": 5
}
```

- **Google**: scorul + numărul de recenzii apar direct pe profilul tău Google
  Business, sau pe Google Maps la locație.
- **Booking**: din extranet → secțiunea Recenzii, sus arată scorul (din 10)
  și numărul total.
- **Airbnb**: din pagina publică a anunțului, sub titlu.
- **Travelminit**: din pagina publică (https://travelminit.ro/apartament-travel-concept-silver-mountain-poiana-brasov), secțiunea „Recenzii de la oaspeți” (scor din 10).

## 2. Adaugă recenzii noi (`reviews`)

Copiază text + autor + dată + rating din recenzia reală (nu inventa/nu
parafraza excesiv — păstrează sensul exact ca să nu induci în eroare
oaspeții). Adaugă un obiect nou în array-ul `reviews`, în formatul:

```json
{
  "platform": "google",
  "author": "Numele afișat public",
  "rating": 5,
  "date": "2026-09-05",
  "text": "Textul recenziei, copiat sau rezumat fidel."
}
```

- `platform`: `"google"`, `"booking"`, `"airbnb"` sau `"travelminit"` — determină badge-ul,
  culoarea și scala (5 sau 10) afișate pe card.
- `rating`: pe scala nativă a platformei (5 pentru Google/Airbnb, 10 pentru
  Booking/Travelminit) — codul face conversia automat pentru afișare cu stele.
- `date`: format `YYYY-MM-DD`, sau `YYYY-MM` când platforma arată doar luna (Airbnb, Google) — se afișează „februarie 2025”.
- `lang`: limba originală (`ro`, `en`, `bg`, `de`…). **Textul se copiază în limba în care a fost scris**, nu traducerea platformei (pe Booking/Airbnb/Google apasă „Afișează originalul”).
- `translated: true` (opțional, de evitat): doar dacă nu găsești originalul → pe card apare „tradus automat”.
- Câmpuri opționale care umplu cardul (doar date reale, afișate de platformă la recenzia respectivă):
  - `title` — titlul scris de oaspete (Booking). NU pune eticheta automată a notei („Excepţional”, „Foarte bine” fără „!” etc.). `titleLang` dacă titlul e în altă limbă decât textul.
  - `travelerType` — „Familie”, „Grup”, „Cuplu”, „Călător neînsoțit”, „Familie cu copil mai mare”…
  - `nights` — număr (`4` → „4 nopți”) sau text (`"câteva nopți"` la Airbnb).
  - `tripType` — „Vacanță”/„Afaceri” (Google).
  - `categories` — note pe categorii date de oaspete, doar unde platforma le arată per recenzie (Google: Camere/Servire/Locație): `[{"label":"Camere","score":5}]`.
- Ce NU se pune: partea „Ce nu v-a plăcut” de pe Booking și orice detaliu negativ/operațional.
- Textele lungi se taie automat la 5 rânduri și apare linkul „Citește recenzia pe …” (spre `reviewsUrl` al platformei).

### Medii pe categorii (blocul de deasupra sliderului)
`platforms.booking.categories` = mediile afișate pe Booking (Personal, Facilități, Curățenie, Confort, Raport calitate/preț, Locație, WiFi). Actualizează-le odată cu scorul general. Booking NU publică notele pe categorii ale fiecărui oaspete — nu le inventa pe carduri.
- Recenziile fără text (doar notă) NU se adaugă ca și card — contează doar în `totalReviews`/`rating`.
- Nu se pun recenzii inventate sau „exemplu”: ajung și în JSON-LD (Google le poate penaliza).

Nu există limită de recenzii afișate — toate apar în tab-ul „Toate" și
filtrate corect pe tab-ul platformei lor. Cele mai vechi/multe recenzii pot
fi șterse periodic dacă lista devine prea lungă pentru slider.

## 3. Salvează + publică

Ca la orice altă modificare: `git add reviews.json`, `git commit`, `git
push` — GitHub Pages preia automat noul fișier, fără build sau deploy
suplimentar.

---

**Alternativă (dacă la un moment dat vrei automatizare doar pentru Google):**
dacă decizi vreodată să deschizi un cont de facturare Google Cloud (de ex.
pentru alte servicii Google ale afacerii), scriptul `update-google-reviews.js`
poate fi reintrodus — folosește Places API (New) și populează automat doar
blocul `google` din acest fișier, fără să afecteze Booking/Airbnb. Până
atunci, varianta manuală de mai sus e cea recomandată: zero cost, zero cont
de facturare, control total pe conținut.
