/**
 * finante.gs — evidența sejururilor și a cheltuielilor A13 (Google Sheet separat:
 * „A13 – Sejururi și cheltuieli”, ID în Script Property FIN_SS_ID).
 *
 * Foi: Rezumat (indicatori, pe categorii, de completat, grafice) · Sejururi · Cheltuieli
 * (grafic lunar + pe categorii) · Lunar (calcule pentru grafice, automat) · Setări (liste).
 * Coloanele calculate sunt formule ARRAYFORMULA în rândul de antet (rândul 3), deci
 * rândurile noi se calculează singure; foile au protecție „doar avertizare”.
 *
 * Funcții:
 *   finBuild(id, force) — construiește structura în fișierul dat (șterge foile existente!).
 *                         Refuză dacă datele au fost deja importate, în afară de force = true.
 *   finImport(data)     — scrie rândurile inițiale ({sejururi: [...], cheltuieli: [...]}).
 *   finRefresh()        — reface graficele și lățimile coloanelor, fără să atingă datele.
 *   finCheck()          — verificare: indicatorii din Rezumat + celulele cu erori (#REF!, #N/A…).
 *
 * Motorul proiectului e Rhino → doar ES5. Prefix FIN_/fin, ca să nu se suprapună cu restul.
 * Formulele se scriu cu fișierul pe en_US (virgulă între argumente); la final se trece pe ro_RO,
 * iar Sheets le convertește singur. Cu ro_RO activ, o formulă cu virgule scrisă din script dă #ERROR!.
 */

var FIN_SS_PROP = "FIN_SS_ID";
var FIN_TZ = "Europe/Bucharest";
var FIN_NAVY = "#003580";
var FIN_BLUE = "#0071c2";
var FIN_CALC = "#4f6f99";
var FIN_SOFT = "#f3f7fc";
var FIN_YELLOW = "#fff4d1";
var FIN_TODO = "#fde293";
var FIN_GRAY = "#5f6368";
var FIN_MONEY = "#,##0.00";
var FIN_MONEY0 = "#,##0;-#,##0;\"–\"";
var FIN_LEI = "#,##0\" lei\"";
var FIN_SETARI = "'Setări'";

// Categoriile de cheltuieli: nume, tip, grup în graficul lunar, culoare grafic, fundal etichetă, text etichetă
var FIN_CATEGORIES = [
  ["Întreținere Silver", "Fixă lunară", "Întreținere", "#2a78d6", "#dbe9fa", "#0c447c"],
  ["Curățenie", "Variabilă", "Curățenie", "#1baf7a", "#d8f3e8", "#085041"],
  ["Spălătorie lenjerii", "Variabilă", "Spălătorie", "#eb6834", "#fbe2d6", "#712b13"],
  ["Internet/TV", "Fixă lunară", "Digi, boxă, parcare", "#6250d6", "#e6e2f8", "#3c3489"],
  ["Parcare", "Fixă lunară", "Digi, boxă, parcare", "#888780", "#ecebe6", "#444441"],
  ["Boxă depozitare", "Fixă lunară", "Digi, boxă, parcare", "#b4b2a9", "#f1efe8", "#5f5e5a"],
  ["Consumabile", "Variabilă", "Cumpărături și altele", "#eda100", "#fcefd0", "#633806"],
  ["Dotări și reparații", "Variabilă", "Cumpărături și altele", "#e87ba4", "#fbe4ee", "#72243e"],
  ["Taxe locale", "Variabilă", "Cumpărături și altele", "#9e9c94", "#f4f3ef", "#5f5e5a"],
  ["Altele", "Variabilă", "Cumpărături și altele", "#c9c7bd", "#f6f5f1", "#5f5e5a"]
];

// Grupurile din graficul lunar (ordinea coloanelor) și culorile lor
var FIN_GROUPS = [
  ["Întreținere", "#2a78d6"],
  ["Curățenie", "#1baf7a"],
  ["Spălătorie", "#eb6834"],
  ["Digi, boxă, parcare", "#b4b2a9"],
  ["Cumpărături și altele", "#d3d1c7"]
];

// Platforme: nume, comision estimat (dacă nu e trecut cel din factură), explicație, fundal, text
var FIN_PLATFORMS = [
  ["Booking", 0.163, "15% din suma fără taxe + 1,3% plata prin Booking", "#dbe9fa", "#0c447c"],
  ["Airbnb", 0.155, "Taxa unică a gazdei", "#fde2e2", "#791f1f"],
  ["Travelminit", 0.1452, "12% + TVA 21%", "#dff3e8", "#085041"],
  ["Site", 0, "Rezervare directă de pe site (transfer bancar)", "#fff1c2", "#633806"],
  ["Direct", 0, "Telefon, WhatsApp, firme", "#ecebe6", "#444441"]
];

function finSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty(FIN_SS_PROP);
  if (!id) throw new Error("Lipsește Script Property " + FIN_SS_PROP + " (rulează întâi finBuild cu ID-ul fișierului).");
  return SpreadsheetApp.openById(id);
}

