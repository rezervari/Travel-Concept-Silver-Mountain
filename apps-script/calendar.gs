/**
 * Calendarul A13: blocările tale (foaia „Blocări”, din panou) și calendarul iCal „A13 Direct”, pe care îl importă
 * Booking, Airbnb, Travelminit și site-ul (secretul GitHub ICS_DIRECT). În „A13 Direct” intră:
 *   - perioadele închise de tine din panou;
 *   - rezervările de pe site confirmate (Status „Confirmată” după plată → rând „Site” în „Rezervări”);
 *   - solicitările „Așteaptă plata”, ca blocare temporară de cel mult 24 de ore (termenul de plată).
 *
 * REGULA (incidentul din 23.10.2026): în „A13 Direct” NU intră niciodată rezervările sau blocările venite de la Booking,
 * Airbnb sau Travelminit. Booking și-ar importa propriile rezervări și le-ar scoate din toate exporturile (bucla din 23.10).
 *
 * Tot aici: suprapunerile reale dintre rezervări (overbooking) — e-mail o singură dată pe pereche.
 * Același proiect Apps Script (motorul Rhino → doar ES5; nume cu prefix CAL_/cal). Linkul feed-ului:
 * implementarea „Calendar” (Execute as: Me, Who has access: Anyone) + ?cal=<cheie> — vezi apps-script/README.md.
 */

var CAL_SHEET = "Blocări";
var CAL_HEADERS = ["Id", "Prima noapte", "Ultima noapte", "Motiv", "Creată la"];
var CAL_TOKEN_PROPERTY = "CAL_FEED_TOKEN";       // cheia secretă din linkul feed-ului (se creează singură)
var CAL_BASE_PROPERTY = "CAL_FEED_BASE";         // URL-ul …/exec al implementării „Calendar” (acces: Anyone)
var CAL_HOLDS_PROPERTY = "CAL_HOLDS";            // „Așteaptă plata”: id solicitare → { at, expired }
var CAL_ALERTED_PROPERTY = "CAL_OVERLAPS_ALERTED";
var CAL_HOLD_STATUS = "Așteaptă plata";
var CAL_HOLD_HOURS = 24;                         // ca termenul de plată din condițiile de rezervare
var CAL_ICS_CACHE_SEC = 600;
var CAL_MAX_BLOCK_NIGHTS = 400;
var CAL_PLATFORMS = [["Booking", "ICS_BOOKING"], ["Airbnb", "ICS_AIRBNB"], ["Travelminit", "ICS_TRAVELMINIT"]];
var CAL_REQUEST_ACTIONS = ["Așteaptă plata", "Confirmată", "Anulată"];

/* ============================== FEED-UL „A13 DIRECT” ============================== */

// Apelată din doGet (rezervari.gs) pentru ?cal=<cheie>. Fără cheia corectă: „Not found”.
function calServeFeed(token) {
  var expected = PropertiesService.getScriptProperties().getProperty(CAL_TOKEN_PROPERTY);
  if (!expected || String(token) !== expected) return ContentService.createTextOutput("Not found");
  var events = calFeedEvents(SpreadsheetApp.getActiveSpreadsheet(), new Date().getTime());
  return ContentService.createTextOutput(calIcs(events)).setMimeType(ContentService.MimeType.ICAL);
}

// Ce intră în feed. Doar surse proprii — vezi REGULA din antet.
function calFeedEvents(ss, now) {
  var from = ciAddDays(Utilities.formatDate(new Date(now), CI_TZ, "yyyy-MM-dd"), -7);
  var out = [];
  calBlocks(ss).forEach(function (b) {
    if (b.end > from) out.push({ uid: "blocare-" + b.id, start: b.start, end: b.end, origin: "block" });
  });
  ciLoadTable(ss, CI_SHEET, CI_HEADERS).rows.forEach(function (r) {
    if (r["Sursă"] !== "Site" || String(r["Nr. rezervare"]).indexOf("SITE-") !== 0 || r["Stare"] === CI_STATE_CANCELLED) return;
    if (!calIsIso(r["Check-in"]) || !calIsIso(r["Check-out"]) || r["Check-out"] <= from) return;
    out.push({ uid: "site-" + r["Nr. rezervare"], start: r["Check-in"], end: r["Check-out"], origin: "site" });
  });
  calHolds(ss, now).forEach(function (h) {
    if (h.active && h.end > from) out.push({ uid: "plata-" + h.id, start: h.start, end: h.end, origin: "hold" });
  });
  return out;
}

