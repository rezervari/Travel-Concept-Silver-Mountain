/**
 * A13 Travel Concept — evidența rezervărilor pentru check-in (Google Apps Script), Faza 1.
 *
 * Rulează automat din 10 în 10 minute (declanșatorul îl creează checkinInstall) și ține la zi foaia „Rezervări”:
 *   1. Booking: citește din Gmail e-mailurile „Booking.com - Rezervare nouă! / Rezervare anulată!
 *      (nr. rezervare, ziua, data sosirii)”. E-mailul nu conține data plecării, numele sau contactul oaspetelui,
 *      așa că data plecării se ia din calendarul iCal Booking (evenimentul care începe în ziua sosirii).
 *      Firele citite primesc eticheta „A13-procesat” în Gmail.
 *   2. Site: solicitările din foaia „Solicitări” marcate în coloana Status cu „Confirmată” sau „Anulată”.
 *   3. Rezervările anulate se mută în foaia „Anulate”. Tot ce face scriptul se notează în foaia „Jurnal”.
 *
 * Faza 1 NU trimite mesaje oaspeților și nu atinge yala: coloanele „Fișă…” / „Cod…” rămân goale.
 * Linkul iCal Booking e secret și NU stă în cod: Project Settings → Script Properties → ICS_BOOKING.
 * Rulează în același proiect cu rezervari.gs (același Sheet). Toate numele globale de aici încep cu CI_ / ci,
 * ca să nu se suprapună cu cele din rezervari.gs. Proiectul folosește motorul vechi Apps Script (Rhino):
 * codul rămâne ES5 (var, function; fără =>, let/const sau șabloane de text). Instalare: vezi apps-script/README.md.
 */

var CI_TZ = "Europe/Bucharest";
var CI_SHEET = "Rezervări";
var CI_SHEET_CANCELLED = "Anulate";
var CI_SHEET_LOG = "Jurnal";
var CI_REQUESTS_SHEET = "Solicitări";       // foaia scrisă de rezervari.gs (SHEET_NAME)
var CI_HEADERS = ["Nr. rezervare", "Sursă", "Check-in", "Check-out", "Nopți", "Nume", "Telefon", "E-mail",
                  "Oaspeți", "Stare", "Fișă primită", "Link fișă trimis", "Cod pe yală", "Cod trimis",
                  "Cod șters", "Note", "Link", "Actualizat"];
var CI_CANCELLED_HEADERS = CI_HEADERS.concat(["Anulată la"]);
var CI_LOG_HEADERS = ["Data", "Eveniment", "Nr. rezervare", "Detalii"];
var CI_TEXT_COLS = ["Nr. rezervare", "Check-in", "Check-out", "Telefon"]; // scrise ca text, fără conversii în Sheets
var CI_GMAIL_LABEL = "A13-procesat";
var CI_BOOKING_QUERY = 'from:noreply@booking.com subject:"Booking.com - Rezervare" -label:' + CI_GMAIL_LABEL;
var CI_BOOKING_HOTEL_ID = "4435793";
var CI_ICS_PROPERTY = "ICS_BOOKING";
var CI_PROCESSED_PROPERTY = "CI_PROCESSED_MESSAGES"; // ID-urile e-mailurilor Booking deja citite
var CI_PROCESSED_MAX = 300;
var CI_LOG_MAX_ROWS = 1000;
var CI_REQUEST_STATUSES = ["Nouă", "De verificat", "Fără e-mail (cotă)", "Confirmată", "Anulată"];
var CI_LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august",
               "septembrie", "octombrie", "noiembrie", "decembrie"];

// Valorile coloanei „Stare” (o completează scriptul).
var CI_STATE_OK = "Confirmată";
var CI_STATE_NO_CHECKOUT = "Fără dată de plecare (aștept calendarul Booking)";
var CI_STATE_MISSING_ICAL = "De verificat: nu mai apare în calendarul Booking";
var CI_STATE_CHECK = "De verificat";
var CI_STATE_CANCELLED = "Anulată";

/* ============================== PUNCTE DE INTRARE ============================== */

// Rulată de declanșator din 10 în 10 minute (se poate rula și manual din editor: ▶ Run).
function checkinSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log("O altă rulare e în curs — o sar pe aceasta."); return; }
  try {
    var ctx = ciOpen();
    ciProcessBookingEmails(ctx);
    ciSyncSiteRequests(ctx);
    ciCheckBookingCalendar(ctx);
    ciSave(ctx);
    console.log("Rezervări: " + ctx.active.rows.length + ", anulate: " + ctx.cancelled.rows.length +
                ", evenimente noi: " + ctx.events.length);
  } finally {
    lock.releaseLock();
  }
}