function finBuild(id, force) {
  var props = PropertiesService.getScriptProperties();
  id = id || props.getProperty(FIN_SS_PROP);
  if (!id) throw new Error("Dă ID-ul fișierului: finBuild(\"<id>\").");
  if (props.getProperty("FIN_IMPORTED") && force !== true) {
    throw new Error("Fișierul are deja date importate. finBuild(id, true) îl reface de la zero (pierzi ce ai scris în el).");
  }
  var ss = SpreadsheetApp.openById(id);
  props.setProperty(FIN_SS_PROP, id);
  props.deleteProperty("FIN_IMPORTED");
  ss.setSpreadsheetLocale("en_US");
  ss.setSpreadsheetTimeZone(FIN_TZ);

  var tmp = ss.insertSheet("tmp-" + new Date().getTime());
  ss.getSheets().forEach(function (sh) { if (sh.getSheetId() !== tmp.getSheetId()) ss.deleteSheet(sh); });
  ss.getNamedRanges().forEach(function (n) { n.remove(); });
  var names = ["Rezumat", "Sejururi", "Cheltuieli", "Lunar", "Setări"];
  var sheets = {};
  names.forEach(function (n, i) { sheets[n] = ss.insertSheet(n, i); });
  ss.deleteSheet(tmp);
  ss.setNamedRange("An", sheets["Rezumat"].getRange("C3"));

  finBuildSetari(sheets["Setări"]);
  finBuildSejururi(sheets["Sejururi"]);
  finBuildCheltuieli(sheets["Cheltuieli"]);
  finBuildLunar(sheets["Lunar"]);
  finBuildRezumat(sheets["Rezumat"]);
  finBuildCharts(ss, sheets);
  SpreadsheetApp.flush();
  ss.setSpreadsheetLocale("ro_RO");
  ss.setActiveSheet(sheets["Rezumat"]);
  SpreadsheetApp.flush();
  return "Structură construită în „" + ss.getName() + "”.";
}

/* ---------- ajutoare de formatare ---------- */

function finHeaderStyle(range, calculated) {
  range.setBackground(calculated ? FIN_CALC : FIN_NAVY).setFontColor("#ffffff").setFontWeight("bold")
    .setWrap(true).setHorizontalAlignment("center").setVerticalAlignment("middle");
}

function finTitle(sh, cell, text, noteCell, note) {
  sh.getRange(cell).setValue(text).setFontSize(18).setFontWeight("bold").setFontColor(FIN_NAVY).setVerticalAlignment("middle");
  if (noteCell && note) {
    sh.getRange(noteCell).setValue(note).setFontColor(FIN_GRAY).setFontSize(9).setWrap(true).setVerticalAlignment("middle");
  }
}

function finWidths(sh, widths) {
  for (var i = 0; i < widths.length; i++) if (widths[i]) sh.setColumnWidth(i + 1, widths[i]);
}

function finWarnProtect(range, description) {
  range.protect().setDescription(description).setWarningOnly(true);
}

function finChipRules(range, items) {
  var rules = [];
  items.forEach(function (it) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(it[0])
      .setBackground(it[1]).setFontColor(it[2]).setRanges([range]).build());
  });
  return rules;
}

function finSejurValidation(ss) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName("Sejururi").getRange("P4:P1000"), true)
    .setAllowInvalid(false).setHelpText("Alege sejurul (oaspete · data sosirii) sau lasă gol.").build();
}

function finFixedCount(sheetPrefix, colB) {
  return "COUNTIFS(" + FIN_SETARI + "!$A$4:$A$30," + colB + "," + FIN_SETARI + "!$B$4:$B$30,\"Fixă lunară\")";
}

/* ---------- Setări ---------- */

function finBuildSetari(sh) {
  sh.setTabColor("#9aa0a6");
  finTitle(sh, "A1", "Setări", "C1", "Listele folosite în celelalte foi. Poți adăuga categorii sau platforme pe rândurile libere; „Grup în grafic” trebuie să fie unul dintre cele 5 grupuri.");
  sh.getRange("C1:G1").merge();
  sh.setRowHeight(1, 44);

  var cat = [["Categorie", "Tip", "Grup în grafic"]];
  FIN_CATEGORIES.forEach(function (c) { cat.push([c[0], c[1], c[2]]); });
  sh.getRange(3, 1, cat.length, 3).setValues(cat);
  finHeaderStyle(sh.getRange(3, 1, 1, 3), false);

  var pl = [["Platformă", "Comision estimat", "Cum se calculează"]];
  FIN_PLATFORMS.forEach(function (p) { pl.push([p[0], p[1], p[2]]); });
  sh.getRange(3, 5, pl.length, 3).setValues(pl);
  finHeaderStyle(sh.getRange(3, 5, 1, 3), false);
  sh.getRange("F4:F30").setNumberFormat("0.00%");

  var groups = FIN_GROUPS.map(function (g) { return g[0]; });
  sh.getRange("B4:B30").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["Fixă lunară", "Variabilă"], true).setAllowInvalid(false).build());
  sh.getRange("C4:C30").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(groups, true).setAllowInvalid(false).build());
  sh.getRange("F4:F30").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, 1).setAllowInvalid(false).setHelpText("Procent între 0% și 100%").build());

  sh.getRange("B3").setNote("Fixă lunară = factură care vine în fiecare lună. Rândurile lor fără sumă apar galben în Cheltuieli și la „De completat” în Rezumat.");
  sh.getRange("F3").setNote("Se folosește doar când în Sejururi nu e trecut comisionul din factură.");
  finWidths(sh, [170, 110, 170, 24, 110, 120, 330]);
  sh.setFrozenRows(3);
}

