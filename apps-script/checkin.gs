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
                  "Cod șters", "Note", "Link", "Actualizat", "Alerte"];
var CI_CANCELLED_HEADERS = CI_HEADERS.concat(["Anulată la"]);
var CI_LOG_HEADERS = ["Data", "Eveniment", "Nr. rezervare", "Detalii"];
var CI_TEXT_COLS = ["Nr. rezervare", "Check-in", "Check-out", "Telefon", "Cod pe yală"]; // scrise ca text, fără conversii
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

// Faza 2 — sosirea: fișa de cazare, codul de pe yală (prin ttlock.gs), e-mailurile.
var CI_FORM_EMBED = "https://fisacazare.ro/app/embed?id=xnyDvg&sid=0&p=1&t=1&js=1"; // fișa, se poate precompleta
var CI_FORM_PUBLIC = "https://fisacazare.ro/forms/a13-travel-concept-silver-mountain-XM.qQg";
var CI_GUIDE_URL = "https://staybook.ro/ghid/apartament-a13-travel-concept-silver-mountain-poiana-brasov-msnge";
var CI_MAPS_URL = "https://www.google.com/maps/dir/?api=1&destination=45.60318,25.54231&destination_place_id=ChIJF2VRokJFs0ARyQl2NfVA3hw";
var CI_ADDRESS = "Strada Doinașului 9, Bloc A, Ap. A13, Poiana Brașov";
var CI_FORM_QUERY = 'from:no-reply@fisacazare.ro subject:"Fisa Cazare" newer_than:14d';
var CI_FORMS_PROCESSED_PROPERTY = "CI_PROCESSED_FORMS";  // ID-urile e-mailurilor fisacazare deja citite
var CI_TEST_MODE_PROPERTY = "CHECKIN_TEST_MODE";       // "0" = mesajele pleacă la oaspeți; altfel doar la proprietar
var CI_FORM_SEND_HOUR = 10;   // linkul spre fișă: cu o zi înainte de sosire, de la 10:00 (sau imediat, dacă e mai târziu)
var CI_CHECKIN_HOUR = 16;     // codul e valabil din ziua sosirii, de la 16:00 ...
var CI_CHECKOUT_HOUR = 11;    // ... până în ziua plecării, la 11:00
var CI_DELETE_HOUR = 12;      // în ziua plecării, de la 12:00, codul se șterge de pe yală
var CI_REMIND_HOUR = 13;      // în ziua sosirii, de la 13:00: reminder pentru fișă (oaspete sau text de lipit în chat Booking)
                              // dacă fișa tot lipsește, codul de rezervă se pune la CI_CHECKIN_HOUR = 16:00

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
    ciArrivals(ctx);
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

// Test real (cu datele proprietarului): o rezervare de test cu sosirea azi și plecarea mâine, pe e-mailul tău.
// Primești linkul spre fișă; după ce o completezi, scriptul pune codul pe yală (azi 16:00 – mâine 11:00) și ți-l
// trimite. La final: checkinStergeTest (șterge codul de pe yală și rândul de test).
function checkinTestRezervare() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("O altă rulare e în curs; încearcă peste un minut.");
  try {
    var ctx = ciOpen();
    var nr = "TEST-" + ctx.today.replace(/-/g, "");
    if (!ciFind(ctx.active, nr)) {
      var row = ciNewRow();
      row["Nr. rezervare"] = nr;
      row["Sursă"] = "Test";
      row["Check-in"] = ctx.today;
      row["Check-out"] = ciAddDays(ctx.today, 1);
      row["Nopți"] = 1;
      row["E-mail"] = Session.getEffectiveUser().getEmail();
      row["Stare"] = CI_STATE_OK;
      row["Note"] = "Rezervare de test: se șterge cu checkinStergeTest";
      ciTouch(row);
      ctx.active.rows.push(row);
      ciLog(ctx, "Rezervare de test", nr, row["Check-in"] + " → " + row["Check-out"]);
    }
    ciSave(ctx);
  } finally {
    lock.releaseLock();
  }
  checkinSync();
}

// Încheie testul: șterge de pe yală codul rezervărilor de test și scoate rândurile lor din „Rezervări”.
function checkinStergeTest() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("O altă rulare e în curs; încearcă peste un minut.");
  try {
    var ctx = ciOpen();
    ctx.active.rows.filter(function (r) { return r["Sursă"] === "Test"; }).forEach(function (r) {
      ciDeleteCodeNow(ctx, r, "test încheiat");
      if (ciCodeId(r) && !r["Cod șters"]) return;   // codul n-a putut fi șters: rândul rămâne, ca să reîncerc
      ciRemove(ctx.active, r);
      ciLog(ctx, "Rezervare de test ștearsă", r["Nr. rezervare"], "");
    });
    ciSave(ctx);
  } finally {
    lock.releaseLock();
  }
}

// Îți trimite câte un exemplu din e-mailurile pentru oaspeți (fișa + codul), cu un oaspete fictiv, ca să le vezi pe telefon.
function checkinTrimiteExemple() {
  var today = Utilities.formatDate(new Date(), CI_TZ, "yyyy-MM-dd");
  var r = { "Nr. rezervare": "EXEMPLU", "Sursă": "Test", "Nume": "Andrei Popescu",
            "Check-in": ciAddDays(today, 1), "Check-out": ciAddDays(today, 4) };
  var owner = Session.getEffectiveUser().getEmail(), range = rangeShort(r["Check-in"], r["Check-out"]);
  MailApp.sendEmail(owner, "[EXEMPLU] Completează fișa de cazare · sosire " + range, ciFormText(r),
                    { name: BRAND, htmlBody: ciFormHtml(r) });
  MailApp.sendEmail(owner, "[EXEMPLU] Codul de acces · " + BRAND + " · " + range, ciCodeText(r, "123456"),
                    { name: BRAND, htmlBody: ciCodeHtml(r, "123456") });
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
    ciDeleteCodeNow(ctx, row, "anulare Booking");
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
  ciCancelAlert(row, "pe Booking");
}

