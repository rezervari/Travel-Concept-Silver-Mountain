# Generatorul Excelului de prețuri

Construiește `tarife Platforme.xlsx` (copiat ca `pricing/tarife.xlsx`), cu toate foile și formulele, din datele unui fișier existent. Îl folosești doar când se schimbă **structura** tabelului: foi, coloane sau formule noi. Prețurile, perioadele și setările se modifică direct în Excel.

## Ce păstrează din fișierul existent

- **Perioade:** din foaia „Perioade”, sau din „Sezoane” (formatul de dinainte de 25.10.2026, cu tipul reducerilor dedus din procente).
- **Celulele galbene** din „Setări”, „Simulator” și „Calendar”, plus starea din „Checklist” (dacă rândul are același text).
- **Foaia „Date actuale”**, copiată ca atare.

Celula „Reducere săptămânală” din „Setări” rămâne formulă, cu excepția cazului în care în fișier ai scris o valoare fixă.

## Rulare (PowerShell sau Git Bash, cu Excel instalat)

```bash
NODE_PATH="<repo>/node_modules" node build-spec.cjs "<fișier existent>.xlsx" spec.json
powershell -NoProfile -ExecutionPolicy Bypass -File apply-spec.ps1 -Spec spec.json -Old "<fișier existent>.xlsx" -Out "<fișier nou>.xlsx"
NODE_PATH="<repo>/node_modules" node verify.cjs "<fișier nou>.xlsx" "<fișier existent>.xlsx"
```

- `build-spec.cjs` scrie lista de operații: valori, formule, formate, nume definite, liste, formatare condiționată.
- `apply-spec.ps1` le aplică prin Excel COM, recalculează și salvează. Doar Excel calculează formulele, iar `update-pricing.cjs` citește valorile salvate.
- `verify.cjs` caută erori în celule și compară prețurile calculate de Excel cu un model JS independent (cu parametrii din „Setări”). Compară și „Export site” cu fișierul existent: diferențele sunt normale doar dacă ai schimbat perioadele.

## Înainte să înlocuiești fișierul

1. Rulează scriptul de pe site pe o copie și verifică `pricing.json`: în afară de `generatedAt`, trebuie să fie același ca înainte.
2. Abia apoi copiază fișierul nou peste `C:\Users\mirce\Documents\Silver Mountain\tarife Platforme.xlsx` și peste `pricing/tarife.xlsx`.

## Formula

Pașii sunt în foaia „Calcule”, pe aceleași rânduri ca în „Perioade”.

1. **Câștigul real de pe site** la sejurul minim = (preț × (1 − reducerea la sejurul minim) − taxele locale) ÷ (1 + TVA) − costul plății.
2. **Câștigul țintă** = câștigul de pe site ÷ (1 + avantajul site-ului).
3. **Prețul plătit de oaspete** pe platformă = (țintă + taxe ÷ (1 + TVA) − c × taxe [doar unde comisionul se ia fără taxe]) ÷ (1 ÷ (1 + TVA) − c − cost plată). Aici c = (comision + supliment) × (1 + TVA nerecuperabil).
4. **Prețul de setat** = prețul plătit ÷ (1 − reducerea pe durată la sejurul minim) ÷ (1 − reducerea automată × ponderea), rotunjit în sus.
   - La Airbnb se folosește reducerea globală (Trip length, săptămânal sau lunar), chiar și la perioadele cu preț fix.
