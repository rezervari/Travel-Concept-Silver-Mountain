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