// La fiecare anulare: te anunț și îți spun ce nopți să deblochezi, dacă le-ai blocat manual pe alte platforme.
function ciCancelAlert(row, where) {
  var ci = row["Check-in"], co = row["Check-out"];
  var nights = /^\d{4}-\d{2}-\d{2}$/.test(co) ? ci + " – " + ciAddDays(co, -1) : "începând cu " + ci;
  ciAlertOwner("Rezervare anulată " + where + ": " + row["Nr. rezervare"] + " (" + ci + (co ? " → " + co : "") + ")",
    "Rezervarea " + row["Nr. rezervare"] + (row["Nume"] ? " (" + row["Nume"] + ")" : "") + " a fost anulată " + where + ".\n" +
    "Am mutat-o în foaia „Anulate”" + (row["Cod șters"] ? " și am șters codul de pe yală" : "") + ".\n\n" +
    "Dacă ai blocat manual nopțile " + nights + " pe Airbnb sau Travelminit, deblochează-le acum; altfel rămân închise peste tot.");
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
      ciDeleteCodeNow(ctx, act, "anulare pe site");
      ciCancelAlert(act, "pe site");
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

/* ============================== SOSIRE: FIȘĂ, COD, MESAJE (Faza 2) ============================== */

// Pașii sosirii. Fiecare e separat: o eroare (ex. gateway offline) nu oprește restul; se reîncearcă la rularea următoare.
function ciArrivals(ctx) {
  [["fișe", ciProcessForms], ["coduri", ciIssuePendingCodes], ["valabilitate", ciSyncCodeWindows],
   ["link fișă", ciSendFormLinks], ["reminder fișă", ciArrivalReminders], ["cod rezervă", ciBackupCodes],
   ["ștergere coduri", ciDeleteExpiredCodes]]
    .forEach(function (s) {
      try { s[1](ctx); }
      catch (e) { ciStepError(ctx, s[0], String(e && e.message || e).slice(0, 300)); }
    });
}

// Aceeași eroare (ex. tokenul TTLock respins) se notează în Jurnal și ți se trimite pe e-mail cel mult o dată la 6 ore.
function ciStepError(ctx, step, msg) {
  var props = PropertiesService.getScriptProperties(), seen = {};
  try { seen = JSON.parse(props.getProperty("CI_LAST_ERRORS") || "{}"); } catch (e) {}
  var key = step + ": " + msg;
  if (seen[key] && ctx.now - seen[key] < 6 * 3600000) return;
  seen[key] = ctx.now;
  Object.keys(seen).forEach(function (k) { if (ctx.now - seen[k] > 86400000) delete seen[k]; });
  props.setProperty("CI_LAST_ERRORS", JSON.stringify(seen));
  ciLog(ctx, "Eroare (" + step + ")", "", msg);
  ciAlertOwner("Eroare la check-in automat (" + step + ")", msg + "\n\nReîncerc la fiecare 10 minute; vezi foaia „Jurnal”.");
}

// Fișele completate (e-mailurile fisacazare.ro): se potrivesc cu rezervarea după data sosirii.
// Prima fișă a unei rezervări pornește codul; fișele celorlalți adulți doar se notează în Jurnal.
function ciProcessForms(ctx) {
  var messages = [];
  GmailApp.search(CI_FORM_QUERY, 0, 50).forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (ctx.formsProcessed.indexOf(m.getId()) < 0) messages.push(m);
    });
  });
  messages.sort(function (a, b) { return a.getDate() - b.getDate(); });
  messages.forEach(function (m) {
    ctx.formsProcessedNew.push(m.getId());
    var f = ciParseForm(m);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.checkin)) { ciLog(ctx, "Fișă necitită", "", "fără dată de sosire"); return; }
    if (f.checkin < ciAddDays(ctx.today, -3)) return;   // fișă veche, dinainte de automatizare
    var row = ciMatchForm(ctx, f);
    if (!row) {
      ciLog(ctx, "Fișă fără rezervare", "", f.name + ", " + f.checkin + " → " + f.checkout);
      ciAlertOwner("Fișă de cazare fără rezervare potrivită (" + f.checkin + ")",
        "A venit o fișă de cazare pe numele " + f.name + ", cu sosirea " + f.checkin + " și plecarea " + f.checkout +
        ", dar în foaia „Rezervări” nu există o rezervare care începe atunci. Codul NU a fost pus pe yală.\n\n" +
        "Verifică data din fișă sau adaugă rezervarea în foaie: " + ctx.ss.getUrl());
      return;
    }
    var nr = row["Nr. rezervare"];
    if (row["Fișă primită"]) { ciLog(ctx, "Încă o fișă", nr, f.name); return; }
    row["Fișă primită"] = m.getDate();
    if (!row["Nume"]) row["Nume"] = f.name;
    if (!row["E-mail"]) row["E-mail"] = f.email;
    if (!row["Telefon"]) row["Telefon"] = f.phone;    // site: rămâne telefonul din rezervare; Booking: cel din fișă
    ciTouch(row);
    ctx.forms[nr] = f;
    ciLog(ctx, "Fișă primită", nr, f.name);
  });
}