/* ---------- Sejururi ---------- */

function finBuildSejururi(sh) {
  sh.setTabColor(FIN_BLUE);
  finTitle(sh, "A1", "Sejururi", "C1", "Completezi coloanele cu antet albastru închis; cele cu antet deschis se calculează singure. Sejurul în curs apare galben, cele viitoare cu albastru. Comisionul gri, cursiv = estimat.");
  sh.getRange("C1:O1").merge();
  sh.setRowHeight(1, 40);

  var head = ["Oaspete", "Platformă", "Check-in", "Check-out", "", "Persoane", "Preț sejur\n(fără taxe locale)",
    "Comision\n(din factură)", "", "", "", "", "", "Nr. rezervare", "Observații", ""];
  sh.getRange(3, 1, 1, head.length).setValues([head]);
  var f = {
    5: "={\"Nopți\";ARRAYFORMULA(IF(ISNUMBER(C4:C)*ISNUMBER(D4:D),D4:D-C4:C,))}",
    9: "={\"Comision\";ARRAYFORMULA(IF(G4:G=\"\",,IF(H4:H<>\"\",H4:H,ROUND(G4:G*IFERROR(VLOOKUP(B4:B," + FIN_SETARI + "!$E$4:$F$30,2,FALSE),0),2))))}",
    10: "={\"Rămas după\"&CHAR(10)&\"comision\";ARRAYFORMULA(IF(G4:G=\"\",,G4:G-I4:I))}",
    11: "={\"Rămas /\"&CHAR(10)&\"noapte\";ARRAYFORMULA(IF(G4:G=\"\",,IFERROR(ROUND(J4:J/E4:E,0),)))}",
    12: "={\"Costuri\"&CHAR(10)&\"legate\";ARRAYFORMULA(IF(A4:A=\"\",,SUMIF(Cheltuieli!$E$4:$E,P4:P,Cheltuieli!$D$4:$D)))}",
    13: "={\"Rezultat\"&CHAR(10)&\"sejur\";ARRAYFORMULA(IF(G4:G=\"\",,J4:J-L4:L))}",
    16: "={\"Etichetă\";ARRAYFORMULA(IF((A4:A=\"\")+NOT(ISNUMBER(C4:C)),,A4:A&\" · \"&TEXT(C4:C,\"dd.mm.yyyy\")))}"
  };
  for (var c in f) if (f.hasOwnProperty(c)) sh.getRange(3, Number(c)).setFormula(f[c]);
  finHeaderStyle(sh.getRange(3, 1, 1, 16), false);
  [5, 9, 10, 11, 12, 13, 16].forEach(function (c) { finHeaderStyle(sh.getRange(3, c), true); });
  sh.setRowHeight(3, 44);

  // rândul de totaluri
  sh.getRange("A2").setValue("Total");
  sh.getRange("B2").setFormula("=COUNTA(A4:A)&\" sejururi\"");
  sh.getRange("E2").setFormula("=SUM(E4:E)");
  sh.getRange("F2").setFormula("=SUM(F4:F)");
  sh.getRange("G2").setFormula("=SUM(G4:G)");
  sh.getRange("I2").setFormula("=SUM(I4:I)");
  sh.getRange("J2").setFormula("=SUM(J4:J)");
  sh.getRange("K2").setFormula("=IFERROR(ROUND(J2/E2,0),)");
  sh.getRange("L2").setFormula("=SUM(L4:L)");
  sh.getRange("M2").setFormula("=SUM(M4:M)");
  sh.getRange("A2:O2").setBackground(FIN_YELLOW).setFontWeight("bold").setFontColor(FIN_NAVY);

  var n = sh.getMaxRows() - 3;
  sh.getRange(4, 3, n, 2).setNumberFormat("dd.mm.yyyy");
  sh.getRange(2, 5, n + 2, 2).setNumberFormat("0");
  sh.getRange(2, 7, n + 2, 4).setNumberFormat(FIN_MONEY);
  sh.getRange(2, 11, n + 2, 1).setNumberFormat("#,##0");
  sh.getRange(2, 12, n + 2, 2).setNumberFormat(FIN_MONEY);
  sh.getRange(4, 14, n, 1).setNumberFormat("@");
  sh.getRange(4, 2, n, 5).setHorizontalAlignment("center");
  sh.getRange(4, 1, n, 16).setVerticalAlignment("middle");

  sh.getRange("G3").setNote("Suma pe care se calculează comisionul (la Booking: „Suma pentru comision”). Taxele locale se trec în foaia Cheltuieli.");
  sh.getRange("H3").setNote("Comisionul din factura platformei. Dacă rămâne gol, se estimează cu procentul din Setări.");
  sh.getRange("L3").setNote("Cheltuielile din foaia Cheltuieli legate de acest sejur (coloana „Sejur”): curățenie, taxe etc.");
  sh.getRange("M3").setNote("Rămas după comision minus costurile legate. Facturile lunare (spălătorie, întreținere) nu intră aici.");

  var platforms = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getParent().getSheetByName("Setări").getRange("E4:E30"), true)
    .setAllowInvalid(false).setHelpText("Alege platforma din listă (lista e în Setări).").build();
  sh.getRange(4, 2, n, 1).setDataValidation(platforms);
  var dates = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText("Dată, de exemplu 28.12.2026").build();
  sh.getRange(4, 3, n, 2).setDataValidation(dates);
  var money = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build();
  sh.getRange(4, 6, n, 3).setDataValidation(money);

  var all = sh.getRange(4, 1, n, 15);
  var rules = finChipRules(sh.getRange(4, 2, n, 1), FIN_PLATFORMS.map(function (p) { return [p[0], p[3], p[4]]; }));
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND($G4<>\"\",$H4=\"\")")
    .setFontColor("#80868b").setItalic(true).setRanges([sh.getRange(4, 9, n, 1)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND(ISNUMBER($C4),$C4<=TODAY(),$D4>TODAY())")
    .setBackground(FIN_YELLOW).setBold(true).setRanges([all]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND(ISNUMBER($C4),$C4>TODAY())")
    .setFontColor(FIN_BLUE).setRanges([all]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND($M4<>\"\",$M4<0)")
    .setFontColor("#a32d2d").setRanges([sh.getRange(4, 13, n, 1)]).build());
  sh.setConditionalFormatRules(rules);

  all.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor("#ffffff").setSecondRowColor(FIN_SOFT);

  finWidths(sh, [175, 100, 90, 90, 60, 75, 115, 100, 95, 100, 75, 80, 95, 115, 220, 200]);
  sh.hideColumns(16);
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);
  finWarnProtect(sh.getRange("A3:P3"), "Antetul conține formulele coloanelor calculate");
  [5, 9, 10, 11, 12, 13, 16].forEach(function (c) {
    finWarnProtect(sh.getRange(4, c, n, 1), "Coloană calculată automat");
  });
}

/* ---------- Cheltuieli ---------- */

function finBuildCheltuieli(sh) {
  sh.setTabColor("#eb6834");
  finTitle(sh, "A1", "Cheltuieli", "C1", "Un rând pe cheltuială. La facturile lunare pune data de 1 a lunii. Galben = factură lunară fără sumă (de completat). „Sejur” leagă cheltuiala de un oaspete (curățenie, taxe).");
  sh.getRange("C1:H1").merge();
  sh.setRowHeight(1, 40);

  sh.getRange(3, 1, 1, 7).setValues([["Data", "Categorie", "Furnizor / detaliu", "Sumă", "Sejur (opțional)", "Explicații", "Bon / factură"]]);
  sh.getRange("H3").setFormula("={\"Luna\";ARRAYFORMULA(IF(ISNUMBER(A4:A),TEXT(A4:A,\"mmmm yyyy\"),))}");
  finHeaderStyle(sh.getRange(3, 1, 1, 7), false);
  finHeaderStyle(sh.getRange("H3"), true);
  sh.setRowHeight(3, 34);

  var todo = "SUMPRODUCT(ISNUMBER(A4:A)*(D4:D=\"\")*(" + finFixedCount("", "B4:B") + ">0))";
  sh.getRange("A2").setValue("Total");
  sh.getRange("B2").setFormula("=COUNTA(B4:B)&\" cheltuieli\"");
  sh.getRange("D2").setFormula("=SUM(D4:D)");
  sh.getRange("F2").setFormula("=IF(" + todo + ">0," + todo + "&\" facturi lunare de completat (galben)\",\"Toate facturile lunare sunt trecute\")");
  sh.getRange("A2:H2").setBackground(FIN_YELLOW).setFontWeight("bold").setFontColor(FIN_NAVY);

  var n = sh.getMaxRows() - 3;
  sh.getRange(4, 1, n, 1).setNumberFormat("dd.mm.yyyy");
  sh.getRange(2, 4, n + 2, 1).setNumberFormat(FIN_MONEY);
  sh.getRange(4, 1, n, 8).setVerticalAlignment("middle");

  var ss = sh.getParent();
  sh.getRange(4, 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate()
    .setAllowInvalid(false).setHelpText("Dată, de exemplu 01.11.2026").build());
  sh.getRange(4, 2, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName("Setări").getRange("A4:A30"), true)
    .setAllowInvalid(false).setHelpText("Alege categoria (lista e în Setări).").build());
  sh.getRange(4, 4, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
  sh.getRange(4, 5, n, 1).setDataValidation(finSejurValidation(ss));

  var rules = finChipRules(sh.getRange(4, 2, n, 1), FIN_CATEGORIES.map(function (c) { return [c[0], c[4], c[5]]; }));
  var todoRow = "=AND(ISNUMBER($A4),$D4=\"\",COUNTIFS(INDIRECT(\"'Setări'!A4:A30\"),$B4,INDIRECT(\"'Setări'!B4:B30\"),\"Fixă lunară\")>0)";
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(todoRow)
    .setBackground(FIN_TODO).setBold(true).setRanges([sh.getRange(4, 1, n, 1), sh.getRange(4, 3, n, 6)]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND(ISNUMBER($A4),ISODD(MONTH($A4)))")
    .setBackground(FIN_SOFT).setRanges([sh.getRange(4, 1, n, 1), sh.getRange(4, 3, n, 6)]).build());
  sh.setConditionalFormatRules(rules);

  sh.getRange("D3").setNote("Suma plătită. La o factură lunară care n-a venit încă lasă gol: rândul rămâne galben până o completezi.");
  sh.getRange("G3").setNote("Opțional: link spre poza bonului sau factura din Drive.");
  finLayoutCheltuieli(sh);
  sh.setFrozenRows(3);
  sh.getRange(3, 1, n + 1, 8).createFilter();
  finWarnProtect(sh.getRange(3, 8, n + 1, 1), "Coloană calculată automat");
}

/* ---------- Lunar ---------- */

function finBuildLunar(sh) {
  sh.setTabColor("#9aa0a6");
  finTitle(sh, "A1", "Lunar", "C1", "Calculat automat pentru anul ales în Rezumat — nu se completează. Un sejur intră în luna plecării (atunci plătește platforma).");
  sh.getRange("C1:J1").merge();
  sh.setRowHeight(1, 40);

  sh.getRange("A4:E4").setValues([["Luna", "Încasat după comision", "Nopți", "Cheltuieli", "Rezultat"]]);
  sh.getRange("F4").setFormula("=TRANSPOSE(FILTER(" + FIN_SETARI + "!A4:A30," + FIN_SETARI + "!A4:A30<>\"\"))");
  finHeaderStyle(sh.getRange("A4:Y4"), true);
  sh.setRowHeight(4, 44);

  var rows = [];
  for (var m = 0; m < 12; m++) {
    var r = 5 + m;
    var row = [
      "=DATE(An," + (m + 1) + ",1)",
      "=SUMIFS(Sejururi!$J$4:$J,Sejururi!$D$4:$D,\">=\"&$A" + r + ",Sejururi!$D$4:$D,\"<\"&EDATE($A" + r + ",1))",
      "=SUMIFS(Sejururi!$E$4:$E,Sejururi!$D$4:$D,\">=\"&$A" + r + ",Sejururi!$D$4:$D,\"<\"&EDATE($A" + r + ",1))",
      "=SUM(F" + r + ":Y" + r + ")",
      "=B" + r + "-D" + r
    ];
    for (var c = 0; c < 20; c++) {
      var col = String.fromCharCode(70 + c); // F..Y
      row.push("=IF(" + col + "$4=\"\",0,SUMIFS(Cheltuieli!$D$4:$D,Cheltuieli!$B$4:$B," + col + "$4,Cheltuieli!$A$4:$A,\">=\"&$A" + r +
        ",Cheltuieli!$A$4:$A,\"<\"&EDATE($A" + r + ",1)))");
    }
    rows.push(row);
  }
  sh.getRange(5, 1, 12, 25).setFormulas(rows);
  var tot = ["Total"];
  for (var t = 1; t < 25; t++) {
    var cl = String.fromCharCode(65 + t);
    tot.push("=SUM(" + cl + "5:" + cl + "16)");
  }
  sh.getRange(17, 1, 1, 25).setValues([tot]);
  sh.getRange("A5:A16").setNumberFormat("mmmm");
  sh.getRange("B5:Y17").setNumberFormat(FIN_MONEY0);
  sh.getRange("C5:C17").setNumberFormat("0;-0;\"–\"");
  sh.getRange("A17:Y17").setBackground(FIN_YELLOW).setFontWeight("bold").setFontColor(FIN_NAVY);
  sh.getRange("A5:A17").setFontWeight("bold");
  sh.getRange("B5:Y17").setHorizontalAlignment("right");

  // bloc pentru graficul de cheltuieli pe grupuri
  sh.getRange("A19").setValue("Pentru graficul „Cheltuieli pe luni” (grupuri din Setări)").setFontColor(FIN_GRAY).setFontSize(9);
  var gh = ["Luna"];
  FIN_GROUPS.forEach(function (g) { gh.push(g[0]); });
  sh.getRange(20, 1, 1, gh.length).setValues([gh]);
  finHeaderStyle(sh.getRange(20, 1, 1, gh.length), true);
  var gr = [];
  for (var i = 0; i < 12; i++) {
    var src = 5 + i;
    var line = ["=TEXT(A" + src + ",\"mmm\")"];
    for (var k = 0; k < FIN_GROUPS.length; k++) {
      var gc = String.fromCharCode(66 + k);
      line.push("=SUMPRODUCT((IFERROR(VLOOKUP($F$4:$Y$4," + FIN_SETARI + "!$A$4:$C$30,3,FALSE),\"\")=" + gc + "$20)*$F" + src + ":$Y" + src + ")");
    }
    gr.push(line);
  }
  sh.getRange(21, 1, 12, gh.length).setFormulas(gr);
  sh.getRange(21, 2, 12, gh.length - 1).setNumberFormat(FIN_MONEY0);

  // bloc pentru graficul încasat / cheltuieli
  sh.getRange("A34").setValue("Pentru graficul „Încasat și cheltuieli pe luni”").setFontColor(FIN_GRAY).setFontSize(9);
  sh.getRange("A35:C35").setValues([["Luna", "Încasat", "Cheltuieli"]]);
  finHeaderStyle(sh.getRange("A35:C35"), true);
  var ic = [];
  for (var j = 0; j < 12; j++) ic.push(["=A" + (21 + j), "=B" + (5 + j), "=D" + (5 + j)]);
  sh.getRange(36, 1, 12, 3).setFormulas(ic);
  sh.getRange(36, 2, 12, 2).setNumberFormat(FIN_MONEY0);

  sh.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
    .setFontColor("#a32d2d").setRanges([sh.getRange("E5:E17")]).build()]);
  finWidths(sh, [120, 120, 70, 110, 110]);
  for (var w = 6; w <= 25; w++) sh.setColumnWidth(w, 115);
  sh.setFrozenRows(4);
  sh.setFrozenColumns(1);
  sh.protect().setDescription("Foaie calculată automat").setWarningOnly(true);
}