function calIcs(events) {
  var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//A13 Travel Concept//A13 Direct//RO", "CALSCALE:GREGORIAN",
               "METHOD:PUBLISH", "X-WR-CALNAME:A13 Direct"];
  events.forEach(function (e) {
    lines.push("BEGIN:VEVENT", "UID:" + e.uid + "@a13-travel-concept", "DTSTAMP:" + stamp,
               "DTSTART;VALUE=DATE:" + e.start.replace(/-/g, ""), "DTEND;VALUE=DATE:" + e.end.replace(/-/g, ""),
               "SUMMARY:Indisponibil (A13 Direct)", "TRANSP:OPAQUE", "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function calToken() {
  var p = PropertiesService.getScriptProperties();
  var t = p.getProperty(CAL_TOKEN_PROPERTY);
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, "");
    p.setProperty(CAL_TOKEN_PROPERTY, t);
  }
  return t;
}

// Linkul de pus în Booking / Airbnb / Travelminit / GitHub (gol până există implementarea „Calendar”).
function calFeedUrl() {
  var token = calToken();
  var base = String(PropertiesService.getScriptProperties().getProperty(CAL_BASE_PROPERTY) || "").trim();
  return base ? base + "?cal=" + token : "";
}

/* ============================== BLOCĂRI ============================== */

function calBlocks(ss) {
  return ciLoadTable(ss, CAL_SHEET, CAL_HEADERS).rows
    .map(function (r) {
      var first = ciIso(r["Prima noapte"]), last = ciIso(r["Ultima noapte"]);
      return { id: String(r["Id"] || ""), start: first, last: last, end: calIsIso(last) ? ciAddDays(last, 1) : "",
               reason: String(r["Motiv"] || ""), at: ciIsDate(r["Creată la"]) ? r["Creată la"].getTime() : null };
    })
    .filter(function (b) { return b.id && calIsIso(b.start) && calIsIso(b.last) && b.last >= b.start; });
}

// Închide nopțile first … last (inclusiv). Se propagă pe platforme prin „A13 Direct”, la următoarea lor sincronizare.
// O perioadă identică cu una deja închisă nu se mai adaugă (ex. butonul apăsat de două ori).
function calAddBlock(first, last, reason) {
  first = ciIso(first); last = ciIso(last);
  if (!calIsIso(first) || !calIsIso(last)) throw new Error("Datele perioadei nu sunt valide.");
  if (last < first) { var x = first; first = last; last = x; }
  var nights = ciNights(first, ciAddDays(last, 1));
  if (nights > CAL_MAX_BLOCK_NIGHTS) throw new Error("Perioadă prea lungă (cel mult " + CAL_MAX_BLOCK_NIGHTS + " de nopți).");
  if (last < Utilities.formatDate(new Date(), CI_TZ, "yyyy-MM-dd")) throw new Error("Perioada e în trecut.");
  reason = String(reason || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  calWithLock(function (ss) {
    if (calBlocks(ss).some(function (b) { return b.start === first && b.last === last; })) return;
    var sh = ciEnsureSheet(ss, CAL_SHEET, CAL_HEADERS);
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var id = Utilities.formatDate(new Date(), CI_TZ, "yyyyMMdd-HHmmss") + "-" + Math.floor(10 + Math.random() * 90);
    var values = { "Id": "'" + id, "Prima noapte": "'" + first, "Ultima noapte": "'" + last, "Motiv": safeCell(reason), "Creată la": new Date() };
    sh.appendRow(header.map(function (h) { return values[h] === undefined ? "" : values[h]; }));
    calLog(ss, "Perioadă blocată", "", calNightsLabel(first, last) + (reason ? " · " + reason : ""));
  });
}

function calRemoveBlock(id) {
  id = String(id || "");
  calWithLock(function (ss) {
    var sh = ciEnsureSheet(ss, CAL_SHEET, CAL_HEADERS);
    var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var col = ciHeaderIndex(values[0])["Id"];
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][col]).replace(/^'/, "") !== id) continue;
      var c = ciHeaderIndex(values[0]);
      var label = calNightsLabel(ciIso(values[i][c["Prima noapte"]]), ciIso(values[i][c["Ultima noapte"]]));
      sh.deleteRow(i + 1);
      calLog(ss, "Perioadă redeschisă", "", label);
      return;
    }
    throw new Error("Blocarea nu mai există (poate a fost ștearsă din Sheet).");
  });
}