function ciMatchForm(ctx, f) {
  var live = ctx.active.rows.filter(function (r) { return r["Stare"] !== CI_STATE_CANCELLED; });
  var exact = live.filter(function (r) { return r["Check-in"] === f.checkin; });
  if (exact.length) return exact[0];
  // Sosire scrisă greșit cu o zi, dar plecarea se potrivește.
  return live.filter(function (r) {
    return f.checkout && r["Check-out"] === f.checkout && /^\d{4}-\d{2}-\d{2}$/.test(r["Check-in"]) &&
           Math.abs(ciUtc(r["Check-in"]) - ciUtc(f.checkin)) <= 86400000;
  })[0] || null;
}

// E-mailul fisacazare are un tabel etichetă → valoare („DATA SOSIRII / DATE OF ARRIVAL” apoi „2026-10-28”).
function ciParseForm(m) {
  var lines = ciHtmlLines(m.getBody());
  if (!lines.some(function (l) { return /^DATA SOSIRII/i.test(l); })) lines = ciHtmlLines(m.getPlainBody());
  var LABEL = /^(NUME SI PRENUME|DATA NASTERII|LOCUL NASTERII|CETATENIA|DOMICILIUL|LOCALITATEA|STRADA|Nr\.|TARA|Judet|Sector|DATA SOSIRII|DATA PLECARII|SCOPUL|ACT DE IDENTITATE|SERIA|NUMAR TELEFON|SEMNATURA|Email|INCARCA)\b/i;
  function val(re) {
    for (var i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      var same = lines[i].split(":").slice(1).join(":").trim();     // „Etichetă: valoare” pe același rând
      if (same) return same;
      var next = lines[i + 1] || "";
      return LABEL.test(next) ? "" : next;
    }
    return "";
  }
  var owner = Session.getEffectiveUser().getEmail().toLowerCase();
  var email = val(/^Email\b/i);
  if (!/@/.test(email)) {
    email = (String(m.getTo() || "").match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || [])
      .filter(function (a) { return a.toLowerCase() !== owner; })[0] || "";
  }
  return {
    name: val(/^NUME SI PRENUME/i),
    checkin: ciIso(val(/^DATA SOSIRII/i)),
    checkout: ciIso(val(/^DATA PLECARII/i)),
    phone: val(/^NUMAR TELEFON/i),
    email: email
  };
}

function ciHtmlLines(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/div|\/tr|\/td|\/th|\/li|\/h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); }).filter(function (l) { return l; });
}

// Fișă primită, cod încă nepus (prima dată sau după o eroare): ultimele 6 cifre ale telefonului, valabil
// din ziua sosirii 16:00 până în ziua plecării 11:00. Oaspetele primește codul doar după ce TTLock confirmă.
function ciIssuePendingCodes(ctx) {
  ctx.active.rows.forEach(function (r) {
    if (!r["Fișă primită"] || r["Cod pe yală"] || r["Stare"] === CI_STATE_CANCELLED) return;
    var nr = r["Nr. rezervare"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r["Check-out"])) {
      ciAlertOnce(r, "fara-plecare", "Cod nepus: rezervarea " + nr + " nu are dată de plecare",
        "Fișa a sosit, dar rezervarea " + nr + " (sosire " + r["Check-in"] + ") nu are încă data plecării în foaie, deci nu știu până când să fie valabil codul.");
      return;
    }
    var end = ciAt(r["Check-out"], CI_CHECKOUT_HOUR);
    if (end <= ctx.now) return;
    var digits = String(r["Telefon"] || "").replace(/\D/g, "");
    if (digits.length < 6) {
      ciAlertOnce(r, "telefon", "Cod nepus: telefon lipsă la " + nr,
        "Fișa pentru rezervarea " + nr + " nu are un număr de telefon valid, deci nu pot face codul (ultimele 6 cifre). " +
        "Scrie telefonul în coloana „Telefon” din foaie; codul se pune la rularea următoare.");
      return;
    }
    var code = digits.slice(-6);
    var id;
    try {
      id = ttlAddCode(ttlLockId(), code, ciCodeName(r), ciAt(r["Check-in"], CI_CHECKIN_HOUR), end);
    } catch (e) {
      ciLog(ctx, "Cod nepus pe yală", nr, String(e.message || e).slice(0, 200));
      ciAlertOnce(r, "ttlock", "Codul pentru " + nr + " NU a putut fi pus pe yală",
        "Eroare TTLock: " + (e.message || e) + "\n\nReîncerc la fiecare 10 minute. Dacă gateway-ul din apartament e oprit, " +
        "pornește-l sau pune codul " + code + "# manual din aplicația TTLock (" + ciWindowLabel(r) + ").");
      return;
    }
    r["Cod pe yală"] = code + "# · id " + id + " · " + ciWindowLabel(r);
    ciTouch(r);
    ciLog(ctx, "Cod pus pe yală", nr, ciWindowLabel(r));
    ciSendCode(ctx, r, code);
  });
}