/* ---------- Rezumat ---------- */

function finBuildRezumat(sh) {
  sh.setTabColor(FIN_NAVY);
  sh.getRange("B1").setValue("A13 Travel Concept · Sejururi și cheltuieli").setFontSize(18).setFontWeight("bold").setFontColor(FIN_NAVY);
  sh.getRange("B2").setValue("Totaluri pentru anul ales. Datele se scriu în foile Sejururi și Cheltuieli; restul se calculează singur.")
    .setFontColor(FIN_GRAY).setFontSize(9);
  sh.setRowHeight(1, 36);

  sh.getRange("B3").setValue("Anul").setFontWeight("bold").setHorizontalAlignment("right").setVerticalAlignment("middle");
  var year = Number(Utilities.formatDate(new Date(), FIN_TZ, "yyyy"));
  var years = [];
  for (var y = 2025; y <= year + 3; y++) years.push(String(y));
  sh.getRange("C3").setValue(year).setNumberFormat("0").setFontWeight("bold").setFontSize(12).setBackground(FIN_YELLOW)
    .setHorizontalAlignment("center").setFontColor(FIN_NAVY)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(years, true).setAllowInvalid(false).build());
  sh.setRowHeight(3, 28);

  var todo = "SUMPRODUCT(ISNUMBER(Cheltuieli!A4:A)*(YEAR(Cheltuieli!A4:A)=An)*(Cheltuieli!D4:D=\"\")*(" +
    finFixedCount("", "Cheltuieli!B4:B") + ">0))";
  sh.getRange("B5:G5").setValues([["Încasat după comision", "Cheltuieli", "Rezultat", "Nopți ocupate", "Rămas mediu / noapte", "Costuri fixe / lună"]]);
  sh.getRange("B6:G6").setFormulas([["=Lunar!B17", "=Lunar!D17", "=B6-C6", "=Lunar!C17", "=IFERROR(ROUND(B6/E6,0),0)",
    "=SUMIF(C11:C30,\"Fixă lunară\",G11:G30)"]]);
  sh.getRange("B7:G7").setFormulas([[
    "=COUNTIFS(Sejururi!D4:D,\">=\"&DATE(An,1,1),Sejururi!D4:D,\"<\"&DATE(An+1,1,1))&\" sejururi\"",
    "=IF(" + todo + ">0," + todo + "&\" facturi de completat\",\"toate facturile lunare trecute\")",
    "=\"înainte de TVA și impozit\"",
    "=IF(DATE(An,1,1)>TODAY(),\"\",IFERROR(TEXT(E6/(MIN(TODAY(),DATE(An,12,31))-DATE(An,1,1)+1),\"0%\")&\" grad de ocupare\",\"\"))",
    "=\"după comision\"",
    "=IFERROR(\"≈ \"&ROUNDUP(G6/F6,0)&\" nopți / lună le acoperă\",\"\")"
  ]]);
  sh.getRange("B5:G7").setBackground(FIN_SOFT).setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBorder(null, null, null, null, true, null, "#ffffff", SpreadsheetApp.BorderStyle.SOLID_THICK);
  sh.getRange("B5:G5").setFontColor(FIN_GRAY).setFontSize(9);
  sh.getRange("B6:G6").setFontSize(18).setFontWeight("bold").setFontColor(FIN_NAVY).setNumberFormat(FIN_LEI);
  sh.getRange("E6").setNumberFormat("0");
  sh.getRange("B7:G7").setFontColor(FIN_GRAY).setFontSize(9);
  sh.setRowHeight(5, 24);
  sh.setRowHeight(6, 40);
  sh.setRowHeight(7, 24);

  sh.getRange("B9").setValue("Cheltuieli pe categorii").setFontSize(12).setFontWeight("bold").setFontColor(FIN_NAVY);
  sh.getRange("B10:G10").setValues([["Categorie", "Tip", "Total an", "Pondere", "% din total", "Medie / lună"]]);
  finHeaderStyle(sh.getRange("B10:G10"), false);
  sh.getRange("B11").setFormula("=FILTER(" + FIN_SETARI + "!A4:A30," + FIN_SETARI + "!A4:A30<>\"\")");
  var t = [];
  for (var r = 11; r <= 30; r++) {
    t.push([
      "=IF($B" + r + "=\"\",\"\",IFERROR(VLOOKUP($B" + r + "," + FIN_SETARI + "!$A$4:$B$30,2,FALSE),\"\"))",
      "=IF($B" + r + "=\"\",\"\",SUMIFS(Cheltuieli!$D$4:$D,Cheltuieli!$B$4:$B,$B" + r + ",Cheltuieli!$A$4:$A,\">=\"&DATE(An,1,1),Cheltuieli!$A$4:$A,\"<\"&DATE(An+1,1,1)))",
      "=IF($B" + r + "=\"\",\"\",IFERROR(SPARKLINE(D" + r + ",{\"charttype\",\"bar\";\"max\",MAX($D$11:$D$30);\"color1\",\"#2a78d6\"}),\"\"))",
      "=IF($B" + r + "=\"\",\"\",IFERROR(D" + r + "/$C$6,0))",
      "=IF($B" + r + "=\"\",\"\",IFERROR(D" + r + "/COUNTIF(INDEX(Lunar!$F$5:$Y$16,0,MATCH($B" + r + ",Lunar!$F$4:$Y$4,0)),\">0\"),0))"
    ]);
  }
  sh.getRange(11, 3, 20, 5).setFormulas(t);
  sh.getRange("D11:D30").setNumberFormat(FIN_MONEY);
  sh.getRange("F11:F30").setNumberFormat("0%");
  sh.getRange("G11:G30").setNumberFormat(FIN_MONEY);
  sh.getRange("C11:C30").setFontColor(FIN_GRAY);
  sh.getRange("B11:G30").setVerticalAlignment("middle");
  sh.getRange("G10").setNote("Media pe lunile în care categoria are cheltuieli.");

  sh.getRange("B32").setValue("De completat").setFontSize(12).setFontWeight("bold").setFontColor(FIN_NAVY);
  sh.getRange("B33").setFormula("=IFERROR(FILTER(Cheltuieli!B4:B&\" · \"&Cheltuieli!H4:H,ISNUMBER(Cheltuieli!A4:A),Cheltuieli!D4:D=\"\"," +
    finFixedCount("", "Cheltuieli!B4:B") + ">0),\"Nimic de completat\")");
  var rules = [];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND($B33<>\"\",$B33<>\"Nimic de completat\")")
    .setBackground(FIN_TODO).setRanges([sh.getRange("B33:C60")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0)
    .setFontColor("#a32d2d").setRanges([sh.getRange("D6")]).build());
  var emph = FIN_CATEGORIES.slice(0, 3).map(function (c) { return "$B11=\"" + c[0] + "\""; }).join(",");
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=OR(" + emph + ")")
    .setBold(true).setRanges([sh.getRange("B11:B30"), sh.getRange("D11:D30")]).build());
  sh.setConditionalFormatRules(rules);

  finLayoutRezumat(sh);
  sh.setHiddenGridlines(true);
  var p = sh.protect().setDescription("Rezumat calculat automat").setWarningOnly(true);
  p.setUnprotectedRanges([sh.getRange("C3")]);
}