// O singură dată: creează foile, lista din coloana Status a solicitărilor, eticheta Gmail și declanșatorul
// de 10 minute (cel vechi, dacă există, se înlocuiește), apoi face prima sincronizare.
function checkinInstall() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ciEnsureSheet(ss, CI_SHEET, CI_HEADERS);
  ciEnsureSheet(ss, CI_SHEET_CANCELLED, CI_CANCELLED_HEADERS);
  ciEnsureSheet(ss, CI_SHEET_LOG, CI_LOG_HEADERS);
  ciSetStatusDropdown(ss);
  if (!GmailApp.getUserLabelByName(CI_GMAIL_LABEL)) GmailApp.createLabel(CI_GMAIL_LABEL);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "checkinSync") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkinSync").timeBased().everyMinutes(10).create();
  if (!PropertiesService.getScriptProperties().getProperty(CI_ICS_PROPERTY)) {
    console.warn("Lipsește " + CI_ICS_PROPERTY + " în Script Properties: datele de plecare Booking nu se pot completa.");
  }
  checkinSync();
}

// Oprește sincronizarea automată (foile rămân neatinse).
function checkinUninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "checkinSync") ScriptApp.deleteTrigger(t);
  });
}

// Diagnostic, rulat manual din editor: ce vede scriptul în calendarul iCal Booking (doar datele, fără link).
function checkinVerificaCalendar() {
  var url = PropertiesService.getScriptProperties().getProperty(CI_ICS_PROPERTY);
  if (!url) { console.warn("Lipsește " + CI_ICS_PROPERTY + " în Script Properties."); return; }
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var text = res.getContentText();
  var events = ciParseIcs(text);
  console.log("HTTP " + res.getResponseCode() + ", " + text.length + " caractere, " + events.length + " evenimente: " +
              events.map(function (e) { return e.start + " → " + e.end; }).join(", "));
  if (!events.length) console.log("Începutul răspunsului: " + text.slice(0, 300));
}

/* ============================== BOOKING: E-MAILURI ============================== */

function ciProcessBookingEmails(ctx) {
  var threads = GmailApp.search(CI_BOOKING_QUERY, 0, 100);
  var messages = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (ctx.processed.indexOf(m.getId()) < 0) messages.push(m);
    });
  });
  // În ordinea sosirii: o rezervare nouă se citește înaintea anulării ei.
  messages.sort(function (a, b) { return a.getDate() - b.getDate(); });
  messages.forEach(function (m) {
    ciHandleBookingMessage(ctx, m);
    ctx.processedNew.push(m.getId());
  });
  ctx.threadsToLabel = threads;
}