// Datele rezervării s-au schimbat după ce s-a pus codul: se mută valabilitatea și oaspetele primește codul din nou.
function ciSyncCodeWindows(ctx) {
  ctx.active.rows.forEach(function (r) {
    var id = ciCodeId(r);
    if (!id || r["Cod șters"] || String(r["Cod pe yală"]).indexOf(ciWindowLabel(r)) >= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r["Check-in"]) || !/^\d{4}-\d{2}-\d{2}$/.test(r["Check-out"])) return;
    var code = String(r["Cod pe yală"]).slice(0, 6);
    try {
      ttlChangeCode(ttlLockId(), id, ciAt(r["Check-in"], CI_CHECKIN_HOUR), ciAt(r["Check-out"], CI_CHECKOUT_HOUR));
    } catch (e) {
      ciAlertOnce(r, "schimbare", "Valabilitatea codului pentru " + r["Nr. rezervare"] + " NU s-a putut muta",
        "Eroare TTLock: " + (e.message || e) + ". Modifică manual codul " + code + "# în aplicația TTLock: " + ciWindowLabel(r) + ".");
      return;
    }
    r["Cod pe yală"] = code + "# · id " + id + " · " + ciWindowLabel(r);
    ciTouch(r);
    ciLog(ctx, "Valabilitate cod mutată", r["Nr. rezervare"], ciWindowLabel(r));
    ciSendCode(ctx, r, code);
  });
}

// Cu o zi înainte de sosire, de la 10:00 (sau imediat, la o rezervare de ultim moment): linkul spre fișă.
// Booking nu ne dă e-mailul oaspetelui: acolo pleacă mesajul programat din Extranet (doar se notează).
function ciSendFormLinks(ctx) {
  ctx.active.rows.forEach(function (r) {
    if (r["Link fișă trimis"] || r["Fișă primită"] || r["Stare"] === CI_STATE_CANCELLED) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r["Check-in"])) return;
    if (ctx.now < ciAt(ciAddDays(r["Check-in"], -1), CI_FORM_SEND_HOUR)) return;
    if (ctx.now >= ciAt(r["Check-out"] || r["Check-in"], CI_CHECKOUT_HOUR)) return;
    if (r["Sursă"] === "Booking") {
      r["Link fișă trimis"] = "prin mesajul programat din Booking";
      ciTouch(r);
      return;
    }
    if (!r["E-mail"]) {
      ciAlertOnce(r, "fara-email", "Link fișă netrimis: " + r["Nr. rezervare"] + " nu are e-mail",
        "Trimite-i oaspetelui linkul spre fișa de cazare: " + CI_FORM_PUBLIC);
      return;
    }
    var test = ciMailGuest(r["E-mail"], "Completează fișa de cazare · sosire " + rangeShort(r["Check-in"], r["Check-out"] || r["Check-in"]),
                           ciFormText(r), ciFormHtml(r));
    r["Link fișă trimis"] = new Date();
    ciTouch(r);
    ciLog(ctx, "Link fișă trimis", r["Nr. rezervare"], test ? "MOD TEST: la proprietar" : r["E-mail"]);
  });
}

// În ziua sosirii, de la 13:00: dacă fișa nu e completată, îi amintim oaspetelui s-o completeze.
// Site (avem e-mail): reminder direct oaspetelui. Booking (fără e-mail): text gata de lipit în chat, la proprietar.
// Dacă fișa a venit, dar codul tot nu e pus (eroare TTLock), te anunț o singură dată.
function ciArrivalReminders(ctx) {
  ctx.active.rows.forEach(function (r) {
    if (r["Check-in"] !== ctx.today || r["Cod pe yală"] || r["Stare"] === CI_STATE_CANCELLED) return;
    if (ctx.now < ciAt(ctx.today, CI_REMIND_HOUR)) return;
    // Rezervare de ultim moment: oaspetele are 2 ore să completeze fișa înainte de reminder.
    if (ciIsDate(r["Link fișă trimis"]) && ctx.now < r["Link fișă trimis"].getTime() + 2 * 3600000) return;

    if (r["Fișă primită"]) {   // fișa e completă, dar codul nu s-a pus (eroare TTLock) — detaliile sunt în Jurnal
      ciAlertOnce(r, "sosire-fara-cod", "Sosire azi fără cod: " + (r["Nume"] || r["Nr. rezervare"]),
        "Rezervarea " + r["Nr. rezervare"] + " sosește azi și are fișa completată, dar codul NU e pus pe yală (vezi Jurnalul). " +
        "Reîncerc la fiecare 10 minute; dacă până la ora 16:00 tot nu reușesc, pun automat un cod de rezervă.");
      return;
    }

    if (r["Sursă"] === "Booking") {
      ciAlertOnce(r, "reminder-fisa", "Reminder fișă de trimis în Booking: " + (r["Nume"] || r["Nr. rezervare"]),
        "Rezervarea " + r["Nr. rezervare"] + " sosește azi, dar fișa de cazare nu e completată. Trimite-i oaspetelui, din chatul Booking, mesajul de mai jos. " +
        "Dacă până la ora 16:00 tot nu o completează, pun automat pe yală un cod de rezervă și ți-l trimit (tot de lipit în chat).\n\n" +
        "— RO —\n" + ciReminderChatText("ro") + "\n\n— EN —\n" + ciReminderChatText("en"));
      return;
    }

    if (!r["E-mail"]) {
      ciAlertOnce(r, "reminder-fisa", "Reminder fișă: " + r["Nr. rezervare"] + " nu are e-mail",
        "Rezervarea sosește azi și nu are fișa completată, dar nu am e-mailul oaspetelui. Trimite-i linkul: " + CI_FORM_PUBLIC);
      return;
    }
    if (ciHasFlag(r, "reminder-fisa")) return;
    var test = ciMailGuest(r["E-mail"], "Reminder: completează fișa de cazare · azi sosești la " + BRAND,
                           ciFormText(r), ciFormHtml(r));
    ciMarkOnce(r, "reminder-fisa");
    ciLog(ctx, "Reminder fișă trimis", r["Nr. rezervare"], test ? "MOD TEST: la proprietar" : r["E-mail"]);
  });
}

