/**
 * Notificări pe telefon prin Telegram (botul A13): tot ce se întâmplă — solicitări de pe site, rezervări Booking,
 * fișe, coduri, alerte, erori — plus textele de lipit în chatul Booking, care se copiază dintr-o atingere, și un
 * rezumat zilnic la 08:00. Butoane spre panou, Extranet, WhatsApp-ul oaspetelui.
 *
 * Același proiect Apps Script (motorul Rhino → doar ES5; nume cu prefix TG_/tg). Cârlige: ciAppendLog și ciAlertOwner
 * (checkin.gs), calLog (calendar.gs), doPost (rezervari.gs). Nicio funcție de aici nu aruncă erori spre ele: dacă
 * Telegram nu răspunde, restul merge mai departe (e-mailurile pleacă la fel ca înainte).
 *
 * Script Properties: TG_BOT_TOKEN (de la @BotFather; secret), TG_CHAT_ID (îl pune tgSetup), PANOU_URL (butonul
 * „Panou”), TG_ENABLED = "0" oprește temporar notificările. Instalare: apps-script/README.md.
 */

var TG_API = "https://api.telegram.org/bot";
var TG_TOKEN_PROPERTY = "TG_BOT_TOKEN";
var TG_CHAT_PROPERTY = "TG_CHAT_ID";
var TG_PANEL_PROPERTY = "PANOU_URL";
var TG_ENABLED_PROPERTY = "TG_ENABLED";
var TG_SUMMARY_HOUR = 8;
var TG_MAX_CHARS = 3900;   // limita Telegram e 4096 de caractere pe mesaj

// Evenimentele din „Jurnal” trimise pe Telegram: [tipar, nivel, simbol]. „alert” = cu sunet, „info” = fără sunet
// (cele „info” dintr-o rulare pleacă împreună, într-un singur mesaj). Lipsesc intenționat: cele care se repetă la
// fiecare rulare cât durează o eroare (pentru ele pleacă o singură alertă prin ciAlertOwner) și cele dublate de o
// alertă (anulări, suprapuneri, plată neîncasată, fișă fără rezervare, cod trimis).
var TG_EVENT_RULES = [
  [/^Rezervare nouă$/, "alert", "🛎️"],
  [/^(Date modificate|Plecare modificată|Lipsește din calendarul Booking|E-mail Booking necunoscut)$/, "alert", "⚠️"],
  [/^(Rezervare confirmată|Rezervare reconfirmată)$/, "info", "✅"],
  [/^(Fișă primită|Încă o fișă|Fișă necitită)$/, "info", "📝"],
  [/^(Link fișă trimis|Reminder fișă trimis)$/, "info", "✉️"],
  [/^(Cod șters de pe yală|Valabilitate cod mutată)$/, "info", "🔑"],
  [/^(Plecare din calendar|Perioadă blocată|Perioadă redeschisă|Blocare temporară \(aștept plata\))$/, "info", "📅"],
  [/^Status solicitare: /, "info", "📋"],
  [/^Rezervare de test/, "info", "🧪"]
];

/* ============================== INSTALARE ============================== */

// Rulată o dată din editor, după ce ai trimis /start botului: găsește chatul tău, îl salvează, pornește rezumatul de
// la 08:00 și îți trimite un mesaj de confirmare.
function tgSetup() {
  if (!tgToken()) throw new Error("Lipsește " + TG_TOKEN_PROPERTY + " în Script Properties (cheia de la @BotFather).");
  var bot = tgApi("getMe", {}).result;
  var chats = (tgApi("getUpdates", {}).result || [])
    .map(function (u) { return (u.message || u.my_chat_member || {}).chat; })
    .filter(function (c) { return c && c.type === "private"; });
  if (!chats.length) throw new Error("Trimite întâi /start botului @" + bot.username + " din Telegram, apoi rulează din nou tgSetup.");
  var chat = chats[chats.length - 1];
  PropertiesService.getScriptProperties().setProperty(TG_CHAT_PROPERTY, String(chat.id));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgDailySummary") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgDailySummary").timeBased().atHour(TG_SUMMARY_HOUR).nearMinute(0).everyDays(1).inTimezone(CI_TZ).create();
  tgSend("✅ <b>Notificările A13 sunt conectate.</b>\nAici primești solicitările de pe site, rezervările Booking, fișele, " +
         "codurile, alertele și textele de lipit în Booking (atinge textul gri ca să-l copiezi). Rezumatul vine zilnic la " +
         TG_SUMMARY_HOUR + ":00.", { level: "alert", panel: true });
  console.log("Conectat la chatul lui " + (chat.first_name || "") + " (@" + (chat.username || "-") + "), bot @" + bot.username + ".");
}