// „10 – 12 dec. 2026 (3 nopți)” — nopțile, nu sosire → plecare.
function calNightsLabel(first, last) {
  if (!calIsIso(first) || !calIsIso(last)) return "";
  var n = ciNights(first, ciAddDays(last, 1));
  return (first === last ? longDate(first) : rangeShort(first, last)) + " (" + n + (n === 1 ? " noapte" : " nopți") + ")";
}

/* ============================== SOLICITĂRI: „AȘTEAPTĂ PLATA” ============================== */

function calRequests(ss) {
  var sh = ss.getSheetByName(CI_REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = ciHeaderIndex(values[0]), out = [];
  function get(v, h) { return col[h] == null ? "" : v[col[h]]; }
  for (var i = 1; i < values.length; i++) {
    var received = get(values[i], "Primită la");
    if (!ciIsDate(received)) continue;
    out.push({
      id: "SITE-" + Utilities.formatDate(received, CI_TZ, "yyyyMMdd-HHmmss"),
      at: received.getTime(), row: i + 1, statusCol: col["Status"] == null ? null : col["Status"] + 1,
      name: String(get(values[i], "Nume") || "").trim(),
      checkin: ciIso(get(values[i], "Check-in")), checkout: ciIso(get(values[i], "Check-out")),
      status: String(get(values[i], "Status") || "").trim()
    });
  }
  return out;
}

function calIsHold(q) { return q.status.toLowerCase() === CAL_HOLD_STATUS.toLowerCase(); }

function calHoldMap() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CAL_HOLDS_PROPERTY) || "{}"); } catch (e) { return {}; }
}

// Solicitările „Așteaptă plata”: active cât n-au trecut 24 de ore de când scriptul a văzut statusul
// (până la prima sincronizare după schimbarea statusului, blocarea e considerată activă).
function calHolds(ss, now) {
  var map = calHoldMap();
  return calRequests(ss)
    .filter(function (q) { return calIsHold(q) && calIsIso(q.checkin) && calIsIso(q.checkout) && q.checkout > q.checkin; })
    .map(function (q) {
      var since = map[q.id] ? map[q.id].at : null;
      var until = since ? since + CAL_HOLD_HOURS * 3600000 : null;
      return { id: q.id, at: q.at, name: q.name, start: q.checkin, end: q.checkout, since: since, until: until,
               active: !until || now < until };
    });
}