// În ziua sosirii, de la 16:00: dacă fișa tot nu a venit, pun un cod de rezervă aleator pe yală (nu știm telefonul).
// Oaspetele îl primește ca de obicei (site: e-mail; Booking: text de lipit în chat, la proprietar). Fișa rămâne de completat.
function ciBackupCodes(ctx) {
  ctx.active.rows.forEach(function (r) {
    if (r["Check-in"] !== ctx.today || r["Cod pe yală"] || r["Fișă primită"] || r["Stare"] === CI_STATE_CANCELLED) return;
    if (ctx.now < ciAt(ctx.today, CI_CHECKIN_HOUR)) return;
    // Rezervare de ultim moment (link trimis azi): 2 ore de la trimitere înainte de codul de rezervă.
    if (ciIsDate(r["Link fișă trimis"]) && ctx.now < r["Link fișă trimis"].getTime() + 2 * 3600000) return;
    var nr = r["Nr. rezervare"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r["Check-out"])) {
      ciAlertOnce(r, "rezerva-fara-plecare", "Cod de rezervă nepus: " + nr + " fără dată de plecare",
        "Rezervarea " + nr + " sosește azi fără fișă, dar nu are data plecării în foaie, deci nu știu până când să fie valabil codul de rezervă.");
      return;
    }
    var end = ciAt(r["Check-out"], CI_CHECKOUT_HOUR);
    if (end <= ctx.now) return;
    var lockId, code, id;
    try {
      lockId = ttlLockId();
      var used = (ttlCall("/v3/lock/listKeyboardPwd", { lockId: lockId, pageNo: 1, pageSize: 100 }).list || [])
        .map(function (c) { return String(c.keyboardPwd); });
      do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (used.indexOf(code) >= 0);
      id = ttlAddCode(lockId, code, ciCodeName(r) + " rezervă", ciAt(r["Check-in"], CI_CHECKIN_HOUR), end);
    } catch (e) {
      ciLog(ctx, "Cod de rezervă nepus", nr, String(e.message || e).slice(0, 200));
      ciAlertOnce(r, "rezerva-ttlock", "Codul de rezervă pentru " + nr + " NU a putut fi pus pe yală",
        "Eroare TTLock: " + (e.message || e) + "\n\nReîncerc la fiecare 10 minute. Dacă gateway-ul e oprit, pune manual din aplicația TTLock " +
        "un cod de 6 cifre (" + ciWindowLabel(r) + ") și trimite-l oaspetelui.");
      return;
    }
    r["Cod pe yală"] = code + "# · id " + id + " · " + ciWindowLabel(r) + " · REZERVĂ";
    ciTouch(r);
    ciLog(ctx, "Cod de rezervă pus pe yală", nr, ciWindowLabel(r));
    if (r["Sursă"] === "Booking" || !r["E-mail"]) {
      ciAlertOnce(r, "rezerva-trimite", "Cod de rezervă de trimis oaspetelui: " + (r["Nume"] || nr),
        "Fișa nu a fost completată până la ora 16:00, așa că am pus pe yală un cod de rezervă: " + code + "#  (" + ciWindowLabel(r) + ").\n" +
        (r["Sursă"] === "Booking" ? "Trimite-i din chatul Booking mesajul de mai jos." : "Trimite-i oaspetelui mesajul de mai jos.") + "\n\n" +
        "— RO —\n" + ciBackupChatText("ro", code) + "\n\n— EN —\n" + ciBackupChatText("en", code));
      r["Cod trimis"] = new Date();
      ciTouch(r);
      return;
    }
    ciSendCode(ctx, r, code);
  });
}

// Reminder de lipit în chatul Booking (fișa necompletată).
function ciReminderChatText(lang) {
  if (lang === "en") {
    return "Hello! To receive your door code for apartment A13, please complete the registration form (mandatory): " + CI_FORM_PUBLIC +
      " The code is sent to the e-mail you enter there, a few minutes after you submit the form, and works from 4:00 pm today. Thank you!";
  }
  return "Bună ziua! Pentru a primi codul de acces la ușa apartamentului A13, vă rugăm să completați fișa de cazare (obligatorie): " + CI_FORM_PUBLIC +
    " Codul vă vine pe e-mailul trecut în fișă, la câteva minute după completare, și funcționează de la ora 16:00. Mulțumim!";
}

// Codul de rezervă de lipit în chatul Booking (fișa tot necompletată la ora 16:00).
function ciBackupChatText(lang, code) {
  if (lang === "en") {
    return "Hello! Your door code for apartment A13 is " + code + "#. Enter the 6 digits, then #. It works from 4:00 pm today until 11:00 am on departure day. " +
      "Please still complete the registration form (mandatory): " + CI_FORM_PUBLIC;
  }
  return "Bună ziua! Codul de acces la ușa apartamentului A13 este " + code + "#. Tastați cele 6 cifre, apoi #. Funcționează de la ora 16:00 azi până la ora 11:00 în ziua plecării. " +
    "Vă rugăm totuși să completați fișa de cazare (obligatorie): " + CI_FORM_PUBLIC;
}

// În ziua plecării, de la 12:00: codul se șterge de pe yală (ca după fiecare oaspete, manual, până acum).
function ciDeleteExpiredCodes(ctx) {
  ctx.active.rows.forEach(function (r) {
    if (!ciCodeId(r) || r["Cod șters"] || !/^\d{4}-\d{2}-\d{2}$/.test(r["Check-out"])) return;
    if (ctx.now < ciAt(r["Check-out"], CI_DELETE_HOUR)) return;
    ciDeleteCodeNow(ctx, r, "după plecare");
  });
}