function ciHandleBookingMessage(ctx, m) {
  var subject = String(m.getSubject() || "");
  if (subject.normalize) subject = subject.normalize("NFC"); // lipsește în motorul vechi (Rhino) al proiectului
  var info = ciParseBookingSubject(subject);
  if (!info) {
    // Alt tip de e-mail Booking despre o rezervare (de ex. o modificare): rezervarea e marcată de verificat.
    var nr = (subject.match(/\((\d{6,})\s*,/) || [])[1] || "";
    var row = nr && ciFind(ctx.active, nr);
    if (row) {
      row["Stare"] = CI_STATE_CHECK;
      ciAddNote(row, "E-mail Booking: " + subject);
      ciTouch(row);
    }
    ciLog(ctx, "E-mail Booking necunoscut", nr, subject);
    return;
  }
  var body = String(m.getPlainBody() || "");
  if (info.type === "new") ciBookingNew(ctx, info, body);
  else ciBookingCancelled(ctx, info, body, m.getDate());
}

// „Booking.com - Rezervare nouă! (6131205469, miercuri, 28 octombrie 2026)” → {type, nr, checkin: "2026-10-28"}
function ciParseBookingSubject(subject) {
  var m = subject.match(/Rezervare\s+(nou|anulat)\S*\s*\(\s*(\d+)\s*,\s*[^,()]*,\s*(\d{1,2})\s+(\S+)\s+(\d{4})\s*\)/i);
  if (!m) return null;
  var month = CI_LUNI.indexOf(m[4].toLowerCase());
  if (month < 0) return null;
  return {
    type: m[1].toLowerCase() === "nou" ? "new" : "cancelled",
    nr: m[2],
    checkin: m[5] + "-" + ciPad(month + 1) + "-" + ciPad(m[3])
  };
}

function ciBookingNew(ctx, info, body) {
  if (ciFind(ctx.active, info.nr) || ciFind(ctx.cancelled, info.nr)) return;
  if (info.checkin < ctx.today) {
    ciLog(ctx, "Ignorată (sosire trecută)", info.nr, "Booking, sosire " + info.checkin);
    return;
  }
  var row = ciNewRow();
  row["Nr. rezervare"] = info.nr;
  row["Sursă"] = "Booking";
  row["Check-in"] = info.checkin;
  row["Stare"] = CI_STATE_NO_CHECKOUT;
  row["Link"] = ciExtranetLink(body, info.nr);
  ciTouch(row);
  ctx.active.rows.push(row);
  ciLog(ctx, "Rezervare nouă", info.nr, "Booking, sosire " + info.checkin);
}

function ciBookingCancelled(ctx, info, body, cancelledAt) {
  var name = ((body.match(/pentru\s+(.+?)\s+a fost anulat/) || [])[1] || "").trim();
  var row = ciFind(ctx.active, info.nr);
  if (row) {
    ciRemove(ctx.active, row);
    // Faza 2: aici se va șterge și codul de pe yală, dacă a fost creat.
  } else {
    if (ciFind(ctx.cancelled, info.nr)) return;
    if (info.checkin < ctx.today) {
      ciLog(ctx, "Ignorată (sosire trecută)", info.nr, "anulare Booking, sosire " + info.checkin);
      return;
    }
    row = ciNewRow();
    row["Nr. rezervare"] = info.nr;
    row["Sursă"] = "Booking";
    row["Check-in"] = info.checkin;
    row["Link"] = ciExtranetLink(body, info.nr);
  }
  if (name && !row["Nume"]) row["Nume"] = name;
  row["Stare"] = CI_STATE_CANCELLED;
  row["Anulată la"] = cancelledAt;
  ciTouch(row);
  ctx.cancelled.rows.push(row);
  ciLog(ctx, "Rezervare anulată", info.nr, "Booking, sosire " + info.checkin);
}

function ciExtranetLink(body, nr) {
  var m = body.match(/https:\/\/admin\.booking\.com\/\S*res_id=\d+\S*/);
  if (m) return m[0].replace(/[).,;]+$/, "");
  return "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=" + nr +
         "&hotel_id=" + CI_BOOKING_HOTEL_ID + "&lang=ro";
}

/* ============================== BOOKING: CALENDAR (iCal) ============================== */

// Completează data plecării și verifică rezervările Booking viitoare față de calendarul iCal Booking.
// O rezervare care nu mai apare în calendar NU se anulează automat: e doar marcată „De verificat”.
function ciCheckBookingCalendar(ctx) {
  var rows = ctx.active.rows.filter(function (r) {
    return r["Sursă"] === "Booking" && (!r["Check-out"] || r["Check-out"] >= ctx.today);
  });
  if (!rows.length) return;
  var url = PropertiesService.getScriptProperties().getProperty(CI_ICS_PROPERTY);
  if (!url) return;
  var events;
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) throw new Error("HTTP " + res.getResponseCode());
    events = ciParseIcs(res.getContentText());
  } catch (e) {
    ciLog(ctx, "Eroare calendar Booking", "", String(e && e.message || e).slice(0, 200));
    return;
  }
  rows.forEach(function (r) {
    var nr = r["Nr. rezervare"];
    var ev = events.filter(function (e) { return e.start === r["Check-in"]; })[0];
    if (ev) {
      if (r["Check-out"] !== ev.end) {
        if (r["Check-out"]) ciLog(ctx, "Plecare modificată", nr, r["Check-out"] + " → " + ev.end);
        else ciLog(ctx, "Plecare din calendar", nr, r["Check-in"] + " → " + ev.end);
        r["Check-out"] = ev.end;
        r["Nopți"] = ciNights(r["Check-in"], ev.end);
        ciTouch(r);
      }
      if (r["Stare"] !== CI_STATE_OK && r["Stare"] !== CI_STATE_CHECK) { r["Stare"] = CI_STATE_OK; ciTouch(r); }
    } else {
      var state = r["Check-out"] ? CI_STATE_MISSING_ICAL : CI_STATE_NO_CHECKOUT;
      if (r["Stare"] !== state) {
        if (state === CI_STATE_MISSING_ICAL) ciLog(ctx, "Lipsește din calendarul Booking", nr, r["Check-in"] + " → " + r["Check-out"]);
        r["Stare"] = state;
        ciTouch(r);
      }
    }
  });
}