// Pas din checkinSync (la 10 minute): ține evidența blocărilor temporare și verifică suprapunerile.
function calSync(ctx) {
  var map = calHoldMap(), seen = {}, changed = false;
  calRequests(ctx.ss).forEach(function (q) {
    if (!calIsHold(q) || !calIsIso(q.checkin) || !calIsIso(q.checkout)) return;
    seen[q.id] = true;
    var what = (q.name || q.id) + ", " + rangeShort(q.checkin, q.checkout);
    if (!map[q.id]) {
      map[q.id] = { at: ctx.now };
      changed = true;
      ciLog(ctx, "Blocare temporară (aștept plata)", q.id, what + ", până la " +
            Utilities.formatDate(new Date(ctx.now + CAL_HOLD_HOURS * 3600000), CI_TZ, "dd.MM HH:mm"));
    } else if (!map[q.id].expired && ctx.now >= map[q.id].at + CAL_HOLD_HOURS * 3600000) {
      map[q.id].expired = true;
      changed = true;
      ciLog(ctx, "Blocare temporară expirată", q.id, what);
      ciAlertOwner("Plata nu a venit în 24 h: " + what,
        "Solicitarea lui " + (q.name || q.id) + " (" + rangeShort(q.checkin, q.checkout) + ") e „" + CAL_HOLD_STATUS + "” de 24 de ore, " +
        "așa că am ridicat blocarea temporară: datele se redeschid pe platforme la următoarea lor sincronizare.\n\n" +
        "Dacă a plătit: pune Status „Confirmată” (din panou sau din foaia „Solicitări”). Dacă nu: „Anulată”.");
    }
  });
  Object.keys(map).forEach(function (id) { if (!seen[id]) { delete map[id]; changed = true; } });
  if (changed) PropertiesService.getScriptProperties().setProperty(CAL_HOLDS_PROPERTY, JSON.stringify(map));
  calCheckOverlaps(ctx);
}

// Schimbă Status-ul unei solicitări (butoanele din panou). Restul (rezervarea, fișa, codul, feed-ul) îl face checkinSync.
function calSetRequestStatus(at, status) {
  if (CAL_REQUEST_ACTIONS.indexOf(status) < 0) throw new Error("Status necunoscut: " + status);
  calWithLock(function (ss) {
    var q = calRequests(ss).filter(function (x) { return x.at === Number(at); })[0];
    if (!q || !q.statusCol) throw new Error("Solicitarea nu mai e în foaia „Solicitări”.");
    ss.getSheetByName(CI_REQUESTS_SHEET).getRange(q.row, q.statusCol).setValue(status);
    calLog(ss, "Status solicitare: " + status, q.id, (q.name || "") + ", " + rangeShort(q.checkin, q.checkout) + " (din panou)");
  });
}

/* ============================== SUPRAPUNERI (OVERBOOKING) ============================== */

// Doar rezervări reale: Booking și site din „Rezervări”, Airbnb „Reserved” din iCal, plus solicitările „Așteaptă plata”
// active. Blocările („Not available”, „CLOSED”) nu contează: sunt de obicei copia altei rezervări.
function calOverlaps(ss, now, platforms) {
  var today = Utilities.formatDate(new Date(now), CI_TZ, "yyyy-MM-dd"), list = [];
  ciLoadTable(ss, CI_SHEET, CI_HEADERS).rows.forEach(function (r) {
    if (r["Stare"] === CI_STATE_CANCELLED || r["Sursă"] === "Test" || !calIsIso(r["Check-in"]) || !calIsIso(r["Check-out"])) return;
    if (r["Check-out"] <= today) return;
    list.push({ key: "rez:" + r["Nr. rezervare"], label: r["Sursă"] + " " + (r["Nume"] || r["Nr. rezervare"]), start: r["Check-in"], end: r["Check-out"] });
  });
  ((platforms.Airbnb && platforms.Airbnb.events) || []).forEach(function (e) {
    if (/reserved/i.test(e.summary) && e.end > today) list.push({ key: "airbnb:" + e.start + ":" + e.end, label: "Airbnb (rezervare)", start: e.start, end: e.end });
  });
  calHolds(ss, now).forEach(function (h) {
    if (h.active && h.end > today) list.push({ key: "plata:" + h.id, label: "Așteaptă plata: " + (h.name || h.id), start: h.start, end: h.end });
  });
  var out = [];
  for (var i = 0; i < list.length; i++) {
    for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (a.start < b.end && b.start < a.end) {
        out.push({ key: [a.key, b.key].sort().join(" + "), a: a.label, b: b.label,
                   start: a.start > b.start ? a.start : b.start, end: a.end < b.end ? a.end : b.end });
      }
    }
  }
  return out;
}