// Șterge codul rezervării de pe yală (plecare sau anulare). O eroare nu oprește restul: te anunț și reîncerc.
function ciDeleteCodeNow(ctx, r, reason) {
  var id = ciCodeId(r);
  if (!id || r["Cod șters"]) return;
  try {
    ttlDeleteCode(ttlLockId(), id);
  } catch (e) {
    ciLog(ctx, "Cod neșters", r["Nr. rezervare"], String(e.message || e).slice(0, 200));
    ciAlertOnce(r, "stergere", "Codul pentru " + r["Nr. rezervare"] + " NU s-a putut șterge de pe yală",
      "Eroare TTLock: " + (e.message || e) + " (" + reason + "). Reîncerc la fiecare 10 minute; îl poți șterge și din aplicația TTLock: " +
      String(r["Cod pe yală"]).slice(0, 7) + ".");
    return;
  }
  r["Cod șters"] = new Date();
  ciTouch(r);
  ciLog(ctx, "Cod șters de pe yală", r["Nr. rezervare"], reason);
}

function ciCodeId(r) { return (String(r["Cod pe yală"] || "").match(/id (\d+)/) || [])[1] || ""; }

function ciCodeName(r) {
  return ("A13 " + (r["Nume"] || r["Nr. rezervare"]) + " " + r["Check-in"].slice(8, 10) + "." + r["Check-in"].slice(5, 7)).slice(0, 40);
}

// „28.10 16:00 – 04.11 11:00”
function ciWindowLabel(r) {
  function d(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7); }
  return d(r["Check-in"]) + " " + ciPad(CI_CHECKIN_HOUR) + ":00 – " + d(r["Check-out"]) + " " + ciPad(CI_CHECKOUT_HOUR) + ":00";
}

// Momentul (ms) pentru ziua iso la ora dată, ora României (vară +3, iarnă +2).
function ciAt(iso, hour) {
  var p = iso.split("-");
  var z = Utilities.formatDate(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)), CI_TZ, "Z");  // „+0300”
  var offMin = (z.charAt(0) === "-" ? -1 : 1) * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
  return Date.UTC(+p[0], +p[1] - 1, +p[2], hour) - offMin * 60000;
}

// Fișa cu datele sejurului deja completate (doar datele: nume/telefon/e-mail nu se pun în link).
function ciFormLink(r) {
  var v = {};
  if (r["Check-in"]) v.date_2 = r["Check-in"];
  if (r["Check-out"]) v.date_3 = r["Check-out"];
  return CI_FORM_EMBED + "&defaultValues=" + encodeURIComponent(JSON.stringify(v));
}

/* ---------- e-mailuri ---------- */

function ciTestMode() { return PropertiesService.getScriptProperties().getProperty(CI_TEST_MODE_PROPERTY) !== "0"; }

// E-mail pentru oaspete. În mod test (implicit) pleacă doar la proprietar, cu destinatarul real în subiect.
function ciMailGuest(to, subject, text, html) {
  var owner = Session.getEffectiveUser().getEmail();
  if (ciTestMode()) {
    MailApp.sendEmail(owner, "[TEST → " + to + "] " + subject,
      "MOD TEST: acest e-mail ar fi plecat la " + to + ".\n\n" + text,
      { name: BRAND + " (test)", htmlBody: html.replace(/(<body[^>]*>)/i, "$1" + ciTestBanner(to)) });
    return true;
  }
  MailApp.sendEmail(to, subject, text, { name: BRAND, replyTo: owner, htmlBody: html });
  return false;
}

function ciAlertOwner(subject, text) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "[Check-in A13] " + subject, text, { name: "Check-in " + BRAND });
}

// Alertă o singură dată pe rezervare și tip (coloana „Alerte”).
function ciAlertOnce(r, key, subject, text) {
  if (ciHasFlag(r, key)) return;
  ciAlertOwner(subject, text + "\n\nRezervarea: " + r["Nr. rezervare"] + " (" + r["Sursă"] + "), " + r["Check-in"] + " → " + r["Check-out"]);
  ciMarkOnce(r, key);
}

// Coloana „Alerte” ține ce s-a trimis deja (alerte și reminder-e), ca să nu se repete la fiecare rulare.
function ciHasFlag(r, key) {
  return (";" + String(r["Alerte"] || "") + ";").indexOf(";" + key + ";") >= 0;
}

// Marchează o acțiune ca făcută o singură dată pe rezervare. Întoarce true la prima dată, false dacă era deja marcată.
function ciMarkOnce(r, key) {
  if (ciHasFlag(r, key)) return false;
  r["Alerte"] = r["Alerte"] ? r["Alerte"] + ";" + key : key;
  ciTouch(r);
  return true;
}

function ciSendCode(ctx, r, code) {
  if (!r["E-mail"]) {
    ciAlertOnce(r, "cod-fara-email", "Cod pus, dar fără e-mail: " + r["Nr. rezervare"],
      "Codul " + code + "# e pe yală (" + ciWindowLabel(r) + "), dar nu am adresa de e-mail a oaspetelui. Trimite-i-l tu.");
    return;
  }
  var subject = "Codul de acces · " + BRAND + " · " + rangeShort(r["Check-in"], r["Check-out"]);
  var test = ciMailGuest(r["E-mail"], subject, ciCodeText(r, code), ciCodeHtml(r, code));
  if (!test) ciAlertOwner("Cod trimis: " + (r["Nume"] || r["Nr. rezervare"]),
    "Codul " + code + "# (" + ciWindowLabel(r) + ") a fost pus pe yală și trimis la " + r["E-mail"] + ".");
  r["Cod trimis"] = new Date();
  ciTouch(r);
  ciLog(ctx, "Cod trimis", r["Nr. rezervare"], test ? "MOD TEST: la proprietar" : r["E-mail"]);
}

