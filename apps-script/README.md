# Solicitări de rezervare prin Google Apps Script

Formularul de pe site trimite solicitarea direct (fără clientul de e-mail al oaspetelui) către un
web app Google Apps Script care rulează în contul tău Google. Pentru fiecare solicitare:

- **tu** primești un e-mail cu toate detaliile (Reply → îi scrii direct oaspetelui);
- **oaspetele** primește o confirmare a *primirii* solicitării (nu a rezervării);
- se adaugă un rând în Google Sheet, foaia **„Solicitări”** (coloana „Status” o completezi tu).

Gratuit. Limita Gmail personal: ~100 de e-mailuri/zi (= ~50 solicitări/zi).

## Instalare (o singură dată, ~10 minute)

1. **Google Sheet nou**: https://sheets.new → denumește-l „Rezervări site A13”.
2. În Sheet: **Extensii → Apps Script**. Se deschide editorul.
3. Șterge tot din `Code.gs` și lipește conținutul fișierului [`rezervari.gs`](rezervari.gs). Salvează (Ctrl+S).
4. **Test + permisiuni**: în bara de sus alege funcția `testSolicitare` → **▶ Run**.
   - Google cere permisiuni (trimitere e-mail, acces la Sheet). Alege contul tău.
   - Apare „Google nu a verificat această aplicație” — e normal pentru un script propriu:
     **Avansat → Accesează (nesigur)** → **Permite**.
   - Trebuie să primești 2 e-mailuri de test și să apară foaia „Solicitări” cu un rând.
5. **Publicare**: **Implementare (Deploy) → Implementare nouă**
   - Tip: **Aplicație web**
   - Execută ca: **Eu**
   - Cine are acces: **Oricine**
   - **Implementează** → copiază **URL-ul aplicației web** (se termină în `/exec`).
6. Trimite URL-ul lui Claude (sau pune-l tu în `script.js`, la `BOOKING_ENDPOINT`).
   URL-ul nu e secret — e doar adresa la care formularul trimite datele; adresa ta de e-mail nu apare nicăieri.

## Dacă modifici scriptul mai târziu

Salvarea nu ajunge automat la URL-ul public. După orice modificare:
1. lipește noul cod în `Code.gs` și salvează;
2. rulează o dată `testSolicitare` (▶ Run) — dacă Google cere o permisiune nouă (de ex. „conectare la un serviciu extern”, necesară pentru citirea `pricing.json` de pe site), acord-o;
3. **Implementare → Gestionează implementările → ✏️ Editează → Versiune: Versiune nouă → Implementează**.
URL-ul rămâne același.

## Foaia „Solicitări”

Coloane: Primită la, Nume, Telefon, Email, Check-in, Check-out, Nopți, Adulți, Copii, Preț bază, Reducere %,
Total RON, Status, **Sursă**, **Referrer**, **Verificare**. La o foaie creată de versiunea veche, antetele noi se
adaugă automat la prima solicitare.

- **Sursă** — de unde a venit vizitatorul: parametrii UTM din link (ex. `google / organic · gbp · rezervare`),
  altfel site-ul de proveniență (`referrer: www.facebook.com`) sau `direct`.
- **Verificare** — `OK` sau ce nu corespunde (preț diferit de tarifele site-ului, zile ocupate, nopți fără tarif);
  atunci Status = „De verificat”, iar subiectul e-mailului începe cu „[De verificat]”.

## Protecții incluse

- câmp ascuns anti-roboți (honeypot);
- max. 3 solicitări/oră de la aceeași adresă de e-mail și 10/oră în total;
- validarea datelor (e-mail, date, sejur max. 60 de nopți, capacitate max. 4 adulți + 2 copii, nume fără linkuri);
- prețul, nopțile și taxele se recalculează din `pricing.json` de pe site, iar perioada se verifică față de
  `booked-dates.json` — un preț trimis greșit (sau falsificat) nu ajunge în e-mailul oaspetelui;