// Lățimile sunt alese ca graficele din Rezumat să încapă pe un ecran de laptop (~1366 px).
function finLayoutRezumat(sh) {
  finWidths(sh, [20, 160, 110, 110, 115, 95, 110, 16]);
  sh.getRange("B6:G6").setFontSize(16);
  sh.getRange("B7:G7").setWrap(true);
  sh.setRowHeight(7, 30);
}

function finLayoutCheltuieli(sh) {
  finWidths(sh, [85, 140, 125, 85, 170, 190, 75, 105, 16]);
}

/* ---------- Grafice ---------- */

// Reface graficele și lățimile coloanelor, fără să atingă datele.
function finRefresh() {
  var ss = finSpreadsheet();
  var sheets = {};
  ["Rezumat", "Sejururi", "Cheltuieli", "Lunar", "Setări"].forEach(function (n) { sheets[n] = ss.getSheetByName(n); });
  finLayoutRezumat(sheets["Rezumat"]);
  finLayoutCheltuieli(sheets["Cheltuieli"]);
  [sheets["Rezumat"], sheets["Cheltuieli"]].forEach(function (sh) {
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  });
  finBuildCharts(ss, sheets);
  SpreadsheetApp.flush();
  return "Grafice și coloane refăcute.";
}

function finBuildCharts(ss, sheets) {
  var lunar = sheets["Lunar"], rez = sheets["Rezumat"], ch = sheets["Cheltuieli"];
  var groupColors = FIN_GROUPS.map(function (g) { return g[1]; });
  var catColors = FIN_CATEGORIES.map(function (c) { return c[3]; });

  function monthly(sheet, row, col, width) {
    return sheet.newChart().setChartType(Charts.ChartType.COLUMN)
      .addRange(lunar.getRange("A20:F32")).setNumHeaders(1)
      .setOption("isStacked", true)
      .setOption("title", "Cheltuieli pe luni")
      .setOption("legend", { position: "top", maxLines: 2 })
      .setOption("colors", groupColors)
      .setOption("vAxis", { format: "#,##0", gridlines: { color: "#e8eaed" }, viewWindow: { min: 0 } })
      .setOption("bar", { groupWidth: "62%" })
      .setOption("width", width).setOption("height", 340)
      .setPosition(row, col, 0, 0).build();
  }
  function donut(sheet, row, col, width) {
    return sheet.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(rez.getRange("B10:B30")).addRange(rez.getRange("D10:D30")).setNumHeaders(1)
      .setOption("title", "Unde se duc banii (anul ales)")
      .setOption("pieHole", 0.45)
      .setOption("colors", catColors)
      .setOption("legend", { position: "right" })
      .setOption("pieSliceText", "percentage")
      .setOption("width", width).setOption("height", 320)
      .setPosition(row, col, 0, 0).build();
  }

  rez.insertChart(monthly(rez, 3, 9, 540));
  rez.insertChart(rez.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(lunar.getRange("A35:C47")).setNumHeaders(1)
    .setOption("title", "Încasat și cheltuieli pe luni")
    .setOption("legend", { position: "top" })
    .setOption("colors", ["#1baf7a", "#eb6834"])
    .setOption("vAxis", { format: "#,##0", gridlines: { color: "#e8eaed" }, viewWindow: { min: 0 } })
    .setOption("bar", { groupWidth: "70%" })
    .setOption("width", 540).setOption("height", 320)
    .setPosition(21, 9, 0, 0).build());
  rez.insertChart(donut(rez, 38, 9, 540));

  ch.insertChart(monthly(ch, 3, 10, 540));
  ch.insertChart(donut(ch, 21, 10, 540));
}