// Trimite câte un exemplu din fiecare fel de mesaj (date fictive), ca să le vezi pe telefon.
function tgTest() {
  tgNewRequest({ name: "Andrei Popescu (EXEMPLU)", phone: "0722 123 456", email: "andrei@example.com", checkin: "2026-12-08",
                 checkout: "2026-12-11", nights: 3, adults: 2, children: 1, total: 3300, rate: "nerambursabil",
                 source: "google / organic · gbp", notes: [] }, "Nouă", "");
  tgEvents([[new Date(), "Rezervare nouă", "6000000000", "Booking, sosire 2026-12-20"],
            [new Date(), "Fișă primită", "6000000000", "Andrei Popescu"],
            [new Date(), "Cod șters de pe yală", "5000000000", "după plecare"]]);
  tgAlert("Reminder fișă de trimis în Booking: EXEMPLU",
    "Rezervarea 6000000000 sosește azi, dar fișa de cazare nu e completată. Trimite-i oaspetelui, din chatul Booking, mesajul de mai jos.\n\n" +
    "— RO —\n" + ciReminderChatText("ro") + "\n\n— EN —\n" + ciReminderChatText("en") +
    "\n\nRezervarea: 6000000000 (Booking), 2026-12-20 → 2026-12-23");
}

/* ============================== EVENIMENTE ============================== */

// Din ciAppendLog / calLog: rânduri [data, eveniment, nr, detalii].
function tgEvents(rows) {
  try {
    if (!tgReady() || !rows || !rows.length) return;
    var infos = [];
    rows.forEach(function (row) {
      var ev = String(row[1] || ""), nr = String(row[2] || ""), det = tgDates(String(row[3] || ""));
      var rule = TG_EVENT_RULES.filter(function (x) { return x[0].test(ev); })[0];
      if (!rule) return;
      var line = rule[2] + " <b>" + tgEsc(ev) + "</b>" + (nr ? " · <code>" + tgEsc(nr) + "</code>" : "") + (det ? "\n" + tgEsc(det) : "");
      if (rule[1] === "alert") tgSend(line, { level: "alert", buttons: tgNrButtons(nr), panel: true });
      else infos.push(line);
    });
    if (infos.length) tgSend(infos.join("\n\n"), { level: "info" });
  } catch (e) {
    console.warn("Telegram (evenimente): " + tgClean(e));
  }
}

// Din ciAlertOwner: aceleași alerte ca pe e-mail. Textele „— RO — / — EN —” devin blocuri care se copiază dintr-o atingere.
function tgAlert(subject, text) {
  try {
    if (!tgReady()) return;
    text = String(text || "");
    var body, ro = text.indexOf("— RO —"), en = text.indexOf("— EN —");
    if (ro >= 0 && en > ro) {
      var tailAt = text.indexOf("\n\nRezervarea:", en);
      var intro = text.slice(0, ro).replace(/\s+$/, "");
      var roText = text.slice(ro + 6, en).replace(/^\s+|\s+$/g, "");
      var enText = text.slice(en + 6, tailAt > 0 ? tailAt : text.length).replace(/^\s+|\s+$/g, "");
      var tail = tailAt > 0 ? text.slice(tailAt).replace(/^\s+/, "") : "";
      body = tgEsc(intro) + "\n\n🇷🇴 Română — atinge textul ca să-l copiezi:\n<pre><code class=\"language-RO\">" + tgEsc(roText) + "</code></pre>" +
             "\n🇬🇧 English:\n<pre><code class=\"language-EN\">" + tgEsc(enText) + "</code></pre>" + (tail ? "\n" + tgEsc(tgDates(tail)) : "");
    } else {
      body = tgEsc(tgDates(text));
    }
    var info = /^Cod trimis/.test(subject);
    var icon = info ? "🔑" : ro >= 0 ? "💬" : /^SUPRAPUNERE/.test(subject) ? "🚨" : "⚠️";
    var nr = (text.match(/Rezervarea:? (\d{8,12})\b/) || subject.match(/\b(\d{8,12})\b/) || [])[1] || "";
    tgSend(icon + " <b>" + tgEsc(subject) + "</b>\n" + body, { level: info ? "info" : "alert", buttons: tgNrButtons(nr), panel: true });
  } catch (e) {
    console.warn("Telegram (alertă): " + tgClean(e));
  }
}