// Evenimentele din iCal ca {start, end} în format AAAA-LL-ZZ (end = ziua plecării, exclusiv).
function ciParseIcs(text) {
  var lines = String(text).split(/\r\n|\n|\r/), unfolded = [];
  lines.forEach(function (line) {
    if ((line.charAt(0) === " " || line.charAt(0) === "\t") && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  });
  var events = [], cur = null;
  unfolded.forEach(function (line) {
    if (line.indexOf("BEGIN:VEVENT") === 0) { cur = {}; return; }
    if (line.indexOf("END:VEVENT") === 0) {
      if (cur && cur.start && !cur.cancelled) {
        events.push({ start: cur.start, end: cur.end && cur.end > cur.start ? cur.end : ciAddDays(cur.start, 1) });
      }
      cur = null;
      return;
    }
    if (!cur) return;
    if (line.indexOf("DTSTART") === 0) cur.start = ciIcsDate(line);
    else if (line.indexOf("DTEND") === 0) cur.end = ciIcsDate(line);
    else if (line.indexOf("STATUS:CANCELLED") === 0) cur.cancelled = true;
  });
  return events;
}

function ciIcsDate(line) {
  var m = line.split(":").pop().trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : null;
}

/* ============================== SITE: SOLICITĂRI ============================== */

// Foaia „Solicitări” e sursa pentru rezervările de pe site: Status „Confirmată” → rândul e în „Rezervări”
// (datele se actualizează dacă le corectezi în „Solicitări”), Status „Anulată” → rândul trece în „Anulate”.
function ciSyncSiteRequests(ctx) {
  var sh = ctx.ss.getSheetByName(CI_REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = ciHeaderIndex(values[0]);
  if (col["Status"] == null || col["Primită la"] == null) return;
  function get(row, h) { return col[h] == null ? "" : row[col[h]]; }

  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    var status = String(get(v, "Status") || "").trim().toLowerCase();
    var confirmed = /^(confirm|plătit|platit)/.test(status);
    var cancelled = /^anulat/.test(status);
    var received = get(v, "Primită la");
    if ((!confirmed && !cancelled) || !ciIsDate(received)) continue;

    var id = "SITE-" + Utilities.formatDate(received, CI_TZ, "yyyyMMdd-HHmmss");
    var data = {
      name: String(get(v, "Nume") || "").trim(),
      phone: ciPhone(get(v, "Telefon")),
      email: String(get(v, "Email") || "").trim(),
      checkin: ciIso(get(v, "Check-in")),
      checkout: ciIso(get(v, "Check-out")),
      guests: ciGuests(get(v, "Adulți"), get(v, "Copii"))
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(data.checkout)) continue;

    var act = ciFind(ctx.active, id), canc = ciFind(ctx.cancelled, id);
    if (confirmed) {
      if (!act && canc) {
        ciRemove(ctx.cancelled, canc);
        act = canc;
        act["Anulată la"] = "";
        act["Stare"] = CI_STATE_OK;
        ciTouch(act);
        ctx.active.rows.push(act);
        ciLog(ctx, "Rezervare reconfirmată", id, "site, " + data.checkin + " → " + data.checkout);
      }
      if (!act) {
        if (data.checkout < ctx.today) continue;
        act = ciNewRow();
        act["Nr. rezervare"] = id;
        act["Sursă"] = "Site";
        act["Stare"] = CI_STATE_OK;
        ctx.active.rows.push(act);
        ciLog(ctx, "Rezervare confirmată", id, "site, " + data.checkin + " → " + data.checkout);
      }
      ciApplySiteData(ctx, act, data);
    } else if (act) {
      ciRemove(ctx.active, act);
      act["Stare"] = CI_STATE_CANCELLED;
      act["Anulată la"] = new Date();
      ciTouch(act);
      ctx.cancelled.rows.push(act);
      ciLog(ctx, "Rezervare anulată", id, "site, " + act["Check-in"] + " → " + act["Check-out"]);
      // Faza 2: aici se va șterge și codul de pe yală, dacă a fost creat.
    }
    // „Anulată” pentru o solicitare care n-a fost confirmată niciodată = solicitare refuzată: nu se trece nicăieri.
  }
}

function ciApplySiteData(ctx, row, d) {
  var wasDates = row["Check-in"] && (row["Check-in"] + " → " + row["Check-out"]);
  var next = {
    "Nume": d.name, "Telefon": d.phone, "E-mail": d.email, "Check-in": d.checkin, "Check-out": d.checkout,
    "Nopți": ciNights(d.checkin, d.checkout), "Oaspeți": d.guests
  };
  var changed = false;
  Object.keys(next).forEach(function (h) {
    if (row[h] !== next[h]) { row[h] = next[h]; changed = true; }
  });
  if (!changed) return;
  var nowDates = d.checkin + " → " + d.checkout;
  if (wasDates && wasDates !== nowDates) ciLog(ctx, "Date modificate", row["Nr. rezervare"], wasDates + " devine " + nowDates);
  ciTouch(row);
}

// Pune lista Nouă / De verificat / … / Confirmată / Anulată pe coloana Status din „Solicitări”
// (valorile scrise de rezervari.gs rămân valide; se poate scrie și altceva).
function ciSetStatusDropdown(ss) {
  var sh = ss.getSheetByName(CI_REQUESTS_SHEET);
  if (!sh || sh.getLastColumn() < 1) return;
  var col = ciHeaderIndex(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0])["Status"];
  if (col == null || sh.getMaxRows() < 2) return;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(CI_REQUEST_STATUSES, true)
    .setAllowInvalid(true).build();
  sh.getRange(2, col + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

/* ============================== FOI: CITIRE / SCRIERE ============================== */

function ciOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var processed = [];
  try { processed = JSON.parse(PropertiesService.getScriptProperties().getProperty(CI_PROCESSED_PROPERTY) || "[]"); } catch (e) {}
  return {
    ss: ss,
    today: Utilities.formatDate(new Date(), CI_TZ, "yyyy-MM-dd"),
    active: ciLoadTable(ss, CI_SHEET, CI_HEADERS),
    cancelled: ciLoadTable(ss, CI_SHEET_CANCELLED, CI_CANCELLED_HEADERS),
    processed: processed,
    processedNew: [],
    threadsToLabel: [],
    events: []
  };
}

function ciEnsureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
    return sh;
  }
  // Foaie mai veche sau cu coloane adăugate de mână: antetele care lipsesc se adaugă la final.
  var hdr = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  var missing = headers.filter(function (h) { return hdr.indexOf(h) < 0; });
  if (missing.length) sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  return sh;
}

