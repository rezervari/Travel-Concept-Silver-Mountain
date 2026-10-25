/**
 * Panoul de control A13 — doar pentru proprietar. O singură pagină, gândită pentru laptop și telefon:
 * ce ai de făcut (cu textele gata de copiat pentru chatul Booking), sejururile cu pașii check-in-ului
 * (link fișă → fișă → cod pe yală → cod trimis → cod șters), solicitările de pe site, jurnalul tuturor
 * evenimentelor și starea sistemului (sincronizare, yală, calendar, cota de e-mail).
 *
 * Rulează în ACELAȘI proiect Apps Script cu rezervari.gs, checkin.gs și ttlock.gs (motorul vechi Rhino → doar ES5;
 * numele globale încep cu PN_/pn). Pagina e fișierul HTML „Panou” (apps-script/Panou.html). O servește doGet din
 * rezervari.gs NUMAI când cel care o deschide e autentificat cu contul proprietarului; pentru oricine altcineva
 * web app-ul public răspunde ca înainte. Se deschide printr-o implementare separată (Execute as: Me,
 * Who has access: Only myself) — vezi apps-script/README.md.
 *
 * Panoul citește foile. Scrie doar: „Gata” (Script Property PN_DISMISSED), perioadele închise / redeschise din calendar
 * (foaia „Blocări”, calendar.gs), Status-ul solicitărilor de pe site (butoanele Aștept plata / Plătit · confirmă /
 * Anulează) și pornește, la cerere, aceeași sincronizare ca declanșatorul de 10 minute (checkinSync).
 *
 * Aceeași pagină rulează și pe Cloudflare (panou-cloudflare/, aplicație instalabilă, în spatele Cloudflare Access).
 * Worker-ul cheamă funcțiile de mai jos prin doPost → pnApi, cu cheia secretă PN_API_TOKEN (Script Properties și
 * secretul Worker-ului) în locul contului Google.
 */

var PN_TITLE = "Panou A13";
var PN_LOCK_CACHE_SEC = 900;    // starea yalei (baterie, gateway, coduri) se cere la TTLock cel mult o dată la 15 minute
var PN_SITE_CACHE_SEC = 300;    // booked-dates.json de pe site
var PN_LOG_ROWS = 200;          // ultimele rânduri din „Jurnal”
var PN_REQUEST_DAYS = 60;       // solicitările de pe site din ultimele 60 de zile …
var PN_REQUEST_MAX = 40;        // … cel mult 40
var PN_CANCELLED_MAX = 10;
var PN_PAST_STAYS = 5;          // sejururi încheiate afișate sub cele active
var PN_DISMISSED_PROPERTY = "PN_DISMISSED";  // „De făcut” marcate cu „Gata” (id → momentul)
var PN_DISMISSED_DAYS = 45;
var PN_LAST_RUN_PROPERTY = "CI_LAST_RUN";    // scris de checkinSync la fiecare rulare reușită
var PN_OPEN_STATUSES = ["", "nouă", "de verificat", "fără e-mail (cotă)", "așteaptă plata"];
var PN_API_TOKEN_PROPERTY = "PN_API_TOKEN";   // cheia panoului de pe Cloudflare (aceeași în secretul Worker-ului)
var PN_API_CALL = false;                      // true doar pe durata unei cereri pnApi cu cheia corectă

/* ============================== PUNCTE DE INTRARE ============================== */

// Doar proprietarul: contul autentificat care deschide pagina = contul sub care rulează scriptul.
// În web app-ul public (Anyone, fără autentificare) adresa vizitatorului e goală → refuzat.
function pnAllowed() {
  var me = "";
  try { me = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e) {}
  var owner = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  return !!me && me === owner;
}

function pnCheck() {
  if (PN_API_CALL) return;
  if (!pnAllowed()) throw new Error("Acces refuzat.");
}

// Din doPost (rezervari.gs), pentru Worker-ul de pe Cloudflare: { api: "<funcție>", token, args: [...] }.
// Cheia greșită sau lipsă → „auth”; doar funcțiile panoului de mai jos. Răspuns: același JSON ca google.script.run.
function pnApi(req) {
  var expected = String(PropertiesService.getScriptProperties().getProperty(PN_API_TOKEN_PROPERTY) || "");
  if (expected.length < 32 || String(req.token || "") !== expected) return json({ ok: false, error: "auth" });
  var fns = { pnData: pnData, pnSyncNow: pnSyncNow, pnDismiss: pnDismiss, pnBlock: pnBlock, pnUnblock: pnUnblock,
              pnSetRequestStatus: pnSetRequestStatus };
  var fn = fns.hasOwnProperty(String(req.api)) ? fns[String(req.api)] : null;
  if (!fn) return json({ ok: false, error: "fn" });
  var args = Object.prototype.toString.call(req.args) === "[object Array]" ? req.args.slice(0, 3) : [];
  PN_API_CALL = true;
  try {
    return ContentService.createTextOutput(fn.apply(null, args)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e).slice(0, 300) });
  } finally {
    PN_API_CALL = false;
  }
}