function calCheckOverlaps(ctx) {
  var props = PropertiesService.getScriptProperties(), seen = {};
  try { seen = JSON.parse(props.getProperty(CAL_ALERTED_PROPERTY) || "{}"); } catch (e) {}
  var fresh = calOverlaps(ctx.ss, ctx.now, calPlatformEvents(false)).filter(function (o) { return !seen[o.key]; });
  fresh.forEach(function (o) {
    seen[o.key] = ctx.now;
    ciLog(ctx, "Suprapunere de rezervări", "", o.a + " și " + o.b + ", " + rangeShort(o.start, o.end));
    ciAlertOwner("SUPRAPUNERE: " + o.a + " și " + o.b + " (" + rangeShort(o.start, o.end) + ")",
      "Două rezervări se suprapun în perioada " + rangeShort(o.start, o.end) + ":\n- " + o.a + "\n- " + o.b + "\n\n" +
      "Verifică imediat pe platforme și anulează/mută una dintre ele. Dacă una e o solicitare „Așteaptă plata”, nu încasa plata.");
  });
  Object.keys(seen).forEach(function (k) { if (ctx.now - seen[k] > 60 * 86400000) delete seen[k]; });
  if (fresh.length) props.setProperty(CAL_ALERTED_PROPERTY, JSON.stringify(seen));
}

/* ============================== CALENDARELE PLATFORMELOR ============================== */

// iCal Booking / Airbnb / Travelminit din Script Properties (aceleași linkuri ca secretele GitHub). Doar citire, cache 10 min.
// Linkurile sunt secrete: nu apar niciodată în erori, jurnal sau panou.
function calPlatformEvents(force) {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties(), out = {};
  CAL_PLATFORMS.forEach(function (p) {
    var url = String(props.getProperty(p[1]) || "").trim();
    if (!url) { out[p[0]] = { ok: false, missing: true, events: [] }; return; }
    var key = "cal_ics_" + p[0], hit = force ? null : cache.get(key);
    if (hit) { out[p[0]] = JSON.parse(hit); return; }
    var st;
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) throw new Error("HTTP " + res.getResponseCode());
      var text = res.getContentText();
      if (text.indexOf("BEGIN:VCALENDAR") < 0) throw new Error("răspunsul nu e un calendar iCal");
      st = { ok: true, at: new Date().getTime(), events: calParseIcs(text) };
    } catch (e) {
      st = { ok: false, at: new Date().getTime(), events: [],
             error: String(e && e.message || e).replace(/https?:\/\/\S+/g, "[link]").slice(0, 150) };
    }
    try { cache.put(key, JSON.stringify(st), st.ok ? CAL_ICS_CACHE_SEC : 120); } catch (e) {}
    out[p[0]] = st;
  });
  return out;
}