- pentru date fără tarif publicat, oaspetele vede „Preț de confirmat”, nu o sumă;
- textul care începe cu `=`, `+`, `-`, `@` nu e interpretat ca formulă în Sheet;
- dacă se termină cota zilnică de e-mail, rândul se salvează în Sheet și site-ul trece pe varianta cu clientul de e-mail;
- dacă trimiterea eșuează, site-ul deschide automat varianta veche (clientul de e-mail), ca să nu se piardă solicitarea.

# Evidența rezervărilor pentru check-in (`checkin.gs`) — Faza 1

Din 10 în 10 minute, scriptul ține la zi foaia **„Rezervări”** din același Sheet:

- **Booking** — citește din Gmail e-mailurile „Booking.com - Rezervare nouă! / Rezervare anulată!”. E-mailul are
  doar numărul rezervării și data sosirii; **data plecării** se ia din calendarul iCal Booking (rezervarea care
  începe în ziua sosirii). E-mailurile citite primesc eticheta **A13-procesat** în Gmail.
- **Site** — solicitările din foaia „Solicitări” la care pui în coloana **Status** „Confirmată” (după plată) sau
  „Anulată”. Coloana are acum o listă de alegere; datele corectate în „Solicitări” se preiau și în „Rezervări”.
- **Anulările** se mută în foaia **„Anulate”**. Tot ce face scriptul se notează în foaia **„Jurnal”**.

Faza 1 **nu** trimite mesaje oaspeților și nu atinge yala (coloanele „Fișă…” / „Cod…” rămân goale).

## Instalare (o singură dată)

1. În Sheet-ul „Rezervări site A13”: **Extensii → Apps Script** (același proiect cu `rezervari.gs`).
2. **➕ (Adaugă fișier) → Script** → numele `checkin` → lipește conținutul fișierului [`checkin.gs`](checkin.gs) → salvează.
3. **⚙️ Project Settings → Script Properties → Add script property**: cheia `ICS_BOOKING`, valoarea = linkul de
   export iCal din Booking (Extranet → Tarife și disponibilitate → Sincronizare calendare → Export; e același link ca
   secretul GitHub `ICS_BOOKING`). Linkul e secret: nu se pune în cod.
4. Alege funcția `checkinSync` → **▶ Run**. Google cere permisiuni noi (citirea Gmail și etichete, Sheet,
   conectare la un serviciu extern): **Avansat → Accesează (nesigur) → Permite**. Apar foile „Rezervări”,
   „Anulate”, „Jurnal”.
5. Alege funcția `checkinInstall` → **▶ Run**: pornește rularea automată din 10 în 10 minute și pune lista pe
   coloana Status din „Solicitări”.

**Verificare calendar:** funcția `checkinVerificaCalendar` → **▶ Run** arată în Execution log câte evenimente vede
scriptul în calendarul Booking (doar datele, fără link). Trebuie să apară rezervările viitoare; „0 evenimente” =
linkul din `ICS_BOOKING` nu e cel bun (e același link ca la GitHub, din Sincronizare calendare a apartamentului).

**Nu** e nevoie de „Implementare → versiune nouă”: declanșatorul rulează mereu codul salvat, iar formularul de pe
site (web app-ul din `rezervari.gs`) nu e afectat. Oprire: rulează `checkinUninstall` (foile rămân).
După o modificare a `checkin.gs`: lipești codul nou și salvezi — atât.

## Foaia „Rezervări”

- **Nr. rezervare** — numărul Booking sau `SITE-AAAALLZZ-hhmmss` (din „Primită la” al solicitării).
- **Stare** — o scrie scriptul:
  - `Confirmată`;
  - `Fără dată de plecare (aștept calendarul Booking)` — rezervare nouă care încă nu apare în iCal (se completează singură);
  - `De verificat: nu mai apare în calendarul Booking` — datele s-au schimbat sau rezervarea a dispărut din calendar;
    scriptul NU o anulează singur;
  - `De verificat` — a venit alt tip de e-mail Booking despre rezervare (de ex. o modificare); rămâne așa până îl
    schimbi tu în `Confirmată`.
- **Note** și coloanele adăugate de tine se păstrează (coloanele proprii nu se mută în „Anulate”).
- Rezervările cu sosirea trecută nu se mai importă; cele deja în foaie rămân.