function ciTestBanner(to) {
  return '<div style="background:#fff6d9;border-bottom:3px solid #febb02;padding:12px 16px;font-family:Arial,sans-serif;font-size:14px;color:#7a5800;">' +
         '<strong>MOD TEST</strong> — în mod normal, acest e-mail ar fi plecat la <strong>' + esc(to) + '</strong>.</div>';
}

// „vineri, 23 octombrie 2026, ora 16:00, până sâmbătă, 24 octombrie 2026, ora 11:00”
function ciStayLine(r) {
  return weekday(r["Check-in"]) + ", " + longDate(r["Check-in"]) + ", ora " + ciPad(CI_CHECKIN_HOUR) + ":00, până " +
         weekday(r["Check-out"]) + ", " + longDate(r["Check-out"]) + ", ora " + ciPad(CI_CHECKOUT_HOUR) + ":00";
}

// Butonul principal: pe toată lățimea, text centrat.
function ciButtonFull(href, label, bg, color) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 8px;"><tr>' +
      '<td align="center" bgcolor="' + bg + '" style="background:' + bg + ';border-radius:10px;">' +
        '<a href="' + href + '" target="_blank" style="display:block;padding:15px 18px;font-family:' + FONT + ';font-size:16px;line-height:22px;' +
          'font-weight:700;color:' + color + ';text-align:center;text-decoration:none;border-radius:10px;">' + label + '</a>' +
      '</td></tr></table>'
  );
}

// Butoanele de contact: aceeași lățime, centrate, unul sub altul (la fel pe orice telefon), text pe un rând.
function ciContactButtons() {
  function btn(href, label, bg, color, border) {
    return (
      '<tr><td align="center" style="padding:0 0 10px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:320px;"><tr>' +
          '<td align="center" bgcolor="' + bg + '" style="background:' + bg + ';border-radius:8px;' + (border ? 'border:1px solid ' + border + ';' : '') + '">' +
            '<a href="' + href + '" target="_blank" style="display:block;padding:13px 12px;font-family:' + FONT + ';font-size:15px;line-height:20px;' +
              'font-weight:700;color:' + color + ';text-align:center;white-space:nowrap;text-decoration:none;border-radius:8px;">' + label + '</a>' +
          '</td></tr></table>' +
      '</td></tr>'
    );
  }
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      btn(WHATSAPP_URL, "Scrie-ne pe WhatsApp", C.blueMid, C.white) +
      btn("tel:" + PHONE_TEL, "Sună: " + PHONE_DISPLAY, C.white, C.blueDark, C.blueDark) +
    '</table>'
  );
}

// „Apartamentul A13 Travel Concept din complexul Silver Mountain”
var CI_PLACE_HTML = "<strong>Apartamentul A13 Travel Concept</strong> din complexul <strong>Silver Mountain</strong>";
var CI_PLACE_TEXT = "Apartamentul A13 Travel Concept din complexul Silver Mountain";

function ciFormText(r) {
  return "Bună ziua" + (r["Nume"] ? ", " + firstName(r["Nume"]) : "") + "!\n\n" +
    "Sosirea la " + CI_PLACE_TEXT + " (Poiana Brașov) este " + weekday(r["Check-in"]) + ", " + longDate(r["Check-in"]) + ", după ora 16:00.\n\n" +
    "Vă rugăm să completați fișa de anunțare a sosirii (obligatorie, HG 237/2001); datele sejurului sunt deja completate:\n" +
    ciFormLink(r) + "\n\n" +
    "Imediat după completare primiți pe e-mail codul de acces al ușii și ghidul apartamentului.\n" +
    "Fiecare adult completează câte o fișă; pentru ceilalți: " + CI_FORM_PUBLIC + "\n\n" +
    "Întrebări? " + PHONE_DISPLAY + " · WhatsApp: " + WHATSAPP_URL + "\n\nCu drag,\nEchipa " + BRAND + "\n";
}

function ciFormHtml(r) {
  var link = ciFormLink(r);
  var inner =
    headerBar("Fișa de cazare") +
    bodyOpen() +
      eyebrow("Sosirea ta") +
      h1("Te așteptăm" + (r["Nume"] ? ", " + esc(firstName(r["Nume"])) : "") + "!") +
      p("Sosirea la " + CI_PLACE_HTML + " este <strong>" + esc(weekday(r["Check-in"])) + ", " +
        esc(longDate(r["Check-in"])) + "</strong>, după ora 16:00.") +
      p("Te rugăm să completezi <strong>fișa de anunțare a sosirii</strong> (obligatorie prin HG 237/2001). " +
        "Durează două minute, iar datele sejurului sunt deja completate.") +
      ciButtonFull(link, "Completează fișa de cazare", C.blueMid, C.white) +
      spacer(14) +
      noteBox("<strong style=\"color:" + C.blueDark + ";\">Imediat după completare</strong> primești pe e-mail codul de acces al ușii și ghidul apartamentului. " +
              "Fiecare adult completează câte o fișă: pentru ceilalți, folosiți " +
              '<a href="' + CI_FORM_PUBLIC + '" target="_blank" style="color:' + C.blueMid + ';text-decoration:underline;">fișa goală</a>.') +
      divider() +
      p("<strong style=\"color:" + C.blueDark + ";\">Ai întrebări?</strong> Răspunde la acest e-mail sau contactează-ne:", "margin-bottom:16px;text-align:center;") +
      ciContactButtons() +
      spacer(6) +
      p("Cu drag,<br><strong style=\"color:" + C.blueDark + ";\">Echipa " + esc(BRAND) + "</strong>", "margin:14px 0 0;") +
    bodyClose() +
    footer("Complex Silver Mountain · Poiana Brașov<br>Travel Concept International SRL · CUI RO15288158 · " +
           '<a href="mailto:travel@travelconcept.ro" style="color:' + C.headerSub + ';">travel@travelconcept.ro</a>');
  return layout("Completează fișa de cazare; după completare primești codul de acces al ușii.", inner);
}