// Citește foaia ca listă de obiecte {antet: valoare}. Coloanele adăugate de mână se păstrează la rescriere.
function ciLoadTable(ss, name, headers) {
  var sh = ciEnsureSheet(ss, name, headers);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var rows = [];
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues().forEach(function (v) {
      if (v.every(function (x) { return x === "" || x == null; })) return;
      var row = {};
      header.forEach(function (h, i) { row[h] = ciNormCell(h, v[i]); });
      rows.push(row);
    });
  }
  return { sheet: sh, header: header, rows: rows, snapshot: JSON.stringify(rows) };
}

function ciNormCell(h, v) {
  if (v === "" || v == null) return "";
  if (h === "Check-in" || h === "Check-out") return ciIso(v);
  if (h === "Nr. rezervare" || h === "Telefon") return String(v).trim();
  if (ciIsDate(v)) return v;
  return typeof v === "string" ? v.trim() : v;
}

function ciSave(ctx) {
  ctx.active.rows.sort(function (a, b) {
    var x = a["Check-in"] || "9999", y = b["Check-in"] || "9999";
    return x < y ? -1 : x > y ? 1 : String(a["Nr. rezervare"]).localeCompare(String(b["Nr. rezervare"]));
  });
  [ctx.active, ctx.cancelled].forEach(function (t) {
    if (JSON.stringify(t.rows) !== t.snapshot) ciWriteTable(t);
  });
  if (ctx.events.length) ciAppendLog(ctx);
  if (ctx.processedNew.length) {
    PropertiesService.getScriptProperties().setProperty(CI_PROCESSED_PROPERTY,
      JSON.stringify(ctx.processed.concat(ctx.processedNew).slice(-CI_PROCESSED_MAX)));
  }
  if (ctx.threadsToLabel.length) {
    var label = GmailApp.getUserLabelByName(CI_GMAIL_LABEL) || GmailApp.createLabel(CI_GMAIL_LABEL);
    ctx.threadsToLabel.forEach(function (t) { t.addLabel(label); });
  }
}