// O singură dată, din editor: creează cheia panoului de pe Cloudflare (dacă nu există). Cheia o pui și în Worker:
// npx wrangler secret put PN_API_TOKEN (vezi panou-cloudflare/README.md). Nu se scrie în log.
function pnApiToken() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty(PN_API_TOKEN_PROPERTY)) {
    p.setProperty(PN_API_TOKEN_PROPERTY, (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""));
  }
  console.log("PN_API_TOKEN există în Script Properties (" + p.getProperty(PN_API_TOKEN_PROPERTY).length + " caractere).");
}

// Apelată din doGet (rezervari.gs), după pnAllowed. Datele vin deja în pagină, fără o a doua cerere.
function pnServe() {
  var t = HtmlService.createTemplateFromFile("Panou");
  t.data = pnJson(pnBuild(false));
  return t.evaluate()
    .setTitle(PN_TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setFaviconUrl(SITE_URL + "favicon-32x32.png");
}

// Apelate din pagină (google.script.run). Fiecare verifică din nou cine cere.
function pnData(force) {
  pnCheck();
  return pnJson(pnBuild(!!force));
}

function pnSyncNow() {
  pnCheck();
  checkinSync();
  return pnJson(pnBuild(false));
}

function pnDismiss(id) {
  pnCheck();
  id = String(id || "").slice(0, 200);
  if (id) {
    var props = PropertiesService.getScriptProperties();
    var map = pnDismissed(props);
    map[id] = new Date().getTime();
    props.setProperty(PN_DISMISSED_PROPERTY, JSON.stringify(map));
  }
  return pnJson(pnBuild(false));
}

// Calendar: închide nopțile first … last (inclusiv) / redeschide o perioadă închisă din panou.
function pnBlock(first, last, reason) {
  pnCheck();
  calAddBlock(first, last, reason);
  return pnJson(pnBuild(false));
}

function pnUnblock(id) {
  pnCheck();
  calRemoveBlock(id);
  return pnJson(pnBuild(false));
}

// Solicitare de pe site: Așteaptă plata / Confirmată / Anulată, apoi sincronizarea (rezervare, fișă, cod, „A13 Direct”).
function pnSetRequestStatus(at, status) {
  pnCheck();
  calSetRequestStatus(at, status);
  checkinSync();
  return pnJson(pnBuild(false));
}

/* ============================== DATELE PANOULUI ============================== */

function pnBuild(force) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var now = new Date().getTime();
  var ctx = { now: now, today: Utilities.formatDate(new Date(now), CI_TZ, "yyyy-MM-dd"), dismissed: pnDismissed(props) };

  var active = ciLoadTable(ss, CI_SHEET, CI_HEADERS);
  var cancelled = ciLoadTable(ss, CI_SHEET_CANCELLED, CI_CANCELLED_HEADERS);
  var live = active.rows.filter(function (r) { return r["Stare"] !== CI_STATE_CANCELLED; });
  var current = live.filter(function (r) { return !pnEnded(ctx, r); });
  var past = live.filter(function (r) { return pnEnded(ctx, r); })
    .sort(function (a, b) { return String(b["Check-in"]).localeCompare(String(a["Check-in"])); })
    .slice(0, PN_PAST_STAYS);

  var requests = pnRequests(ss, ctx);
  var cal = typeof calPanelData === "function" ? calPanelData(ss, ctx, force, live) : null;
  var lock = pnLockStatus(force);
  var heat = null;   // salus.gs: termostatele și senzorii (o eroare de acolo nu oprește panoul)
  if (typeof salPanelStatus === "function") {
    try { heat = salPanelStatus({ now: now, today: ctx.today, active: active }, force); }
    catch (e) { heat = { configured: true, ok: false, at: now, error: String(e && e.message || e).slice(0, 200) }; }
  }
  var heatTodo = [];
  if (heat && heat.configured) { try { heatTodo = salPanelTodo(ctx); } catch (e) {} }
  var todo = pnLockTodo(ctx, lock).concat(pnSiteTodo(ctx), heatTodo, pnTodo(ctx, current, requests.open, cal ? cal.overlaps : []));
  var errors = pnErrors(props, now);
  var stays = current.map(function (r) { return pnStay(ctx, r); });
  var inHouse = stays.filter(function (s) { return s.phase === "inhouse" || s.phase === "departing"; })[0];

  return {
    now: now,
    today: ctx.today,
    sheetUrl: ss.getUrl(),
    sheets: pnSheetLinks(ss),
    kpi: {
      todo: todo.length,
      todoHigh: todo.filter(function (t) { return t.level === "high"; }).length,
      arrivals7: stays.filter(function (s) { return s.checkin >= ctx.today && s.checkin <= ciAddDays(ctx.today, 6); }).length,
      inHouse: inHouse ? (inHouse.name || inHouse.nr) : "",
      requestsOpen: requests.open.length,
      battery: lock.ok ? lock.battery : null,
      errors: errors.length
    },
    todo: todo,
    stays: stays,
    past: past.map(function (r) { return pnStay(ctx, r); }),
    requests: requests.list,
    cancelled: pnCancelled(cancelled.rows),
    log: pnFeed(ss, requests.list),
    cal: cal,
    health: {
      lastRun: Number(props.getProperty(PN_LAST_RUN_PROPERTY) || 0),
      trigger: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "checkinSync"; }),
      testMode: ciTestMode(),
      mailQuota: MailApp.getRemainingDailyQuota(),
      tokenExpires: Number(props.getProperty("TTLOCK_TOKEN_EXPIRES") || 0),
      errors: errors,
      lock: lock,
      heat: heat,
      calendar: pnSiteCalendar(ctx, force)
    },
    links: pnLinks()
  };
}