function ciCodeText(r, code) {
  return "Bine ați venit" + (r["Nume"] ? ", " + firstName(r["Nume"]) : "") + "!\n\n" +
    "Codul de acces pentru ușa de la " + CI_PLACE_TEXT + ": " + code + "#  (tastați cele 6 cifre, apoi #)\n" +
    "Valabil din " + ciStayLine(r) + ". După ora 11:00, în ziua plecării, codul nu mai funcționează.\n\n" +
    "Adresa: " + CI_ADDRESS + ". Intrarea în complex este liberă; ușa apartamentului A13 este pe holul de la etajul 1.\n" +
    "Traseu: " + CI_MAPS_URL + "\n\n" +
    "Ghidul apartamentului (Wi-Fi, parcare, aparate, recomandări în zonă): " + CI_GUIDE_URL + "\n\n" +
    "Întrebări? " + PHONE_DISPLAY + " · WhatsApp: " + WHATSAPP_URL + "\n\nVă dorim un sejur minunat!\nEchipa " + BRAND + "\n";
}

function ciCodeHtml(r, code) {
  var inner =
    headerBar("Check-in") +
    bodyOpen() +
      eyebrow("Codul de acces") +
      h1("Bine ai venit" + (r["Nume"] ? ", " + esc(firstName(r["Nume"])) : "") + "!") +
      p("Mulțumim pentru fișa de cazare. Acesta este codul pentru ușa de la " + CI_PLACE_HTML + ":") +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;"><tr>' +
        '<td align="center" bgcolor="' + C.blueDark + '" style="background:' + C.blueDark + ';border-radius:12px;padding:22px 12px;' +
          'font-family:' + FONT + ';font-size:40px;line-height:46px;font-weight:800;letter-spacing:8px;color:' + C.white + ';">' + esc(code) + '#</td>' +
      '</tr></table>' +
      p("Tastează cele 6 cifre, apoi <strong>#</strong>. Codul funcționează din " + esc(ciStayLine(r)) + ".") +
      warnBox("<strong>La plecare:</strong> check-out până la ora 11:00. După această oră codul nu mai deschide ușa.") +
      sectionTitle("Cum ajungi") +
      p(esc(CI_ADDRESS) + ". Intrarea în complex este liberă; ușa apartamentului A13 este pe holul de la <strong>etajul 1</strong>.") +
      ciButtonFull(CI_MAPS_URL, "Deschide traseul în Google Maps", C.blueMid, C.white) +
      spacer(22) +
      sectionTitle("Ghidul apartamentului") +
      p("Wi-Fi, parcare, cum funcționează aparatele și recomandări în zonă — totul în ghid:") +
      ciButtonFull(CI_GUIDE_URL, "Deschide ghidul apartamentului", C.yellow, C.blueDark) +
      divider() +
      p("<strong style=\"color:" + C.blueDark + ";\">Ai nevoie de ajutor?</strong> Suntem la un mesaj distanță:", "margin-bottom:16px;text-align:center;") +
      ciContactButtons() +
      spacer(6) +
      p("Îți dorim un sejur minunat!<br><strong style=\"color:" + C.blueDark + ";\">Echipa " + esc(BRAND) + "</strong>", "margin:14px 0 0;") +
    bodyClose() +
    footer("Complex Silver Mountain · Poiana Brașov<br>Travel Concept International SRL · CUI RO15288158 · " +
           '<a href="mailto:travel@travelconcept.ro" style="color:' + C.headerSub + ';">travel@travelconcept.ro</a>');
  return layout("Codul de acces al ușii și ghidul apartamentului · valabil " + ciWindowLabel(r) + ".", inner);
}

/* ============================== FOI: CITIRE / SCRIERE ============================== */

function ciOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var processed = [], formsProcessed = [];
  try { processed = JSON.parse(props.getProperty(CI_PROCESSED_PROPERTY) || "[]"); } catch (e) {}
  try { formsProcessed = JSON.parse(props.getProperty(CI_FORMS_PROCESSED_PROPERTY) || "[]"); } catch (e) {}
  return {
    ss: ss,
    now: new Date().getTime(),
    today: Utilities.formatDate(new Date(), CI_TZ, "yyyy-MM-dd"),
    active: ciLoadTable(ss, CI_SHEET, CI_HEADERS),
    cancelled: ciLoadTable(ss, CI_SHEET_CANCELLED, CI_CANCELLED_HEADERS),
    processed: processed,
    processedNew: [],
    threadsToLabel: [],
    formsProcessed: formsProcessed,
    formsProcessedNew: [],
    forms: {},          // nr. rezervare → ultima fișă citită la rularea asta
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
  if (ctx.formsProcessedNew.length) {
    PropertiesService.getScriptProperties().setProperty(CI_FORMS_PROCESSED_PROPERTY,
      JSON.stringify(ctx.formsProcessed.concat(ctx.formsProcessedNew).slice(-CI_PROCESSED_MAX)));
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