function ciWriteTable(t) {
  var sh = t.sheet, width = t.header.length;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, width).clearContent();
  if (!t.rows.length) return;
  var values = t.rows.map(function (r) {
    return t.header.map(function (h) { return ciCell(h, r[h]); });
  });
  sh.getRange(2, 1, values.length, width).setValues(values);
}

// Datele, telefonul și numărul rezervării se scriu ca text ("'"), altfel Sheets le transformă
// (0726… → 726…, 2026-10-28 → dată în formatul local). Textul care începe cu =, +, -, @ nu devine formulă.
function ciCell(h, v) {
  if (v === "" || v == null) return "";
  if (typeof v === "string" && (CI_TEXT_COLS.indexOf(h) >= 0 || /^[=+\-@]/.test(v))) return "'" + v;
  return v;
}

function ciAppendLog(ctx) {
  var sh = ciEnsureSheet(ctx.ss, CI_SHEET_LOG, CI_LOG_HEADERS);
  var rows = ctx.events.map(function (e) {
    return [e[0], ciCell("", e[1]), ciCell("Nr. rezervare", e[2]), ciCell("", e[3])];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, CI_LOG_HEADERS.length).setValues(rows);
  var extra = sh.getLastRow() - 1 - CI_LOG_MAX_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

function ciLog(ctx, event, nr, details) {
  ctx.events.push([new Date(), event, nr || "", details || ""]);
  console.log(event + (nr ? " " + nr : "") + (details ? ": " + details : ""));
}

/* ============================== MĂRUNȚIȘURI ============================== */

function ciNewRow() {
  var row = {};
  CI_CANCELLED_HEADERS.forEach(function (h) { row[h] = ""; });
  return row;
}

function ciFind(table, nr) {
  return table.rows.filter(function (r) { return String(r["Nr. rezervare"]) === String(nr); })[0] || null;
}

function ciRemove(table, row) {
  var i = table.rows.indexOf(row);
  if (i >= 0) table.rows.splice(i, 1);
}

function ciTouch(row) { row["Actualizat"] = new Date(); }

function ciAddNote(row, note) {
  var cur = String(row["Note"] || "");
  if (cur.indexOf(note) < 0) row["Note"] = cur ? cur + "; " + note : note;
}

function ciHeaderIndex(header) {
  var col = {};
  header.forEach(function (h, i) { col[String(h).trim()] = i; });
  return col;
}

// Dată din Sheet (obiect Date sau text AAAA-LL-ZZ / ZZ.LL.AAAA) → „AAAA-LL-ZZ”. Alt text rămâne neschimbat.
function ciIso(v) {
  if (ciIsDate(v)) return isNaN(v.getTime()) ? "" : Utilities.formatDate(v, CI_TZ, "yyyy-MM-dd");
  var s = String(v == null ? "" : v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1] + "-" + ciPad(m[2]) + "-" + ciPad(m[3]);
  if ((m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/))) return m[3] + "-" + ciPad(m[2]) + "-" + ciPad(m[1]);
  return s;
}

function ciIsDate(v) { return Object.prototype.toString.call(v) === "[object Date]"; }

// Telefon salvat ca număr de o versiune veche a foii (0726… → 726…): se pune la loc 0-ul.
function ciPhone(v) {
  var s = String(v == null ? "" : v).trim();
  return typeof v === "number" && /^7\d{8}$/.test(s) ? "0" + s : s;
}

function ciGuests(adults, children) {
  var a = Number(adults) || 0, c = Number(children) || 0;
  if (!a && !c) return "";
  var s = a + (a === 1 ? " adult" : " adulți");
  if (c) s += " + " + c + (c === 1 ? " copil" : " copii");
  return s;
}

function ciNights(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return "";
  return Math.round((ciUtc(b) - ciUtc(a)) / 86400000);
}

function ciAddDays(iso, n) {
  return new Date(ciUtc(iso) + n * 86400000).toISOString().slice(0, 10);
}

function ciUtc(iso) {
  var p = iso.split("-");
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function ciPad(n) { return ("0" + n).slice(-2); }