// Din doPost (rezervari.gs): solicitare nouă de pe site (r = datele validate, cu prețul recalculat).
function tgNewRequest(r, status, sheetUrl) {
  try {
    if (!tgReady()) return;
    var lines = ["🆕 <b>Solicitare nouă de pe site</b>", "<b>" + tgEsc(r.name) + "</b>",
      tgEsc(rangeShort(r.checkin, r.checkout) + " · " + r.nights + (r.nights === 1 ? " noapte" : " nopți") +
            (ciGuests(r.adults, r.children) ? " · " + ciGuests(r.adults, r.children) : "")),
      tgEsc(totalLabel(r) + " · " + rateLabel(r)),
      "📞 <code>" + tgEsc(r.phone) + "</code>" + (r.email ? " · " + tgEsc(r.email) : "")];
    if (r.source) lines.push("Sursă: " + tgEsc(r.source));
    if (r.notes && r.notes.length) lines.push("⚠️ <b>De verificat:</b> " + tgEsc(r.notes.join("; ")));
    if (status && !/^Nouă$/.test(status)) lines.push("Status: " + tgEsc(status) +
      (/cotă/.test(status) ? " — e-mailul NU a plecat (cota zilnică e epuizată); răspunde-i de aici." : ""));
    var buttons = [{ text: "WhatsApp", url: "https://wa.me/" + waNumber(r.phone) }];
    if (sheetUrl) buttons.push({ text: "Sheet", url: sheetUrl });
    tgSend(lines.join("\n"), { level: "alert", buttons: buttons, panel: true });
  } catch (e) {
    console.warn("Telegram (solicitare): " + tgClean(e));
  }
}

/* ============================== REZUMATUL ZILNIC ============================== */

// Declanșator zilnic la 08:00 (îl pune tgSetup). Aceleași date ca panoul.
function tgDailySummary() {
  if (!tgReady()) return;
  var d = pnBuild(false), out = [];
  var tomorrow = ciAddDays(d.today, 1);
  out.push("☀️ <b>Rezumat · " + tgEsc(weekday(d.today) + ", " + longDate(d.today)) + "</b>");

  var todays = d.stays.filter(function (s) { return s.phase === "arriving" || s.phase === "inhouse" || s.phase === "departing"; });
  if (!todays.length) {
    var next = d.stays.filter(function (s) { return s.phase === "upcoming"; })[0];
    out.push("🏠 Apartament liber azi." + (next ? " Următoarea sosire: " + tgEsc(tgShortDate(next.checkin)) +
             " (" + (next.days === 1 ? "mâine" : "peste " + next.days + " zile") + ", " + tgEsc(next.source) + ")." : ""));
  }
  todays.forEach(function (s) {
    var what = s.phase === "arriving" ? "🛬 Sosește azi" : s.phase === "departing" ? "🛫 Pleacă azi" : "🏠 În apartament";
    out.push(what + ": <b>" + tgEsc(s.name || s.nr) + "</b> (" + tgEsc(s.source) + ") · " +
             tgEsc(tgShortDate(s.checkin) + " → " + tgShortDate(s.checkout)) + "\n" + tgSteps(s));
  });
  d.stays.filter(function (s) { return s.checkin === tomorrow; }).forEach(function (s) {
    out.push("📅 Mâine sosește: <b>" + tgEsc(s.name || s.nr) + "</b> (" + tgEsc(s.source) + ")\n" + tgSteps(s));
  });

  out.push(d.todo.length ? "📋 <b>De făcut: " + d.todo.length + "</b>\n" + d.todo.slice(0, 6).map(function (t) { return "• " + tgEsc(t.title); }).join("\n")
                         : "📋 Nimic de făcut.");
  var h = d.health, sys = [];
  if (h.lock.ok) sys.push("Yală: baterie " + (h.lock.battery != null ? h.lock.battery + "%" : "?") +
                          (h.lock.gatewayOnline === false ? ", gateway OFFLINE" : ""));
  else sys.push("Yală: TTLock nu răspunde");
  var age = h.lastRun ? Math.round((d.now - h.lastRun) / 60000) : null;
  sys.push(age == null ? "Sincronizare: nicio rulare înregistrată" : age > 25 ? "Sincronizare: ultima rulare acum " + age + " min ⚠️" : "Sincronizare: OK");
  if (h.errors.length) sys.push("Erori în 24 h: " + h.errors.length);
  if (h.testMode) sys.push("MOD TEST activ");
  out.push("⚙️ " + tgEsc(sys.join(" · ")));
  tgSend(out.join("\n\n"), { level: "alert", panel: true });
}

