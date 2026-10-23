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