// Ca ciParseIcs, plus SUMMARY (Airbnb: „Reserved” = rezervare, „Airbnb (Not available)” = blocare).
function calParseIcs(text) {
  var unfolded = [];
  String(text).split(/\r\n|\n|\r/).forEach(function (line) {
    if ((line.charAt(0) === " " || line.charAt(0) === "\t") && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  });
  var events = [], cur = null;
  unfolded.forEach(function (line) {
    if (line.indexOf("BEGIN:VEVENT") === 0) { cur = { summary: "" }; return; }
    if (line.indexOf("END:VEVENT") === 0) {
      if (cur && cur.start && !cur.cancelled) {
        events.push({ start: cur.start, end: cur.end && cur.end > cur.start ? cur.end : ciAddDays(cur.start, 1),
                      summary: cur.summary.replace(/\\,/g, ",").replace(/\\;/g, ";").slice(0, 80) });
      }
      cur = null;
      return;
    }
    if (!cur) return;
    if (line.indexOf("DTSTART") === 0) cur.start = ciIcsDate(line);
    else if (line.indexOf("DTEND") === 0) cur.end = ciIcsDate(line);
    else if (line.indexOf("SUMMARY") === 0) cur.summary = line.slice(line.indexOf(":") + 1).trim();
    else if (line.indexOf("STATUS:CANCELLED") === 0) cur.cancelled = true;
  });
  return events;
}

/* ============================== DATELE PENTRU PANOU ============================== */

function calPanelData(ss, ctx, force, rows) {
  var from = ciAddDays(ctx.today, -40), events = [], bookingRows = {};
  rows.forEach(function (r) {
    if (r["Stare"] === CI_STATE_CANCELLED || !calIsIso(r["Check-in"]) || !calIsIso(r["Check-out"]) || r["Check-out"] <= from) return;
    var src = r["Sursă"] === "Booking" ? "Booking" : r["Sursă"] === "Site" ? "Site" : String(r["Sursă"] || "Altă sursă");
    if (src === "Booking") bookingRows[r["Check-in"] + "|" + r["Check-out"]] = true;
    events.push({ src: src, kind: "res", start: r["Check-in"], end: r["Check-out"], label: String(r["Nume"] || ""), nr: String(r["Nr. rezervare"]) });
  });
  calBlocks(ss).forEach(function (b) {
    if (b.end > from) events.push({ src: "Blocat", kind: "block", start: b.start, end: b.end, label: b.reason, id: b.id, at: b.at });
  });
  calHolds(ss, ctx.now).forEach(function (h) {
    if (h.end > from) events.push({ src: "Plată", kind: "hold", start: h.start, end: h.end, label: h.name, at: h.at, until: h.until, active: h.active });
  });

  var platforms = calPlatformEvents(force), sources = {};
  CAL_PLATFORMS.forEach(function (p) {
    var st = platforms[p[0]];
    sources[p[0]] = { ok: st.ok, missing: !!st.missing, error: st.error || "", count: st.events.length, at: st.at || null };
    st.events.forEach(function (e) {
      if (e.end <= from) return;
      // Rezervările Booking din „Rezervări” apar și în iCal-ul Booking: le arătăm o singură dată (cu nume).
      if (p[0] === "Booking" && bookingRows[e.start + "|" + e.end]) return;
      var reserved = p[0] === "Airbnb" && /reserved/i.test(e.summary);
      events.push({ src: p[0], kind: reserved ? "res" : "closed", start: e.start, end: e.end, label: e.summary });
    });
  });

  var pricing = fetchSiteJson("pricing.json");
  return {
    events: events,
    seasons: ((pricing && pricing.seasons) || []).map(function (s) {
      return { start: s.start, end: s.end, price: s.price, min: s.minNights, label: s.label || s.id };
    }),
    sources: sources,
    feed: { url: calFeedUrl(), count: calFeedEvents(ss, ctx.now).length },
    overlaps: calOverlaps(ss, ctx.now, platforms)
  };
}

/* ============================== MĂRUNȚIȘURI ============================== */

// Scrierile din panou (blocări, status) așteaptă sincronizarea în curs, ca să nu se calce pe „Jurnal”.
function calWithLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("O sincronizare e în curs; încearcă din nou peste un minut.");
  try { fn(SpreadsheetApp.getActiveSpreadsheet()); } finally { lock.releaseLock(); }
}

function calLog(ss, event, nr, details) {
  var sh = ciEnsureSheet(ss, CI_SHEET_LOG, CI_LOG_HEADERS);
  sh.appendRow([new Date(), event, nr ? "'" + nr : "", safeCell(details || "")]);
  if (typeof tgEvents === "function") tgEvents([[new Date(), event, nr || "", details || ""]]);   // telegram.gs
}

// „AAAA-LL-ZZ” și o zi care există (fără 2026-13-01 sau 2026-02-30).
function calIsIso(v) {
  var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