function tgSteps(s) {
  var mark = { done: "✓", warn: "⚠️", todo: "·" };
  return "    " + s.steps.map(function (x) { return x.label + " " + (mark[x.st] || "·"); }).join("  ");
}

/* ============================== TRIMITERE ============================== */

// opts: level ("alert" = cu sunet, altfel fără), buttons [{text,url}], panel (adaugă butonul „Panou” dacă e setat).
// Întoarce true dacă mesajul a plecat. Nu aruncă erori.
function tgSend(html, opts) {
  opts = opts || {};
  if (!tgReady()) return false;
  var buttons = (opts.buttons || []).slice();
  var panel = PropertiesService.getScriptProperties().getProperty(TG_PANEL_PROPERTY);
  if (opts.panel && panel) buttons.push({ text: "Panou", url: panel });
  buttons = buttons.filter(function (b) { return b && b.text && /^https:\/\//.test(String(b.url || "")); });
  var payload = { chat_id: PropertiesService.getScriptProperties().getProperty(TG_CHAT_PROPERTY), text: html,
                  parse_mode: "HTML", disable_web_page_preview: true, disable_notification: opts.level !== "alert" };
  if (buttons.length) {
    var rows = [];
    for (var i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    payload.reply_markup = { inline_keyboard: rows };
  }
  try {
    if (html.length > TG_MAX_CHARS) throw new Error("prea lung");
    tgApi("sendMessage", payload);
    return true;
  } catch (e) {
    // Text prea lung sau HTML respins de Telegram: îl trimit ca text simplu, scurtat.
    try {
      payload.text = tgPlain(html).slice(0, TG_MAX_CHARS);
      delete payload.parse_mode;
      tgApi("sendMessage", payload);
      return true;
    } catch (e2) {
      console.warn("Telegram: " + tgClean(e2));
      return false;
    }
  }
}

function tgApi(method, payload) {
  var res = UrlFetchApp.fetch(TG_API + tgToken() + "/" + method, {
    method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (!body.ok) throw new Error("Telegram " + method + ": HTTP " + res.getResponseCode() + " " + (body.description || ""));
  return body;
}

/* ============================== MĂRUNȚIȘURI ============================== */

function tgToken() { return String(PropertiesService.getScriptProperties().getProperty(TG_TOKEN_PROPERTY) || "").trim(); }

function tgReady() {
  var p = PropertiesService.getScriptProperties();
  return !!tgToken() && !!p.getProperty(TG_CHAT_PROPERTY) && p.getProperty(TG_ENABLED_PROPERTY) !== "0";
}

// Butoane pentru un număr de rezervare Booking (10 cifre): Extranet.
function tgNrButtons(nr) {
  return /^\d{8,12}$/.test(String(nr || ""))
    ? [{ text: "Extranet", url: "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=" + nr + "&hotel_id=" + CI_BOOKING_HOTEL_ID }]
    : [];
}

function tgEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function tgPlain(html) {
  return String(html).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// 2026-10-28 → 28.10.2026 (în textele din jurnal și alerte)
function tgDates(s) { return String(s).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3.$2.$1"); }

// „mie. 28 oct.”
function tgShortDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "?";
  return weekday(iso).slice(0, 3) + ". " + parseDay(iso).getUTCDate() + " " + LUNI_SCURT[parseDay(iso).getUTCMonth()];
}

// Erorile de rețea pot conține URL-ul cu cheia botului: o scot.
function tgClean(e) { return String(e && e.message || e).replace(/bot\d+:[\w-]+/g, "bot…").slice(0, 300); }