/* ---------- Import inițial și verificare ---------- */

function finImport(data) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("FIN_IMPORTED")) throw new Error("Datele au fost deja importate.");
  var ss = finSpreadsheet();
  var sej = ss.getSheetByName("Sejururi"), ch = ss.getSheetByName("Cheltuieli");
  if (sej.getRange("A4").getValue() !== "" || ch.getRange("A4").getValue() !== "") throw new Error("Foile au deja rânduri.");
  function d(iso) { return iso ? Utilities.parseDate(iso, FIN_TZ, "yyyy-MM-dd") : ""; }
  function v(x) { return x === null || x === undefined ? "" : x; }

  var s = data.sejururi || [];
  if (s.length) {
    sej.getRange(4, 1, s.length, 4).setValues(s.map(function (r) { return [r[0], r[1], d(r[2]), d(r[3])]; }));
    sej.getRange(4, 6, s.length, 3).setValues(s.map(function (r) { return [v(r[4]), v(r[5]), v(r[6])]; }));
    sej.getRange(4, 14, s.length, 2).setValues(s.map(function (r) { return [String(v(r[7])), v(r[8])]; }));
    SpreadsheetApp.flush();
  }
  var c = data.cheltuieli || [];
  if (c.length) {
    // validarea coloanei „Sejur” se pune la loc după scriere (etichetele se calculează în Sejururi)
    var sejCol = ch.getRange(4, 5, ch.getMaxRows() - 3, 1);
    sejCol.clearDataValidations();
    ch.getRange(4, 1, c.length, 6).setValues(c.map(function (r) { return [d(r[0]), r[1], v(r[2]), v(r[3]), v(r[4]), v(r[5])]; }));
    sejCol.setDataValidation(finSejurValidation(ss));
  }
  props.setProperty("FIN_IMPORTED", new Date().toISOString());
  SpreadsheetApp.flush();
  return s.length + " sejururi, " + c.length + " cheltuieli";
}