// Funcție, nu variabilă globală: fișierele proiectului se încarcă în ordinea din editor, iar SITE_URL / CI_* pot veni după.
function pnLinks() {
  return [
    ["Booking Extranet", "https://admin.booking.com/"],
    ["Airbnb calendar", "https://www.airbnb.com/multicalendar"],
    ["Site", SITE_URL],
    ["Statistici Umami", "https://cloud.umami.is/"],
    ["GitHub Actions", "https://github.com/rezervari/Travel-Concept-Silver-Mountain/actions"],
    ["Ghidul oaspetelui", CI_GUIDE_URL],
    ["Fișa de cazare", CI_FORM_PUBLIC]
  ].map(function (l) { return { label: l[0], href: l[1] }; });
}

// Un sejur rămâne „activ” până în ziua plecării la 12:00 și cât timp codul lui n-a fost șters de pe yală.
function pnEnded(ctx, r) {
  var cin = r["Check-in"], cout = r["Check-out"];
  if (!pnIsIso(cout)) return pnIsIso(cin) && cin < ciAddDays(ctx.today, -14);
  if (ctx.now < ciAt(cout, CI_DELETE_HOUR)) return false;
  return !ciCodeId(r) || !!r["Cod șters"];
}

function pnStay(ctx, r) {
  var cell = String(r["Cod pe yală"] || "");
  var code = (cell.match(/^(\d{4,9})#/) || [])[1] || "";
  var phone = String(r["Telefon"] || "");
  return {
    nr: String(r["Nr. rezervare"]),
    source: String(r["Sursă"] || ""),
    checkin: r["Check-in"],
    checkout: r["Check-out"],
    nights: r["Nopți"] || ciNights(r["Check-in"], r["Check-out"]),
    name: String(r["Nume"] || ""),
    phone: phone,
    email: String(r["E-mail"] || ""),
    guests: String(r["Oaspeți"] || ""),
    state: String(r["Stare"] || ""),
    notes: String(r["Note"] || ""),
    link: String(r["Link"] || ""),
    phase: pnPhase(ctx, r),
    days: pnIsIso(r["Check-in"]) ? Math.round((ciUtc(r["Check-in"]) - ciUtc(ctx.today)) / 86400000) : null,
    code: code,
    backup: /REZERVĂ/.test(cell),
    window: code ? (cell.split(" · ")[2] || "") : "",
    steps: pnSteps(ctx, r, code, /REZERVĂ/.test(cell)),
    wa: phone ? "https://wa.me/" + waNumber(phone) : "",
    tel: phone ? "tel:+" + waNumber(phone) : ""
  };
}

function pnPhase(ctx, r) {
  var cin = r["Check-in"], cout = r["Check-out"];
  if (!pnIsIso(cin)) return "unknown";
  if (cin > ctx.today) return "upcoming";
  if (cin === ctx.today) return "arriving";
  if (pnIsIso(cout) && ctx.today < cout) return "inhouse";
  if (cout === ctx.today) return "departing";
  return "past";
}

// Pașii check-in-ului: done / warn (întârziat sau problemă) / todo (încă nu e momentul).
function pnSteps(ctx, r, code, backup) {
  var cin = r["Check-in"], cout = r["Check-out"], dates = pnIsIso(cin);
  var sent = r["Link fișă trimis"], form = r["Fișă primită"], codeSent = r["Cod trimis"], deleted = r["Cod șters"];
  var arrivalDay = cin === ctx.today;
  var linkDue = dates && ctx.now >= ciAt(ciAddDays(cin, -1), CI_FORM_SEND_HOUR);
  var formLate = dates && (cin < ctx.today || (arrivalDay && ctx.now >= ciAt(cin, CI_REMIND_HOUR)));
  var codeLate = dates && (cin < ctx.today || (arrivalDay && ctx.now >= ciAt(cin, CI_CHECKIN_HOUR)));
  var deleteDue = pnIsIso(cout) && ctx.now >= ciAt(cout, CI_DELETE_HOUR);
  return [
    { key: "link", label: "Link fișă", st: sent || form ? "done" : linkDue ? "warn" : "todo",
      at: pnTime(sent), info: ciIsDate(sent) ? "" : String(sent || "") },
    { key: "form", label: "Fișă", st: form ? "done" : formLate ? "warn" : "todo", at: pnTime(form), info: "" },
    { key: "code", label: backup ? "Cod de rezervă" : "Cod pe yală", st: code ? (backup ? "warn" : "done") : codeLate ? "warn" : "todo",
      at: null, info: "" },
    { key: "sent", label: "Cod trimis", st: codeSent ? "done" : code ? "warn" : "todo", at: pnTime(codeSent), info: "" },
    { key: "deleted", label: "Cod șters", st: deleted ? "done" : code && deleteDue ? "warn" : "todo", at: pnTime(deleted), info: "" }
  ];
}

/* ---------- De făcut ---------- */

function pnTodo(ctx, rows, openRequests, overlaps) {
  var out = [];

  (overlaps || []).forEach(function (o) {
    out.push({ id: "supra|" + o.key, kind: "alert", level: "high", title: "Suprapunere: " + o.a + " și " + o.b,
      detail: pnRange(o.start, o.end) + ". Verifică imediat pe platforme și anulează sau mută una dintre rezervări.",
      nr: "", texts: [], links: [] });
  });

  openRequests.forEach(function (q) {
    var hold = /^așteaptă plata$/i.test(q.status);
    var next = hold
      ? (q.holdUntil && !q.holdActive
          ? "Blocarea temporară a expirat (" + pnHm(q.holdUntil) + "). Dacă a plătit, confirmă; altfel anulează."
          : "Datele sunt blocate temporar pe platforme" + (q.holdUntil ? " până " + pnHm(q.holdUntil) : " (24 de ore)") +
            ". Când primești plata: Plătit · confirmă.")
      : "Răspunde-i. Aștept plata = blochez datele 24 h pe platforme; Plătit · confirmă = rezervare fermă.";
    out.push({
      id: "sol|" + q.at + (hold ? "|plata" : ""), kind: "request", level: "high",
      title: (hold ? "Aștept plata: " : "Solicitare de pe site: ") + (q.name || "fără nume"),
      detail: pnRange(q.checkin, q.checkout) + " · " + q.nights + " nopți" + (q.guests ? " · " + q.guests : "") +
              (q.total ? " · " + q.total + " RON" : "") + (q.rate ? " · " + q.rate.toLowerCase() : "") +
              (q.status && !/^(nouă|așteaptă plata)$/i.test(q.status) ? " · " + q.status : "") + ". " + next,
      nr: "", texts: [], at: q.at, actions: hold ? ["Confirmată", "Anulată"] : ["Așteaptă plata", "Confirmată", "Anulată"],
      links: pnContactLinks(q.phone, q.email, "Solicitarea ta de rezervare · " + BRAND + " · " + pnRange(q.checkin, q.checkout))
        .concat([{ label: "Rândul din Sheet", href: q.sheet }])
    });
  });

  rows.forEach(function (r) {
    var nr = String(r["Nr. rezervare"]), who = r["Nume"] || nr, state = String(r["Stare"] || "");
    var cell = String(r["Cod pe yală"] || ""), code = (cell.match(/^(\d{4,9})#/) || [])[1] || "";
    var extranet = r["Link"] ? [{ label: "Rezervarea în Extranet", href: String(r["Link"]) }] : [];
    var base = { nr: nr, texts: [], links: extranet };

    if (state.indexOf(CI_STATE_CHECK) === 0 || state === CI_STATE_NO_CHECKOUT) {
      out.push(pnItem(base, "stare|" + nr + "|" + state, "check", "normal", who + ": " + state,
        pnRange(r["Check-in"], r["Check-out"]) + " · " + (r["Sursă"] || "") + ". Verifică rezervarea și corectează foaia „Rezervări” dacă e nevoie."));
    }

    // Reminder de lipit în chatul Booking (aceleași condiții ca ciArrivalReminders).
    if (r["Sursă"] === "Booking" && r["Check-in"] === ctx.today && !r["Fișă primită"] && !code &&
        ctx.now >= ciAt(ctx.today, CI_REMIND_HOUR)) {
      var it = pnItem(base, "reminder|" + nr, "booking-chat", "high", "De trimis în chatul Booking: reminder fișă",
        who + " sosește azi și nu a completat fișa. Dacă până la 16:00 tot nu o completează, pun automat un cod de rezervă.");
      it.texts = [{ label: "Română", text: ciReminderChatText("ro") }, { label: "English", text: ciReminderChatText("en") }];
      out.push(it);
    }

    // Codul de rezervă pe care oaspetele nu-l primește automat (Booking sau fără e-mail).
    if (code && /REZERVĂ/.test(cell) && (r["Sursă"] === "Booking" || !r["E-mail"])) {
      var b = pnItem(base, "rezerva|" + nr, "booking-chat", "high", "De trimis oaspetelui: codul de rezervă " + code + "#",
        who + " · " + (cell.split(" · ")[2] || "") + ". Fișa nu a venit până la 16:00, așa că am pus pe yală un cod aleator.");
      b.texts = [{ label: "Română", text: ciBackupChatText("ro", code) }, { label: "English", text: ciBackupChatText("en", code) }];
      out.push(b);
    }

    String(r["Alerte"] || "").split(";").forEach(function (key) {
      var a = pnAlert(key, r, code);
      if (!a) return;
      var x = pnItem(base, "alerta|" + nr + "|" + key, "alert", "high", a[0] + " · " + who, a[1]);
      if (a[2]) x.texts = [{ label: a[2][0], text: a[2][1] }];
      out.push(x);
    });
  });

  return out.filter(function (t) { return !ctx.dismissed[t.id]; });
}

// Problemele yalei pentru care ciLockHealth (checkin.gs) a trimis deja alerta; dispar când trec. „Gata” ascunde
// incidentul curent, nu și pe următorul.
function pnLockTodo(ctx, lock) {
  var h = ciLockHealthState(), out = [];
  var base = { nr: "", texts: [], links: [] };
  if (h.gateway && h.gateway.alerted) {
    out.push(pnItem(base, "yala|gateway|" + h.gateway.since, "alert", "high", "Yala: gateway-ul e offline",
      "Offline " + pnHm(h.gateway.since) + ". Codurile nu se pot pune, muta sau șterge de la distanță. Verifică curentul și " +
      "Wi-Fi-ul din apartament (repornește gateway-ul din priză); lângă ușă, codul se poate pune din aplicația TTLock prin Bluetooth."));
  }
  if (h.ttlock && h.ttlock.alerted) {
    out.push(pnItem(base, "yala|ttlock|" + h.ttlock.since, "alert", "high", "Yala: TTLock nu răspunde",
      "Fără răspuns " + pnHm(h.ttlock.since) + ". Codurile nu se pot pune automat. Verifică aplicația TTLock și secțiunea Sistem."));
  }
  if (h.battery && h.battery.alerted) {
    var pct = lock.ok && lock.battery != null ? lock.battery + "%" : "sub " + h.battery.level + "%";
    out.push(pnItem(base, "yala|baterie|" + h.battery.since + "|" + h.battery.level, "alert",
      h.battery.level <= CI_BATTERY_CRITICAL ? "high" : "normal", "Yala: baterie slabă (" + pct + ")",
      "Schimbă bateriile yalei" + (h.battery.level <= CI_BATTERY_CRITICAL ? " cât mai repede." : " la următoarea vizită în apartament.")));
  }
  return out.filter(function (t) { return !ctx.dismissed[t.id]; });
}

// Calendarul de pe site, cât timp alerta din calendar.gs (calSiteHealth) e activă.
function pnSiteTodo(ctx) {
  if (typeof calSiteHealthState !== "function") return [];
  var h = calSiteHealthState();
  if (!h.alerted) return [];
  var links = [{ label: "Update calendar (GitHub)", href: "https://github.com/rezervari/Travel-Concept-Silver-Mountain/actions/workflows/update-calendar.yml" }];
  var item = pnItem({ nr: "", texts: [], links: links }, "site-calendar|" + h.since, "alert", "high",
    "Calendarul de pe site nu se actualizează",
    "Ultima rulare „Update calendar” pe GitHub " + pnHm(h.since) + ". Rezervările noi de pe platforme nu apar pe site. " +
    "Verifică rulările pe GitHub și tokenul GITHUB_DISPATCH_TOKEN din Worker-ul a13-panou; între timp: Run workflow.");
  return ctx.dismissed[item.id] ? [] : [item];
}

function pnItem(base, id, kind, level, title, detail) {
  return { id: id, kind: kind, level: level, title: title, detail: detail, nr: base.nr,
           texts: base.texts.slice(), links: base.links.slice() };
}

// Alertele trimise o singură dată de checkin.gs (coloana „Alerte”), cât timp problema e încă de actualitate.
// [titlu, ce ai de făcut, opțional [eticheta, text de copiat]]. reminder-fisa și rezerva-trimite sunt tratate mai sus.
function pnAlert(key, r, code) {
  switch (key) {
    case "telefon":
      return code ? null : ["Cod nepus: telefon lipsă", "Scrie telefonul oaspetelui în coloana „Telefon” din foaia „Rezervări”; codul se pune la următoarea sincronizare."];
    case "fara-plecare":
    case "rezerva-fara-plecare":
      return code ? null : ["Cod nepus: lipsește data plecării", "Completează coloana „Check-out” din foaia „Rezervări”."];
    case "ttlock":
    case "rezerva-ttlock":
    case "sosire-fara-cod":
      return code ? null : ["Codul nu a putut fi pus pe yală", "Verifică gateway-ul din apartament (secțiunea Sistem). Reîncerc la fiecare 10 minute; detaliile sunt în jurnal."];
    case "stergere":
      return r["Cod șters"] ? null : ["Codul nu s-a putut șterge de pe yală", "Șterge-l din aplicația TTLock: " + code + "#."];
    case "schimbare":
      return ["Valabilitatea codului nu s-a putut muta", "Modifică manual codul " + code + "# în aplicația TTLock: " +
              (pnIsIso(r["Check-in"]) && pnIsIso(r["Check-out"]) ? ciWindowLabel(r) : "datele noi") + "."];
    case "cod-fara-email":
      return r["Cod trimis"] ? null : ["Cod pus, dar fără e-mailul oaspetelui", "Trimite-i tu codul " + code + "#."];
    case "fara-email":
      return r["Fișă primită"] ? null : ["Link fișă netrimis: lipsește e-mailul", "Trimite-i oaspetelui linkul spre fișa de cazare.",
                                        ["Link fișă", CI_FORM_PUBLIC]];
    default:
      return null;
  }
}

/* ---------- Solicitări de pe site, anulări, jurnal ---------- */

function pnRequests(ss, ctx) {
  var sh = ss.getSheetByName(CI_REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { list: [], open: [] };
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = ciHeaderIndex(values[0]);
  function get(v, h) { return col[h] == null ? "" : v[col[h]]; }
  var since = ctx.now - PN_REQUEST_DAYS * 86400000, base = ss.getUrl() + "#gid=" + sh.getSheetId() + "&range=A";
  var list = [];
  for (var i = values.length - 1; i >= 1 && list.length < PN_REQUEST_MAX; i--) {
    var v = values[i], at = get(v, "Primită la");
    if (!ciIsDate(at) || at.getTime() < since) continue;
    var q = {
      at: at.getTime(),
      name: String(get(v, "Nume") || "").trim(),
      phone: ciPhone(get(v, "Telefon")),
      email: String(get(v, "Email") || "").trim(),
      checkin: ciIso(get(v, "Check-in")),
      checkout: ciIso(get(v, "Check-out")),
      guests: ciGuests(get(v, "Adulți"), get(v, "Copii")),
      total: Number(get(v, "Total RON")) || 0,
      status: String(get(v, "Status") || "").trim(),
      source: String(get(v, "Sursă") || "").trim(),
      verify: String(get(v, "Verificare") || "").trim(),
      rate: String(get(v, "Tarif") || "").trim(),
      sheet: base + (i + 1)
    };
    q.nights = Number(get(v, "Nopți")) || ciNights(q.checkin, q.checkout) || "";
    q.open = PN_OPEN_STATUSES.indexOf(q.status.toLowerCase()) >= 0 && pnIsIso(q.checkout) && q.checkout >= ctx.today;
    q.links = pnContactLinks(q.phone, q.email, "Solicitarea ta de rezervare · " + BRAND + " · " + pnRange(q.checkin, q.checkout));
    list.push(q);
  }
  if (typeof calHolds === "function") {
    calHolds(ss, ctx.now).forEach(function (h) {
      list.forEach(function (q) {
        if (q.at === h.at) { q.holdUntil = h.until; q.holdActive = h.active; }
      });
    });
  }
  return { list: list, open: list.filter(function (q) { return q.open; }) };
}

function pnContactLinks(phone, email, subject) {
  var out = [];
  if (phone) {
    out.push({ label: "WhatsApp", href: "https://wa.me/" + waNumber(phone), kind: "wa" });
    out.push({ label: "Sună", href: "tel:+" + waNumber(phone), kind: "tel" });
  }
  if (email) out.push({ label: "E-mail", href: "mailto:" + email + "?subject=" + encodeURIComponent(subject), kind: "mail" });
  return out;
}

function pnCancelled(rows) {
  return rows.slice()
    .sort(function (a, b) { return (pnTime(b["Anulată la"]) || 0) - (pnTime(a["Anulată la"]) || 0); })
    .slice(0, PN_CANCELLED_MAX)
    .map(function (r) {
      return { nr: String(r["Nr. rezervare"]), source: String(r["Sursă"] || ""), checkin: r["Check-in"], checkout: r["Check-out"],
               name: String(r["Nume"] || ""), at: pnTime(r["Anulată la"]) };
    });
}

// Jurnalul din „Jurnal” + solicitările de pe site, într-un singur flux, cele mai noi primele.
function pnFeed(ss, requests) {
  var feed = [];
  var sh = ss.getSheetByName(CI_SHEET_LOG);
  if (sh && sh.getLastRow() > 1) {
    var n = Math.min(PN_LOG_ROWS, sh.getLastRow() - 1);
    sh.getRange(sh.getLastRow() - n + 1, 1, n, CI_LOG_HEADERS.length).getValues().forEach(function (v) {
      var ev = String(v[1] || "");
      feed.push({ at: pnTime(v[0]) || 0, ev: ev, nr: String(v[2] || ""), det: String(v[3] || ""), cat: pnLogCat(ev) });
    });
  }
  requests.forEach(function (q) {
    feed.push({ at: q.at, ev: "Solicitare nouă de pe site", nr: "", cat: "site",
                det: (q.name || "") + ", " + pnRange(q.checkin, q.checkout) + (q.total ? ", " + q.total + " RON" : "") +
                     (q.source ? " · " + q.source : "") });
  });
  return feed.sort(function (a, b) { return b.at - a.at; }).slice(0, PN_LOG_ROWS);
}

function pnLogCat(ev) {
  if (/Eroare|nepus|neșters|necunoscut|necitită|fără rezervare|Lipsește/i.test(ev)) return "err";
  if (/Cod|Valabilitate/i.test(ev)) return "code";
  if (/Fișă|Reminder|Link fișă/i.test(ev)) return "form";
  return "booking";
}

/* ---------- Starea sistemului ---------- */

function pnErrors(props, now) {
  var seen = {};
  try { seen = JSON.parse(props.getProperty("CI_LAST_ERRORS") || "{}"); } catch (e) {}
  return Object.keys(seen)
    .filter(function (k) { return now - seen[k] < 86400000; })
    .map(function (k) { return { at: seen[k], text: k }; })
    .sort(function (a, b) { return b.at - a.at; });
}

// Yala (TTLock): baterie, gateway, codurile valabile. Doar citire; păstrată în cache 15 minute.
function pnLockStatus(force) {
  var cache = CacheService.getScriptCache();
  var hit = force ? null : cache.get("pn_lock");
  if (hit) return JSON.parse(hit);
  var st;
  try {
    var lockId = String(ttlLockId());
    var lock = (ttlCall("/v3/lock/list", { pageNo: 1, pageSize: 20 }).list || [])
      .filter(function (l) { return String(l.lockId) === lockId; })[0] || {};
    var now = new Date().getTime();
    var codes = (ttlCall("/v3/lock/listKeyboardPwd", { lockId: lockId, pageNo: 1, pageSize: 100 }).list || [])
      .filter(function (c) { return !c.endDate || c.endDate > now; })
      .map(function (c) {
        return { name: String(c.keyboardPwdName || ""), code: String(c.keyboardPwd || ""),
                 start: c.startDate || null, end: c.endDate || null };
      })
      .sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
    var online = null;
    try {
      var gws = ttlCall("/v3/gateway/list", { pageNo: 1, pageSize: 20 }).list || [];
      if (gws.length && gws[0].isOnline != null) online = gws.some(function (g) { return Number(g.isOnline) === 1; });
    } catch (e) {}
    st = { ok: true, at: now, name: String(lock.lockAlias || lock.lockName || ""), battery: lock.electricQuantity != null ? Number(lock.electricQuantity) : null,
           gateway: !!lock.hasGateway, gatewayOnline: online, codes: codes };
  } catch (e) {
    st = { ok: false, at: new Date().getTime(), error: String(e && e.message || e).slice(0, 200) };
  }
  cache.put("pn_lock", JSON.stringify(st), st.ok ? PN_LOCK_CACHE_SEC : 120);
  return st;
}

// Calendarul de pe site (booked-dates.json, scris de GitHub Actions din iCal-urile platformelor).
// checkedAt = ultima rulare GitHub (calendar.gs); updatedAt = ultima schimbare a zilelor ocupate.
function pnSiteCalendar(ctx, force) {
  var st = pnSiteCalendarFile(ctx, force);
  if (st.ok && typeof calGithubLastFetch === "function") {
    st.checkedAt = calGithubLastFetch() || null;
    st.staleMs = CAL_SITE_STALE_MIN * 60000;
  }
  return st;
}

function pnSiteCalendarFile(ctx, force) {
  var cache = CacheService.getScriptCache();
  var hit = force ? null : cache.get("pn_cal");
  if (hit) return JSON.parse(hit);
  var st;
  try {
    var res = UrlFetchApp.fetch(SITE_URL + "booked-dates.json?t=" + ctx.now, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error("HTTP " + res.getResponseCode());
    var data = JSON.parse(res.getContentText());
    var next = (data.ranges || [])
      .map(function (r) { return { start: String(r.start).slice(0, 10), end: String(r.end).slice(0, 10) }; })
      .filter(function (r) { return r.end > ctx.today; })
      .slice(0, 6);
    st = { ok: true, updatedAt: data.updatedAt ? new Date(data.updatedAt).getTime() : null, sources: data.sources || {}, next: next };
  } catch (e) {
    st = { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
  cache.put("pn_cal", JSON.stringify(st), st.ok ? PN_SITE_CACHE_SEC : 60);
  return st;
}

/* ---------- mărunțișuri ---------- */

function pnSheetLinks(ss) {
  var out = {};
  [CI_REQUESTS_SHEET, CI_SHEET, CI_SHEET_CANCELLED, CI_SHEET_LOG].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) out[name] = ss.getUrl() + "#gid=" + sh.getSheetId();
  });
  return out;
}

function pnDismissed(props) {
  var map = {};
  try { map = JSON.parse(props.getProperty(PN_DISMISSED_PROPERTY) || "{}"); } catch (e) {}
  var limit = new Date().getTime() - PN_DISMISSED_DAYS * 86400000;
  Object.keys(map).forEach(function (k) { if (map[k] < limit) delete map[k]; });
  return map;
}

// „8 – 11 dec. 2026”; fără dată de plecare: „8 decembrie 2026”.
function pnRange(a, b) {
  if (!pnIsIso(a)) return "";
  return pnIsIso(b) && b > a ? rangeShort(a, b) : longDate(a);
}

// „azi la 14:30” / „pe 24.10 la 14:30”
function pnHm(ms) {
  var d = new Date(ms), day = Utilities.formatDate(d, CI_TZ, "yyyy-MM-dd");
  var hm = Utilities.formatDate(d, CI_TZ, "HH:mm");
  if (day === Utilities.formatDate(new Date(), CI_TZ, "yyyy-MM-dd")) return "azi la " + hm;
  return "pe " + Utilities.formatDate(d, CI_TZ, "dd.MM") + " la " + hm;
}

function pnIsIso(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")); }

function pnTime(v) { return ciIsDate(v) && !isNaN(v.getTime()) ? v.getTime() : null; }

// JSON care poate sta și într-un <script> (fără „</script>” în texte).
function pnJson(obj) { return JSON.stringify(obj).replace(/</g, "\\u003c"); }