# Yala TTLock (`ttlock.gs`) — Faza 2, pasul 1: legătura (doar citire)

Verifică legătura cu TTLock Open Platform (serverul EU, `euapi.ttlock.com`): token + lista yalelor, gateway,
versiunea de coduri, bateria, câte coduri există. **Nu** creează, nu modifică și nu șterge nimic pe yală.

1. În același proiect Apps Script: **➕ → Script** → numele `ttlock` → lipește [`ttlock.gs`](ttlock.gs) → salvează.
2. **⚙️ Project Settings → Script Properties** — adaugă (le completezi tu, nu se pun în cod):
   - `TTLOCK_CLIENT_ID`, `TTLOCK_CLIENT_SECRET` — de la aplicația aprobată pe [euopen.ttlock.com](https://euopen.ttlock.com) → Management;
   - `TTLOCK_USERNAME` — contul cu care intri în aplicația TTLock (telefonul sau e-mailul);
   - `TTLOCK_PASSWORD` — parola acelui cont (după primul pas rămâne doar ca MD5, în `TTLOCK_PASSWORD_MD5`).
3. Alege funcția `ttlockSetup` → **▶ Run** (permisiunea „serviciu extern” există deja). În Execution log trebuie să
   apară yala: `lockId …, gateway: da, versiune coduri: …, coduri: N`. Mai târziu, pentru o verificare: `ttlockTest`.

Codurile și numele lor nu se afișează în log; tokenul (90 de zile) se reînnoiește singur.

# Termostatele Salus iT600 (`salus.gs`): încălzirea după rezervări + geamuri uitate

Salus nu are API public. `salus.gs` folosește drumul aplicației Salus Smart Home, descoperit de binding-ul openHAB
„salus-aws-bridge”: login Amazon Cognito (SRP, parola nu pleacă spre server), chei AWS temporare, lista dispozitivelor
de la `service-api.eu.premium.salusconnect.io`, starea fiecărui dispozitiv din AWS IoT și, pentru comenzi, publicarea
pe topicul `shadow/update` al termostatului. API-ul e neoficial, deci Salus îl poate schimba fără anunț. Contul Salus
are mai multe proprietăți; scriptul lucrează doar pe **„Cora Silver”** (apartamentul A13), iar pe celelalte nu le
citește. Alt nume se poate pune în Script Property `SALUS_HOME`.

**Automatizarea** (pas în `checkinSync`, la 10 minute; pornită cu `salusPornire`, oprită cu `salusOprire`):

- **Încălzirea, după sejururile reale** (Booking și site din „Rezervări”, Airbnb „Reserved” și Travelminit din iCal;
  blocările nu contează): în ziua sosirii, **de la 07:00 → 23 °C** pe toate 4 termostatele, manual permanent, taste
  deblocate; în ziua plecării, **de la 11:00 → 21 °C** (dacă nu sosește altcineva în aceeași zi). Se trimite doar la
  aceste momente și doar ce diferă, așa că ce reglează oaspetele între ele rămâne. La rularea următoare se verifică
  dacă termostatele au preluat comanda; cele rămase în urmă o primesc din nou după 20 și 40 de minute, iar după o oră
  vine o alertă. În Jurnal / pe Telegram (fără sunet): „Încălzire 23,0 °C …”, „Încălzire confirmată”.
- **Geamuri uitate**: un senzor deschis de **cel puțin o oră** și camera (termostatul ei) **sub 20 °C** → o alertă
  (Telegram cu sunet + e-mail), o dată pe deschidere; la închidere, „Geam închis” fără sunet. Deschiderile scurte nu
  trimit nimic. Un senzor fără semnal de 2 ore (de obicei bateria) → o alertă; starea lui veche nu contează.
- **Bateriile** tuturor celor 13 echipamente: termostatele raportează nivel 0–5 (slabă la 1 sau cu alarma `Error32`),
  capetele termostatice doar alarma de baterie slabă (`TRVError22` pe cap; `Error22` pe termostatul lor = „un cap
  asociat are baterie slabă”), senzorii tensiunea (≥ 2,6 V plină, ≥ 2,3 V pe jumătate, ≥ 2,1 V slabă, sub = critică,
  pragurile aplicației web Salus după integrarea Home Assistant din comunitate; alertă sub 2,3 V sau cu alarma
  senzorului). O alertă când un echipament trece pe baterie slabă, „Baterie schimbată” fără sunet după schimbare
  (doar la echipamente citite și online). În panou: cardul „Baterii” (slabele primele) și „De făcut”; în rezumat: 🔋.
- `salusPlan` arată, fără să schimbe nimic, sejururile văzute (cu orele), ce ar face automatizarea acum, termostatele
  și senzorii. `salusDetalii` arată toate valorile raportate (blocare taste, deschis/închis, baterii).
- Starea automatizării stă în Script Property `SAL_STATE` (o scrie scriptul), pornit/oprit în `SALUS_HEATING`.
- **În panou** (secțiunea Sistem): cardul „Încălzire” (automatizare pornită/oprită, modul de acum, următoarea schimbare,
  fiecare termostat cu temperatura din cameră → cea setată, modul, taste blocate, „încălzește”) și cardul „Senzori geam /
  ușă” (închis / DESCHIS de la … / FĂRĂ SEMNAL din …, baterie, temperatură). La „De făcut” apar incidentele pentru care
  a plecat deja alerta: geam uitat, senzori fără semnal, comandă nepreluată. Citirea de la Salus (`salPanelStatus`) stă
  în cache 15 minute (⟳ citește din nou; după o comandă se golește). **În rezumatul de la 08:00** (Telegram): paragraful
  🌡️ cu modul, următoarea schimbare, temperatura din fiecare cameră, geamurile deschise și senzorii fără semnal.

1. În același proiect Apps Script: **➕ → Script** → numele `salus` → lipește [`salus.gs`](salus.gs) → salvează.
2. Alege funcția `salusViteza` → **▶ Run** (nu cere cont și nu folosește rețeaua). În log trebuie să apară
   `Calcul cu numere mari: corect · … calculul unui login SRP X s`. Dacă apare „GREȘIT”, te oprești aici.
3. **⚙️ Project Settings → Script Properties** — adaugă (le completezi tu, nu se pun în cod):
   - `SALUS_USERNAME` — e-mailul cu care intri în aplicația Salus Smart Home;
   - `SALUS_PASSWORD` — parola acelui cont. După primul login reușit rămâne doar ca hash (`SALUS_PASSWORD_HASH` +
     `SALUS_SRP_USER`), iar cea în clar se șterge. Dacă schimbi parola în aplicație, o pui din nou aici.
4. Alege `salusSetup` → **▶ Run**. În log apar proprietățile din cont, apoi dispozitivele din „Cora Silver”, de exemplu
   `— „T Living” · model: SQ610RFNH · … ep9: cameră 22,7 °C · setat 22,0 °C · mod: manual permanent`.
   Mai târziu, pentru o verificare: `salusTest`. La o eroare: `salusDiagnoza`, care arată pasul care nu merge
   (date lipsă, login, proprietăți, dispozitive, stare) și verifică dacă nu cumva contul e încă pe cloud-ul vechi Salus.
5. `salusPlan` (verifici ce ar face), apoi `salusPornire`: pune imediat modul potrivit (între sejururi 21 °C) și după
   20 de secunde arată ce raportează termostatele. `checkin.gs` (pasul `salSync`) și `telegram.gs` (regula
   „Încălzire / Geam închis / Senzor din nou online”) trebuie să fie și ele la zi.

Parola, tokenurile și cheile AWS nu apar în log; din ID-urile dispozitivelor apar doar ultimele 4 caractere. Sesiunea
(refresh token) stă în `SALUS_REFRESH_TOKEN`, tokenurile de o oră doar în cache. Un cont cu verificare în doi pași nu
merge: scriptul spune asta clar, iar soluția e un cont separat fără ea, dacă aplicația permite partajarea.

# Sosirea automată (`checkin.gs`) — Faza 2: fișă → cod pe yală → e-mail

După Faza 1 și legătura TTLock, `checkinSync` (același declanșator, la 10 min) duce și sosirea, în pași izolați:

- **Linkul spre fișă** — rezervările de pe site (avem e-mail): cu o zi înainte, de la **10:00**, un e-mail cu
  fișa fisacazare precompletată doar cu datele sejurului. Booking (fără e-mail): linkul pleacă prin **mesajul
  programat din Extranet**; scriptul doar notează asta.
- **Fișa completată** → codul = **ultimele 6 cifre ale telefonului**, pus pe yală prin gateway, valabil din ziua
  sosirii **16:00** până în ziua plecării **11:00**; oaspetele primește pe e-mail codul + ghidul (Booking: codul
  pleacă pe e-mailul trecut în fișă).
- **Reminder la 13:00** (ziua sosirii, fișă necompletată): site = e-mail de reminder către oaspete; Booking = un
  e-mail la tine cu textul (RO + EN) gata de lipit în chatul Booking.
- **Cod de rezervă la 16:00** (fișă tot necompletată): un cod aleator de 6 cifre pe yală (16:00 → 11:00), etichetat
  „· REZERVĂ”. Site = e-mail cu codul la oaspete; Booking/fără e-mail = e-mail la tine cu textul de lipit. Dacă fișa
  vine mai târziu, codul rămâne cel de rezervă (nu se mai face altul).
- **După plecare (12:00)** sau **la anulare** → codul se șterge de pe yală; la anulare primești și nopțile de
  deblocat pe Airbnb/Travelminit.

Erorile (ex. gateway offline) se notează în foaia „Jurnal” și îți vin pe e-mail cel mult o dată la 6 h; scriptul
reîncearcă la fiecare rulare.

**Mod test (implicit):** Script Property `CHECKIN_TEST_MODE` lipsă sau ≠ `0` → e-mailurile pentru oaspeți vin la
tine, cu `[TEST → adresă]` în subiect; **codurile se pun totuși pe yală**. Pentru funcționare reală: `CHECKIN_TEST_MODE` = `0`.
Test fără oaspete real: `checkinTestRezervare` (creează un rând cu sosirea azi) → completezi fișa de test → la
rularea următoare vezi codul pe yală și e-mailul; curăță cu `checkinStergeTest`.

După o modificare a `checkin.gs`: lipești codul nou în editor și salvezi — atât (fără „Deploy → versiune nouă”).

# Panoul de control (`panou.gs` + `Panou.html`)

O pagină doar pentru tine, gândită pentru **laptop** (două coloane) și **telefon** (bara de jos: Acasă / Solicitări /
Jurnal / Sistem), care citește același Sheet:

- **De făcut** — solicitările noi de pe site (WhatsApp / Sună / E-mail / rândul din Sheet), textele de lipit în
  chatul Booking (reminderul de fișă de la 13:00 și codul de rezervă de la 16:00, RO + EN, cu buton **Copiază**),
  alertele încă de actualitate (cod nepus, cod neșters, telefon lipsă …), rezervările „De verificat”. **Gata** ascunde
  un element (Script Property `PN_DISMISSED`).
- **Sejururi** — fiecare rezervare cu pașii: link fișă → fișă → cod pe yală → cod trimis → cod șters, codul și
  linkurile (Extranet, WhatsApp, telefon), **Istoric** = jurnalul acelei rezervări.
- **Jurnal** — foaia „Jurnal” + solicitările de pe site, cu filtre (Site, Rezervări, Fișe, Coduri, Erori).
- **Sistem** — ultima sincronizare (`CI_LAST_RUN`, scris de `checkinSync`), mod test/real, yala (baterie, gateway,
  codurile valabile — ascunse până apeși „Arată codurile”), tokenul TTLock, calendarul de pe site, cota de e-mail,
  erorile din ultimele 24 h, linkuri utile.

Butonul ⟳ reîncarcă datele (yala și calendarul se cer din nou), **Sincronizează** rulează acum `checkinSync`.
Pagina se reîncarcă singură la 2 minute cât e deschisă.

**Cine o vede:** doar contul proprietarului. `doGet` (în `rezervari.gs`) servește panoul numai dacă cel autentificat
e contul sub care rulează scriptul; oricine altcineva (inclusiv web app-ul public al formularului) primește în continuare
`{"ok":true,…}`. Toate funcțiile panoului verifică din nou contul.

## Instalare (o singură dată)

1. În editorul Apps Script (același proiect): **➕ → Script** → numele `panou` → conținutul [`panou.gs`](panou.gs);
   **➕ → HTML** → numele `Panou` → conținutul [`Panou.html`](Panou.html). În `Cod.gs` (rezervari.gs) și `checkin`
   pune versiunile noi (`doGet` și linia `CI_LAST_RUN`). Salvează.
2. **Deploy → New deployment → Web app**: Description „Panou”, **Execute as: Me**, **Who has access: Only myself**
   → Deploy → copiază URL-ul (`…/exec`). Implementarea publică a formularului NU se atinge.
3. Deschide URL-ul pe laptop și pe telefon (contul mircea.george.vulcanescu@gmail.com) → pe telefon:
   **Adaugă pe ecranul de pornire**.

Dacă pagina arată `{"ok":true,…}` în loc de panou: Google nu a dat adresa contului → la implementarea „Panou” pune
**Execute as: User accessing the web app** (rămâne „Only myself”). Dacă apare „Nu se poate deschide fișierul”:
browserul are mai multe conturi Google și l-a ales pe altul → deschide linkul într-un profil/fereastră doar cu contul tău.

## După o modificare a panoului

Salvează în editor, apoi **Deploy → Manage deployments → „Panou” → ✏️ → Version: New version → Deploy**
(URL-ul rămâne același). Implementarea publică a formularului rămâne pe versiunea ei până o actualizezi separat.

## Panoul ca aplicație, pe Cloudflare

Aceeași pagină rulează și pe Cloudflare, ca aplicație instalabilă, mai rapidă, fără problema conturilor Google
(vezi [`panou-cloudflare/README.md`](../panou-cloudflare/README.md)). Worker-ul cheamă funcțiile panoului prin
`doPost` → `pnApi` (în `panou.gs`), prin implementarea **„Calendar”** (Anyone), cu cheia **`PN_API_TOKEN`** din Script
Properties (aceeași în secretul Worker-ului). Fără cheia corectă: `{"ok":false,"error":"auth"}`; doar funcțiile
panoului (`pnData`, `pnSyncNow`, `pnDismiss`, `pnBlock`, `pnUnblock`, `pnSetRequestStatus`). La o modificare în
`panou.gs` / `rezervari.gs`: implementarea „Calendar” pe versiune nouă; la o modificare în `Panou.html`: și
`npx wrangler@4 deploy` din `panou-cloudflare/`.

# Calendarul și blocările (`calendar.gs`) — „A13 Direct”

În panou, tab-ul **Calendar** (pe laptop două luni, pe telefon una): fiecare noapte colorată după sursă — Booking,
Airbnb (rezervare), Site, **închis de tine**, **aștept plata**, indisponibil pe o platformă — cu prețul și sejurul minim
de pe site pe nopțile libere. Atingi o noapte → detaliile (și „Redeschide” pentru perioadele închise de tine).

**Închide o perioadă:** butonul „Închide o perioadă” → atingi prima și ultima noapte → motiv (opțional) → „Închide
perioada”. Se salvează în foaia **„Blocări”** (Id, Prima noapte, Ultima noapte, Motiv, Creată la; o perioadă identică
cu una deja închisă nu se mai adaugă) și intră în
calendarul iCal **„A13 Direct”**, pe care îl importă Booking, Airbnb, Travelminit și site-ul. Platformele recitesc
calendarele importate după programul lor (de obicei în câteva ore) → pentru azi/mâine închide și manual pe Booking.

**Ce intră în „A13 Direct”** (doar surse proprii):
- perioadele închise din panou;
- rezervările de pe site confirmate (Status „Confirmată” după plată → rând „Site” în „Rezervări”);
- solicitările cu Status **„Așteaptă plata”**, ca blocare temporară de 24 h de la momentul în care scriptul vede statusul
  (termenul de plată). După 24 h blocarea se ridică singură și primești un e-mail; confirmi sau anulezi din panou.

**REGULA (incidentul din 23.10.2026):** în „A13 Direct” NU intră niciodată rezervările sau blocările venite de la
Booking/Airbnb/Travelminit — Booking și-ar importa propriile rezervări și le-ar scoate din export. Codul citește
doar foaia „Blocări”, rândurile „Site” cu număr `SITE-…` și solicitările „Așteaptă plata”.

**Butoanele solicitărilor** (în „De făcut” și în tab-ul Solicitări): **Aștept plata** / **Plătit · confirmă** /
**Anulează** (a doua apăsare confirmă). Scriu Status-ul în foaia „Solicitări” și rulează imediat sincronizarea:
confirmarea creează rezervarea (fișa cu o zi înainte, codul, „A13 Direct”).

**Suprapuneri:** la fiecare sincronizare (10 min) se compară rezervările reale — Booking și site din „Rezervări”,
Airbnb „Reserved” din iCal-ul Airbnb, solicitările „Așteaptă plata” active. O suprapunere → e-mail „SUPRAPUNERE” (o
singură dată pe pereche) + alertă în „De făcut”. Blocările („Not available”, „CLOSED”) nu declanșează alarma.

## Instalare (o singură dată, după panou)

1. Editor: **➕ → Script** `calendar` → conținutul [`calendar.gs`](calendar.gs); actualizează și `Cod.gs` (doGet cu `?cal=`),
   `checkin` (pasul `calSync`), `panou`, `Panou`. Salvează.
2. **Deploy → New deployment → Web app**: Description „Calendar”, **Execute as: Me**, **Who has access: Anyone** →
   Deploy → copiază URL-ul `…/exec`.
3. **⚙️ Project Settings → Script Properties**: `CAL_FEED_BASE` = URL-ul de la pasul 2; `ICS_AIRBNB` și `ICS_TRAVELMINIT` =
   linkurile de export iCal ale platformelor (aceleași ca secretele GitHub) — pentru culorile din calendar și alarma de
   suprapunere. Cheia secretă `CAL_FEED_TOKEN` se creează singură la prima deschidere a panoului.
4. Panou → Sistem → „Calendarul A13 Direct” → **Copiază linkul** și pune-l ca **import**:
   Booking (Extranet → Tarife și disponibilitate → Sincronizați calendarele → Adăugați o conexiune → import),
   Airbnb (calendarul anunțului → setările de disponibilitate → importul de calendar), Travelminit (importul iCal din admin) și în
   GitHub ca secret **`ICS_DIRECT`** (site-ul îl citește din oră în oră; dacă nu răspunde, site-ul păstrează zilele ocupate
   și rularea apare ca eșuată, fără să oprească celelalte surse).
5. Test: închide din panou o noapte liberă de peste câteva săptămâni → după sincronizarea platformelor apare
   indisponibilă pe Booking, Airbnb, Travelminit și pe site → „Redeschide”.

Linkul conține cheia secretă: nu se pune în cod sau în repo. Dacă ajunge unde nu trebuie: șterge `CAL_FEED_TOKEN`
(se creează alta) și pune linkul nou pe platforme. După o modificare a `calendar.gs`: salvează + **Manage deployments →
„Calendar” și „Panou” → New version** (feed-ul vine din implementarea „Calendar”).

# Notificări pe telefon prin Telegram (`telegram.gs`)

Botul A13 îți trimite pe Telegram (telefon + calculator) tot ce se întâmplă:

- **cu sunet:** solicitare nouă de pe site (cu WhatsApp, telefonul copiabil, rândul din Sheet), rezervare nouă pe
  Booking (buton Extranet), date / plecare modificate, toate alertele de pe e-mail — textele de lipit în chatul Booking
  (reminder 13:00, cod de rezervă 16:00) apar ca **blocuri gri: atingi textul și se copiază**, RO și EN separat —,
  anulări, erori, suprapuneri, plată neîncasată în 24 h, rezumatul zilnic de la 08:00;
- **fără sunet** (grupate într-un singur mesaj pe rulare): fișă primită, link fișă trimis, cod trimis / șters, plecare
  din calendar, perioade închise / redeschise și status-uri schimbate din panou;
- **niciodată:** evenimentele care se repetă la fiecare 10 minute cât durează o eroare (pentru ele pleacă o singură
  alertă) și cele dublate de o alertă.

Mesajul pleacă înaintea e-mailului; dacă Telegram nu răspunde, e-mailurile pleacă la fel ca înainte. GitHub Actions
trimite și el un mesaj la orice rulare eșuată (calendar, prețuri, imagini, recenzii). `TG_ENABLED` = `0` în Script
Properties oprește temporar notificările.

## Supraveghere: yala și automatizarea

- **Yala** (`ciLockHealth` în `checkin.gs`, la fiecare rulare de 10 minute, din citirea TTLock a panoului — cel mult
  o dată la 15 minute): **gateway offline** la două citiri la rând, **baterie** sub 30% (încă o alertă sub 15%),
  **TTLock fără răspuns** de 2 ore → câte o alertă pe incident (Telegram cu sunet + e-mail), cu sosirile de azi și
  mâine și dacă au deja codul pe yală. Problema apare și la „De făcut” în panou. Când trece („gateway din nou
  online”, „TTLock răspunde din nou”, „baterii schimbate” = peste 50%) vine un mesaj fără sunet. Incidentele în curs
  stau în Script Property `CI_LOCK_HEALTH` (nu se editează de mână).
- **Automatizarea însăși:** dacă declanșatorul de 10 minute se oprește, Apps Script nu mai poate anunța nimic. De
  aceea feed-ul „A13 Direct” conține ora ultimei rulări reușite (`X-A13-LAST-SYNC`, ignorată de platforme), iar
  robotul GitHub („Update calendar”, din oră în oră) dă alarmă pe Telegram dacă e mai veche de 60 de minute: prima
  cu sunet, apoi din oră în oră fără sunet, până se rezolvă. Ce verifici atunci în Apps Script: ⏰ Triggers
  (`checkinSync` există?) și ☰ Executions (erori, ex. permisiune nouă cerută → rulează `checkinSync` o dată din editor
  și acceptă). După o modificare a lui `calendar.gs`, implementarea „Calendar” trebuie trecută pe o versiune nouă,
  altfel feed-ul nu conține ora (GitHub scrie atunci în log că verificarea e sărită).

## Instalare (o singură dată)

1. **Tu, în Telegram:** caută **@BotFather** (are bifă albastră) → `/newbot` → nume: `A13 Notificări` → username
   (unic, se termină în `bot`, ex. `A13TravelConceptBot`). BotFather îți dă o **cheie** (`123456789:AA…`). Deschide
   botul nou (linkul `t.me/<username>`) și apasă **Start**.
2. **Tu, în Apps Script:** ⚙️ Project Settings → Script Properties → `TG_BOT_TOKEN` = cheia. Cheia e secretă: nu o
   pune în cod, în repo sau în e-mailuri.
3. Editor: **➕ → Script** `telegram` → conținutul [`telegram.gs`](telegram.gs); actualizează `Cod.gs`, `checkin`,
   `calendar`; salvează. Script Property `PANOU_URL` = linkul implementării „Panou” (butonul „Panou” din mesaje).
4. Rulează **`tgSetup`** (▶ Run): găsește chatul tău, pornește rezumatul de la 08:00 și îți trimite „Notificările A13
   sunt conectate”. **`tgTest`** trimite câte un exemplu din fiecare fel de mesaj.
5. **Deploy → Manage deployments**: „Panou”, „Calendar” **și implementarea formularului** (pentru solicitările de pe
   site) → New version.
6. GitHub → Settings → Secrets → Actions: `TELEGRAM_BOT_TOKEN` (aceeași cheie) și `TELEGRAM_CHAT_ID` (din Script
   Property `TG_CHAT_ID`). Verificare: Actions → **Test Telegram** → Run workflow — trebuie să vină pe Telegram
   „✅ GitHub: alertele pentru rulările eșuate ajung aici”; dacă rularea e roșie, mesajul de eroare spune de ce
   (401 = cheie greșită, 400 „chat not found” = chat greșit).