function finCheck() {
  var ss = finSpreadsheet();
  SpreadsheetApp.flush();
  var rez = ss.getSheetByName("Rezumat");
  var out = [];
  var labels = rez.getRange("B5:G5").getDisplayValues()[0];
  var vals = rez.getRange("B6:G6").getDisplayValues()[0];
  var subs = rez.getRange("B7:G7").getDisplayValues()[0];
  for (var i = 0; i < labels.length; i++) out.push(labels[i] + ": " + vals[i] + " (" + subs[i] + ")");
  var errors = [];
  ss.getSheets().forEach(function (sh) {
    var range = sh.getDataRange();
    var values = range.getDisplayValues();
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (/^#(REF|NAME|VALUE|N\/A|ERROR|DIV\/0|NUM)/.test(values[r][c])) {
          errors.push(sh.getName() + "!" + range.getCell(r + 1, c + 1).getA1Notation() + " " + values[r][c]);
        }
      }
    }
  });
  out.push("Erori: " + (errors.length ? errors.slice(0, 20).join("; ") : "niciuna"));
  var labels2 = ss.getSheetByName("Sejururi").getRange("P4:P1000").getDisplayValues().map(function (r) { return r[0]; });
  var missing = ss.getSheetByName("Cheltuieli").getRange("E4:E1000").getDisplayValues().map(function (r) { return r[0]; })
    .filter(function (x) { return x && labels2.indexOf(x) < 0; });
  out.push("Sejururi negăsite în Cheltuieli: " + (missing.length ? missing.join(" | ") : "niciunul"));
  var todo = rez.getRange("B33:B45").getDisplayValues().map(function (r) { return r[0]; }).filter(function (x) { return x; });
  out.push("De completat: " + todo.join(" | "));
  Logger.log(out.join("\n"));
  return out;
}
