/**
 * fin-telegram.gs — cheltuielile trimise botului de Telegram ajung în „A13 – Sejururi și cheltuieli” (finante.gs).
 *
 * Scrii „spălătorie 231,26”, „întreținere 1.020,40 oct”, „dedeman 269,67 ieri” (sau trimiți poza bonului cu textul
 * ca descriere) → rândul apare în foaia Cheltuieli, iar botul răspunde cu ce a înțeles + totalul lunii, cu butoanele
 * Altă categorie / Altă dată / Anulează. Facturile lunare („Fixă lunară” în Setări): pe 1 ale lunii se creează rândurile
 * galbene (fără sumă), iar din data de 5, de la 08:00, botul trimite o dată lista celor lipsă, cu butoane: atingi una și
 * scrii suma. Comenzi: /luna, /lipsa, /anuleaza, /ajutor.
 *
 * Drumul unui mesaj: Telegram → Worker-ul „a13-telegram” (telegram-cloudflare/: fără secrete, acceptă doar cereri de pe
 * IP-urile Telegram) → doPost (rezervari.gs) cu { tgRelay, secret, update } → finTgRelay. Cheia webhook-ului
 * (FIN_TG_SECRET, generată de finTgSetup) o trimite Telegram în antet și se compară aici; apoi doar chatul TG_CHAT_ID.
 * Webhook-ul trece prin implementarea „Calendar” → după o modificare a acestui fișier: Deploy → Manage deployments →
 * „Calendar” → versiune nouă. finMonthly e chemată din checkinSync (declanșatorul de 10 minute, cod salvat).
 *
 * Cât timp webhook-ul e pornit, getUpdates (tgSetup din telegram.gs) nu mai merge: finTgStop îl oprește.
 * ES5 (Rhino). Prefix FIN_TG_/finTg. Teste locale: test-fin-telegram.cjs (în afara repo-ului).
 */

var FIN_TG_SECRET_PROP = "FIN_TG_SECRET";
var FIN_TG_RELAY_URL = "https://a13-telegram.mircea-george-vulcanescu.workers.dev/";
var FIN_TG_BILLS_PROP = "FIN_BILLS_MONTH";     // luna pentru care s-au creat rândurile facturilor lunare
var FIN_TG_REMIND_PROP = "FIN_REMIND_MONTH";   // luna în care s-a trimis lista facturilor lipsă
var FIN_TG_REMIND_DAY = 5;
var FIN_TG_REMIND_HOUR = 8;
var FIN_TG_STATE_TTL = 1800;                   // 30 min: cât așteaptă botul suma / data / categoria cerută
var FIN_TG_UNDO_TTL = 21600;                   // 6 h: cât se poate anula din buton
var FIN_TG_MAX_AMOUNT = 100000;
var FIN_TG_MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie",
  "octombrie", "noiembrie", "decembrie"];
var FIN_TG_MONTH_WORDS = [["ian", "ianuarie"], ["feb", "febr", "februarie"], ["mar", "mart", "martie"], ["apr", "aprilie"],
  ["mai"], ["iun", "iunie"], ["iul", "iulie"], ["aug", "august"], ["sep", "sept", "septembrie"], ["oct", "octombrie"],
  ["noi", "nov", "noiembrie"], ["dec", "decembrie"]];

// Cuvinte (litere mici, fără diacritice) → [categorie, furnizor]. Primul cuvânt recunoscut dă categoria.
var FIN_TG_KEYWORDS = [
  [/^(intretinere|intretinerea|silver|asociatie|asociatia|administrator|administratie)$/, "Întreținere Silver", ""],
  [/^(curatenie|curatenia|menaj|curatat)$/, "Curățenie", ""],
  [/^(spalatorie|spalatoria|spalat|lenjerie|lenjerii|prosoape|covor)$/, "Spălătorie lenjerii", "Spălătorie"],
  [/^(digi|rcs|internet|tv|cablu)$/, "Internet/TV", "Digi"],
  [/^(parcare|parcarea|parking)$/, "Parcare", ""],
  [/^(boxa|boxei|depozitare|depozit)$/, "Boxă depozitare", ""],
  [/^dm$/, "Consumabile", "dm"],
  [/^(carrefour|carefour)$/, "Consumabile", "Carrefour"],
  [/^kaufland$/, "Consumabile", "Kaufland"],
  [/^lidl$/, "Consumabile", "Lidl"],
  [/^auchan$/, "Consumabile", "Auchan"],
  [/^profi$/, "Consumabile", "Profi"],
  [/^penny$/, "Consumabile", "Penny"],
  [/^(megaimage|mega)$/, "Consumabile", "Mega Image"],
  [/^(cumparaturi|consumabile|detergent|detergenti|hartie|cafea|sapun|sampon|saci|bureti)$/, "Consumabile", ""],
  [/^dedeman$/, "Dotări și reparații", "Dedeman"],
  [/^(leroymerlin|leroy)$/, "Dotări și reparații", "Leroy Merlin"],
  [/^hornbach$/, "Dotări și reparații", "Hornbach"],
  [/^ikea$/, "Dotări și reparații", "IKEA"],
  [/^jysk$/, "Dotări și reparații", "JYSK"],
  [/^emag$/, "Dotări și reparații", "eMAG"],
  [/^altex$/, "Dotări și reparații", "Altex"],
  [/^flanco$/, "Dotări și reparații", "Flanco"],
  [/^(mediagalaxy|galaxy)$/, "Dotări și reparații", "Media Galaxy"],
  [/^(dotari|reparatie|reparatii|bec|becuri|baterii|instalator|electrician|scule|mobilier)$/, "Dotări și reparații", ""],
  [/^(taxa|taxe|taxele|impozit|salvamont)$/, "Taxe locale", ""],
  [/^(altele|diverse)$/, "Altele", ""]
];

/* ============================== INSTALARE ============================== */

// O dată, din editor, după ce Worker-ul „a13-telegram” e publicat: cheia webhook-ului, webhook-ul, comenzile botului.
function finTgSetup() {
  if (!tgToken()) throw new Error("Lipsește " + TG_TOKEN_PROPERTY + " în Script Properties.");
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty(FIN_SS_PROP)) throw new Error("Lipsește " + FIN_SS_PROP + " (fișierul de cheltuieli, vezi finante.gs).");
  if (!p.getProperty(TG_CHAT_PROPERTY)) throw new Error("Lipsește " + TG_CHAT_PROPERTY + " (rulează întâi tgSetup).");
  if (!p.getProperty(FIN_TG_SECRET_PROP)) {
    p.setProperty(FIN_TG_SECRET_PROP, (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""));
  }
  tgApi("setWebhook", { url: FIN_TG_RELAY_URL, secret_token: p.getProperty(FIN_TG_SECRET_PROP),
                        allowed_updates: ["message", "callback_query"], max_connections: 5 });
  tgApi("setMyCommands", { commands: [
    { command: "luna", description: "Cheltuielile lunii (ex. /luna oct)" },
    { command: "lipsa", description: "Facturile lunare netrecute" },
    { command: "anuleaza", description: "Anulează ultima cheltuială trecută de aici" },
    { command: "ajutor", description: "Cum trimiți o cheltuială" }
  ] });
  finTgStatus();
  finTgSend("✅ <b>Cheltuielile pe Telegram sunt pornite.</b>\n\n" + finTgHelpText());
}

// Starea webhook-ului (fără cheie în log): adresa, câte mesaje așteaptă, ultima eroare.
function finTgStatus() {
  var i = tgApi("getWebhookInfo", {}).result || {};
  var line = "Webhook: " + (i.url || "(niciunul)") + " · în așteptare: " + (i.pending_update_count || 0);
  if (i.last_error_message) line += " · ultima eroare: " + i.last_error_message + " (" + new Date(i.last_error_date * 1000) + ")";
  console.log(line);
  return line;
}

// Oprește webhook-ul (botul nu mai citește mesajele; notificările pleacă în continuare).
function finTgStop() {
  tgApi("deleteWebhook", {});
  console.log("Webhook oprit.");
}

/* ============================== MESAJE PRIMITE ============================== */

// Din doPost (rezervari.gs): { tgRelay: 1, secret, update } trimis de Worker. Răspunsul e mereu același („ok”).
function finTgRelay(data) {
  var out = ContentService.createTextOutput("{\"ok\":true}").setMimeType(ContentService.MimeType.JSON);
  var props = PropertiesService.getScriptProperties();
  var expected = String(props.getProperty(FIN_TG_SECRET_PROP) || "");
  if (expected.length < 32 || String((data && data.secret) || "") !== expected) return out;
  var u = (data && data.update) || {};
  var cache = CacheService.getScriptCache();
  var key = "fin_tg_upd_" + u.update_id;
  if (cache.get(key)) return out;                        // Telegram a retrimis același mesaj
  cache.put(key, "1", FIN_TG_UNDO_TTL);
  var cb = u.callback_query, msg = u.message;
  var chat = cb ? (cb.message && cb.message.chat) : (msg && msg.chat);
  var owner = String(props.getProperty(TG_CHAT_PROPERTY) || "");
  if (!chat || !owner || String(chat.id) !== owner || chat.type !== "private") return out;

  var lock = LockService.getUserLock();
  if (!lock.tryLock(25000)) {
    finTgSend("Sunt ocupat cu altă cerere. Trimite din nou peste un minut.");
    return out;
  }
  try {
    if (cb) finTgCallback(cb);
    else if (msg) finTgMessage(msg);
  } catch (e) {
    console.error(e);
    try { finTgSend("⚠️ Nu am putut trece cheltuiala: " + tgEsc(tgClean(e)) + "\nÎncearcă din nou sau scrie direct în tabel."); } catch (e2) {}
  } finally {
    lock.releaseLock();
  }
  return out;
}

function finTgMessage(msg) {
  var text = String(msg.text || msg.caption || "").replace(/\s+/g, " ").trim();
  var photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : "";
  var now = finTgNow();

  var cmd = /^\/([a-z]+)(?:@\w+)?\s*(.*)$/i.exec(text);
  if (cmd) {
    finTgSetState(null);
    var c = cmd[1].toLowerCase();
    if (c === "luna") return finTgSend(finTgMonthText(finTgSheets(), finTgMonthArg(cmd[2], now)));
    if (c === "lipsa") return finTgSendMissing(finTgMissing(finTgSheets()), false);
    if (c === "anuleaza") return finTgUndoLast();
    return finTgSend(finTgHelpText());
  }

  var state = finTgGetState();
  if (state && state.type === "photo" && !photo) photo = state.fileId;
  if (state && (state.type === "fill" || state.type === "date") && text) {
    if (finTgAnswerState(state, text, now)) return;
  }
  if (!text) {
    if (photo) {
      finTgSetState({ type: "photo", fileId: photo });
      return finTgSend("Am primit poza. Scrie acum ce e și suma, de exemplu <code>dm 168,55</code>.");
    }
    return;
  }

  var p = finTgParse(text, now);
  if (p.amount == null) {
    return finTgSend("Nu am găsit suma. Scrie de exemplu <code>spălătorie 231,26</code> sau /ajutor.");
  }
  p.photo = photo;
  finTgSetState(null);
  if (!p.category) {
    finTgSetState({ type: "cat", draft: finTgDraftOut(p) });
    return finTgSend("Ce categorie are <b>" + finTgLei(p.amount) + "</b>" + (p.note ? " (" + tgEsc(p.note) + ")" : "") + "?",
                     finTgCategoryKeyboard(finTgSheets(), "nc"));
  }
  finTgSave(finTgSheets(), p, now);
}

// Răspunsul la o întrebare a botului (suma unei facturi lunare / data unei cheltuieli). false = nu era un răspuns.
function finTgAnswerState(state, text, now) {
  var S = finTgSheets();
  var row = finTgRowIfSame(S, state.row, state.hash);
  if (!row) {
    finTgSetState(null);
    finTgSend("Rândul s-a mutat în tabel între timp. Modifică-l direct acolo.");
    return true;
  }
  var p = finTgParse(text, now, state.type === "date");
  if (state.type === "fill") {
    if (p.amount == null) return false;
    if (p.category && p.category !== row.cat) return false;           // e o cheltuială nouă, nu suma cerută
    finTgSetState(null);
    var prev = [row.vendor, row.amount, row.note, row.bon];
    S.ch.getRange(row.row, 4).setValue(p.amount);
    if (!row.vendor && p.vendor) S.ch.getRange(row.row, 3).setValue(p.vendor);
    if (!row.note && p.note) S.ch.getRange(row.row, 6).setValue(p.note);
    var r1 = finTgReadRow(S, row.row);
    finTgRemember(r1, { type: "fill", prev: prev });
    finTgSend(finTgConfirmText(S, r1, true, now), finTgRowKeyboard(r1));
    return true;
  }
  if (state.type === "date") {
    if (!p.dateExplicit && !p.monthOnly) {
      if (p.amount != null && p.category) { finTgSetState(null); return false; }   // e o cheltuială nouă
      finTgSend("Nu am înțeles data. Scrie de exemplu <code>03.11</code>, <code>ieri</code> sau <code>oct</code>.");
      return true;
    }
    finTgSetState(null);
    var undo = finTgRecall(row);
    S.ch.getRange(row.row, 1).setValue(p.date);
    var r2 = finTgReadRow(S, row.row);
    finTgRemember(r2, undo || { type: "edit" });
    finTgSend(finTgConfirmText(S, r2, false, now), finTgRowKeyboard(r2));
    return true;
  }
  return false;
}

/* ============================== BUTOANE ============================== */

function finTgCallback(cb) {
  var data = String(cb.data || ""), now = finTgNow();
  var m = /^([a-z]+):?(.*)$/.exec(data) || [];
  var kind = m[1], parts = String(m[2] || "").split(":");
  var chatId = cb.message && cb.message.chat && cb.message.chat.id, msgId = cb.message && cb.message.message_id;
  var S = finTgSheets();

  if (kind === "nc" || kind === "pk") {                        // categoria / rândul pentru o cheltuială încă nescrisă
    var state = finTgGetState();
    if (!state || !state.draft) return finTgAnswer(cb.id, "Cererea a expirat. Trimite din nou cheltuiala.");
    var p = finTgDraftIn(state.draft);
    if (kind === "nc") {
      var cat = S.cats[Number(parts[0])];
      if (!cat) return finTgAnswer(cb.id, "Categorie necunoscută.");
      p.category = cat.name;
    }
    finTgSetState(null);
    finTgAnswer(cb.id, "");
    if (kind === "pk") {
      if (parts[0] === "new") p.forceNew = true;
      else {
        var target = finTgRowIfSame(S, Number(parts[0]), parts[1]);
        if (!target) return finTgSend("Rândul s-a mutat în tabel între timp. Trimite din nou cheltuiala.");
        p.target = target;
      }
    }
    return finTgSave(S, p, now, chatId, msgId);
  }

  var row = finTgRowIfSame(S, Number(parts[0]), parts[1]);
  if (!row) return finTgAnswer(cb.id, "Rândul s-a mutat sau a fost șters în tabel. Modifică direct acolo.");

  if (kind === "c") {                                          // alege altă categorie
    finTgAnswer(cb.id, "");
    return finTgEdit(chatId, msgId, finTgConfirmText(S, row, false, now) + "\n\nAlege categoria:",
                     finTgCategoryKeyboard(S, "sc:" + row.row + ":" + row.hash));
  }
  if (kind === "sc") {
    var c2 = S.cats[Number(parts[2])];
    if (!c2) return finTgAnswer(cb.id, "Categorie necunoscută.");
    var undo = finTgRecall(row);
    S.ch.getRange(row.row, 2).setValue(c2.name);
    var r2 = finTgReadRow(S, row.row);
    finTgRemember(r2, undo || { type: "edit" });
    finTgAnswer(cb.id, "Categoria: " + c2.name);
    return finTgEdit(chatId, msgId, finTgConfirmText(S, r2, false, now), finTgRowKeyboard(r2));
  }
  if (kind === "d") {                                          // altă dată: următorul mesaj e data
    finTgSetState({ type: "date", row: row.row, hash: row.hash });
    finTgAnswer(cb.id, "");
    return finTgSend("Ce dată are cheltuiala? Scrie de exemplu <code>03.11</code>, <code>ieri</code> sau <code>oct</code>.");
  }
  if (kind === "x") {
    finTgAnswer(cb.id, "");
    var res = finTgUndo(S, row);
    return finTgEdit(chatId, msgId, res, null);
  }
  if (kind === "f") {                                          // completează o factură lunară: următorul mesaj e suma
    finTgSetState({ type: "fill", row: row.row, hash: row.hash });
    finTgAnswer(cb.id, "");
    return finTgSend("Ce sumă are <b>" + tgEsc(row.cat) + "</b> pe " + finTgMonthName(row.date) + "?");
  }
  finTgAnswer(cb.id, "");
}

/* ============================== SCRIEREA ÎN TABEL ============================== */

// Scrie cheltuiala (rând nou sau factura lunară galbenă) și răspunde. p = rezultatul lui finTgParse (+ photo, target).
function finTgSave(S, p, now, editChatId, editMsgId) {
  var fixed = finTgIsFixed(S, p.category);
  var target = p.target || null;
  if (fixed && !target && !p.forceNew) {
    var holes = finTgMissing(S).filter(function (r) { return r.cat === p.category; });
    if (p.dateExplicit || p.monthOnly) {
      target = holes.filter(function (r) { return finTgYm(r.date) === finTgYm(p.date); })[0] || null;
    } else if (holes.length === 1) {
      target = holes[0];
    } else if (holes.length > 1) {
      finTgSetState({ type: "pick", draft: finTgDraftOut(p) });
      var kb = holes.slice(0, 8).map(function (r) { return [{ text: finTgMonthName(r.date), callback_data: "pk:" + r.row + ":" + r.hash }]; });
      kb.push([{ text: "Rând nou, separat", callback_data: "pk:new" }]);
      return finTgSend("<b>" + tgEsc(p.category) + "</b> · " + finTgLei(p.amount) + ": pentru ce lună?", kb);
    }
  }

  var r;
  if (target) {
    var prev = [target.vendor, target.amount, target.note, target.bon];
    S.ch.getRange(target.row, 3, 1, 4).setValues([[target.vendor || p.vendor, p.amount, target.sejur, target.note || p.note]]);
    if (p.photo) finTgPhoto(S, target.row, p.photo);
    r = finTgReadRow(S, target.row);
    finTgRemember(r, { type: "fill", prev: prev });
  } else {
    var date = p.date;
    if (fixed && !p.dateExplicit && !p.monthOnly) date = finTgDate(finTgYm(now) + "-01");   // facturile lunare: ziua 1
    var at = finTgLastRow(S) + 1;
    S.ch.getRange(at, 1, 1, 7).setValues([[date, p.category, p.vendor, p.amount, "", p.note, ""]]);
    if (p.photo) finTgPhoto(S, at, p.photo);
    r = finTgReadRow(S, at);
    finTgRemember(r, { type: "new" });
  }
  var text = finTgConfirmText(S, r, !!target, now);
  if (editChatId && editMsgId) return finTgEdit(editChatId, editMsgId, text, finTgRowKeyboard(r));
  return finTgSend(text, finTgRowKeyboard(r));
}

function finTgPhoto(S, row, fileId) {
  S.ch.getRange(row, 7).setValue("foto Telegram").setNote("Poza bonului e în chatul Telegram cu botul (file_id: " + fileId + ").");
}

// Anulare: rândul nou se șterge; factura lunară revine la ce era (galbenă, fără sumă).
function finTgUndo(S, row) {
  var undo = finTgRecall(row);
  if (!undo || undo.type === "edit") return "Nu mai pot anula automat (a trecut prea mult timp). Modifică direct în tabel.";
  if (undo.type === "new") {
    S.ch.deleteRow(row.row);
    finTgForget(row);
    return "↩️ Anulat: " + tgEsc(row.cat) + " · " + finTgLei(row.amount) + " (rândul a fost șters).";
  }
  var prev = undo.prev || [];
  S.ch.getRange(row.row, 3, 1, 4).setValues([[prev[0] || "", prev[1] === undefined ? "" : prev[1], row.sejur, prev[2] || ""]]);
  if (!prev[3]) S.ch.getRange(row.row, 7).setValue("").setNote("");
  finTgForget(row);
  return "↩️ Anulat: " + tgEsc(row.cat) + " pe " + finTgMonthName(row.date) + " e din nou de completat.";
}

function finTgUndoLast() {
  var last = finTgCacheGet("fin_tg_last");
  if (!last) return finTgSend("Nu am ce anula: nicio cheltuială trecută de aici în ultimele 6 ore.");
  var S = finTgSheets();
  var row = finTgRowIfSame(S, last.row, last.hash);
  if (!row) return finTgSend("Ultima cheltuială s-a modificat sau s-a mutat în tabel. Modifică direct acolo.");
  finTgSend(finTgUndo(S, row));
}

/* ============================== FACTURILE LUNARE ============================== */

// Din checkinSync (la 10 minute). Pe 1 ale lunii: rândurile galbene pentru facturile lunare. Din ziua 5, după 08:00:
// lista celor lipsă, o dată pe lună. Fără fișierul de cheltuieli (FIN_SS_ID) nu face nimic.
function finMonthly() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty(FIN_SS_PROP)) return;
  var now = finTgNow(), ym = finTgYm(now);
  var day = Number(Utilities.formatDate(now, FIN_TZ, "d")), hour = Number(Utilities.formatDate(now, FIN_TZ, "H"));
  var needBills = p.getProperty(FIN_TG_BILLS_PROP) !== ym;
  var needRemind = p.getProperty(FIN_TG_REMIND_PROP) !== ym && day >= FIN_TG_REMIND_DAY && hour >= FIN_TG_REMIND_HOUR;
  if (!needBills && !needRemind) return;
  var lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) return;
  try {
    var S = finTgSheets();
    if (needBills) {
      var made = finTgCreateBills(S, ym);
      p.setProperty(FIN_TG_BILLS_PROP, ym);
      if (made.length) console.log("Facturi lunare create pentru " + ym + ": " + made.join(", "));
    }
    if (needRemind) {
      var missing = finTgMissing(S);
      if (missing.length && tgReady()) finTgSendMissing(missing, true);
      p.setProperty(FIN_TG_REMIND_PROP, ym);
    }
  } finally {
    lock.releaseLock();
  }
}

function finTgCreateBills(S, ym) {
  var rows = finTgRows(S), made = [], at = finTgLastRow(S) + 1;
  S.cats.filter(function (c) { return c.fixed; }).forEach(function (c) {
    var mine = rows.filter(function (r) { return r.cat === c.name; });
    if (mine.some(function (r) { return finTgYm(r.date) === ym; })) return;
    var vendor = mine.length ? mine[mine.length - 1].vendor : "";
    S.ch.getRange(at, 1, 1, 7).setValues([[finTgDate(ym + "-01"), c.name, vendor, "", "", "", ""]]);
    at++;
    made.push(c.name);
  });
  return made;
}

// Facturile lunare fără sumă, până în luna curentă inclusiv (cele din viitor nu contează).
function finTgMissing(S) {
  var ym = finTgYm(finTgNow());
  return finTgRows(S).filter(function (r) {
    return r.amount === "" && finTgIsFixed(S, r.cat) && finTgYm(r.date) <= ym;
  });
}

function finTgSendMissing(missing, reminder) {
  if (!missing.length) return finTgSend("✅ Toate facturile lunare sunt trecute.");
  var lines = missing.map(function (r) { return "• " + tgEsc(r.cat) + " · " + finTgMonthName(r.date); });
  var kb = missing.slice(0, 10).map(function (r) {
    return [{ text: r.cat.split(" ")[0].replace("/TV", "") + " · " + finTgMonthName(r.date), callback_data: "f:" + r.row + ":" + r.hash }];
  });
  return finTgSend((reminder ? "🧾 <b>Facturi lunare de trecut</b>\n" : "🧾 <b>Lipsesc " + missing.length + " facturi lunare</b>\n") +
                   lines.join("\n") + "\n\nAtinge una și scrie suma.", kb, reminder);
}

/* ============================== TEXTE ============================== */

function finTgHelpText() {
  return "Scrie o cheltuială pe un rând: ce, cât și, dacă vrei, când. De exemplu:\n" +
    "• <code>spălătorie 231,26</code>\n• <code>dm 168,55</code>\n• <code>întreținere 1.020,40 oct</code>\n• <code>dedeman 269,67 ieri</code>\n\n" +
    "Poți trimite și poza bonului, cu textul ca descriere. Botul răspunde cu ce a înțeles; dacă a greșit, apeși " +
    "Altă categorie, Altă dată sau Anulează.\n\n/luna · totalul lunii (sau /luna oct)\n/lipsa · facturile lunare netrecute\n" +
    "/anuleaza · anulează ultima cheltuială trecută de aici";
}

function finTgConfirmText(S, r, filled, now) {
  var head = "✅ " + (filled ? "Completat" : "Trecut") + ": <b>" + tgEsc(r.cat) + "</b>" + (r.vendor ? " · " + tgEsc(r.vendor) : "") +
             " · " + finTgLei(r.amount) + " · " + (filled || finTgIsFixed(S, r.cat) && finTgDay(r.date) === 1 ? finTgMonthName(r.date) : finTgDateLabel(r.date, now));
  var lines = [head];
  if (r.note) lines.push(tgEsc(r.note));
  var ym = finTgYm(r.date);
  var total = finTgRows(S).filter(function (x) { return finTgYm(x.date) === ym && typeof x.amount === "number"; })
    .reduce(function (a, x) { return a + x.amount; }, 0);
  lines.push(finTgCap(finTgMonthName(r.date)) + " până acum: " + finTgLei(total));
  var others = finTgMissing(S).filter(function (x) { return x.row !== r.row; });
  if (filled && others.length) {
    lines.push("Mai lipsesc: " + others.map(function (x) { return x.cat + " (" + finTgMonthName(x.date) + ")"; }).join(", "));
  }
  return lines.join("\n");
}

function finTgMonthText(S, ym) {
  var rows = finTgRows(S).filter(function (r) { return finTgYm(r.date) === ym; });
  var name = finTgCap(FIN_TG_MONTHS[Number(ym.slice(5, 7)) - 1]) + " " + ym.slice(0, 4);
  var total = 0, byCat = {}, missing = [];
  rows.forEach(function (r) {
    if (typeof r.amount === "number") { total += r.amount; byCat[r.cat] = (byCat[r.cat] || 0) + r.amount; }
    else if (finTgIsFixed(S, r.cat)) missing.push(r.cat);
  });
  var lines = ["📊 <b>" + tgEsc(name) + "</b>", "Cheltuieli: <b>" + finTgLei(total) + "</b>"];
  S.cats.forEach(function (c) {
    if (byCat[c.name]) lines.push("• " + tgEsc(c.name) + ": " + finTgLei(byCat[c.name]));
  });
  if (missing.length) lines.push("De completat: " + tgEsc(missing.join(", ")));
  var inc = finTgIncome(S, ym);
  if (inc.nights) lines.push("Încasat după comision: " + finTgLei(inc.net) + " (" + inc.nights + (inc.nights === 1 ? " noapte" : " nopți") +
                             ") · rezultat: " + finTgLei(inc.net - total));
  else lines.push("Niciun sejur încheiat în luna asta.");
  return lines.join("\n");
}

// Sejururile încheiate (plecarea) în luna dată: suma rămasă după comision + nopțile (ca în foaia Lunar).
function finTgIncome(S, ym) {
  var last = S.sej.getLastRow(), out = { net: 0, nights: 0 };
  if (last < 4) return out;
  S.sej.getRange(4, 1, last - 3, 10).getValues().forEach(function (v) {
    if (!(v[3] instanceof Date) || finTgYm(v[3]) !== ym) return;
    if (typeof v[9] === "number") out.net += v[9];
    if (typeof v[4] === "number") out.nights += v[4];
  });
  return out;
}

function finTgMonthArg(arg, now) {
  var a = finTgNorm(arg || "").trim();
  if (!a) return finTgYm(now);
  var m = /^(\d{4})-(\d{1,2})$/.exec(a) || null, y, mo;
  if (m) { y = Number(m[1]); mo = Number(m[2]); }
  else if ((m = /^(\d{1,2})(?:[.\/](\d{4}))?$/.exec(a))) { mo = Number(m[1]); y = m[2] ? Number(m[2]) : 0; }
  else {
    var parts = a.split(" ");
    mo = finTgMonthWord(parts[0]);
    y = /^\d{4}$/.test(parts[1] || "") ? Number(parts[1]) : 0;
  }
  if (!mo || mo > 12) return finTgYm(now);
  if (!y) {
    y = Number(finTgYm(now).slice(0, 4));
    if (mo > Number(finTgYm(now).slice(5, 7))) y--;
  }
  return y + "-" + (mo < 10 ? "0" : "") + mo;
}

/* ============================== ÎNȚELEGEREA MESAJULUI ============================== */

// „întreținere 1.020,40 oct” → { amount: 1020.4, category, vendor, date, dateExplicit, monthOnly, note }
// expectDate: botul a cerut o dată, deci „03.11” singur e data (altfel ar fi suma 3,11 lei).
function finTgParse(text, now, expectDate) {
  // Numele de magazine din două cuvinte se lipesc înainte de împărțire, ca textul original și cel normalizat să aibă
  // aceleași cuvinte (nota păstrează diacriticele).
  var raw = String(text || "").replace(/\s+/g, " ").trim()
    .replace(/media galaxy/ig, "MediaGalaxy").replace(/leroy merlin/ig, "LeroyMerlin").replace(/mega image/ig, "MegaImage");
  var rawTokens = raw.split(" ");
  var tokens = finTgNorm(raw).split(" ");
  var used = [], amounts = [], dmCandidates = [], out = { amount: null, category: "", vendor: "", date: null,
    dateExplicit: false, monthOnly: false, note: "" };
  var today = finTgYmd(now), dateYmd = null, month = 0, year = 0;

  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i].replace(/^[(\[]+|[)\],;:!?]+$/g, "");
    var mm;
    if (!t) { used[i] = true; continue; }
    if (/^(lei|ron)$/.test(t)) { used[i] = true; if (amounts.length) amounts[amounts.length - 1].lei = true; continue; }
    if (/^(azi|astazi)$/.test(t)) { dateYmd = today; used[i] = true; continue; }
    if (t === "ieri") { dateYmd = finTgShift(today, -1); used[i] = true; continue; }
    if (t === "alaltaieri") { dateYmd = finTgShift(today, -2); used[i] = true; continue; }
    if ((mm = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2}|\d{4})$/.exec(t))) {
      var y4 = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
      var full = finTgValidYmd(y4, Number(mm[2]), Number(mm[1]));
      if (full) { dateYmd = full; used[i] = true; continue; }
    }
    if ((mm = /^(\d{1,2})[.\/](\d{1,2})$/.exec(t)) && Number(mm[1]) >= 1 && Number(mm[1]) <= 31 && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) {
      dmCandidates.push({ i: i, d: Number(mm[1]), m: Number(mm[2]) });
    }
    var mw = finTgMonthWord(t);
    if (mw && (t !== "mai" || /^\d{4}$/.test(tokens[i + 1] || "") || tokens[i - 1] === "luna")) {
      month = mw; used[i] = true;
      if (/^\d{4}$/.test(tokens[i + 1] || "")) { year = Number(tokens[i + 1]); used[i + 1] = true; i++; }
      continue;
    }
    if (t === "luna" && finTgMonthWord(tokens[i + 1] || "")) { used[i] = true; continue; }
    var amt = finTgAmount(t);
    if (amt) { amounts.push({ i: i, value: amt.value, decimals: amt.decimals, lei: /lei$|ron$/.test(t) }); continue; }
    if (!out.category) {
      for (var k = 0; k < FIN_TG_KEYWORDS.length; k++) {
        if (FIN_TG_KEYWORDS[k][0].test(t)) {
          out.category = FIN_TG_KEYWORDS[k][1];
          out.vendor = FIN_TG_KEYWORDS[k][2];
          used[i] = true;
          break;
        }
      }
      if (used[i]) continue;
    } else {
      for (var k2 = 0; k2 < FIN_TG_KEYWORDS.length; k2++) {   // același fel, a doua oară: „consumabile dm 50”, „dm consumabile 50”
        if (FIN_TG_KEYWORDS[k2][1] === out.category && FIN_TG_KEYWORDS[k2][0].test(t)) {
          if (FIN_TG_KEYWORDS[k2][2] && !out.vendor) out.vendor = FIN_TG_KEYWORDS[k2][2];
          used[i] = true;
          break;
        }
      }
      if (used[i]) continue;
    }
  }

  // „3.11” e dată doar dacă mai există și o sumă; altfel e suma (3,11 lei).
  var nonDate = amounts.filter(function (a) { return !dmCandidates.some(function (c) { return c.i === a.i; }); });
  if ((nonDate.length || expectDate) && dmCandidates.length && !dateYmd) {
    var c0 = dmCandidates[0];
    var y0 = Number(today.slice(0, 4));
    if (c0.m > Number(today.slice(5, 7))) y0--;
    dateYmd = finTgValidYmd(y0, c0.m, c0.d);
    if (dateYmd) used[c0.i] = true;
    amounts = nonDate;
  }
  if (amounts.length) {
    var pick = amounts.filter(function (a) { return a.lei; })[0] || amounts.filter(function (a) { return a.decimals; })[0] ||
      amounts.slice().sort(function (a, b) { return b.value - a.value; })[0];
    if (pick.value > 0 && pick.value <= FIN_TG_MAX_AMOUNT) { out.amount = pick.value; used[pick.i] = true; }
  }

  if (dateYmd) { out.date = finTgDate(dateYmd); out.dateExplicit = true; }
  else if (month) {
    if (!year) { year = Number(today.slice(0, 4)); if (month > Number(today.slice(5, 7))) year--; }
    out.date = finTgDate(year + "-" + (month < 10 ? "0" : "") + month + "-01");
    out.monthOnly = true;
  } else out.date = finTgDate(today);

  var note = [];
  for (var j = 0; j < rawTokens.length; j++) if (!used[j]) note.push(rawTokens[j]);
  out.note = note.join(" ").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "");
  return out;
}

// „231,26” → 231.26 · „1.020,40” → 1020.4 · „1.020” → 1020 · „1020.4” → 1020.4 · „168,55lei” → 168.55
function finTgAmount(s) {
  s = String(s || "").replace(/(lei|ron)$/, "");
  if (!/^\d(?:[\d.,]*\d)?$/.test(s)) return null;
  var dot = s.lastIndexOf("."), comma = s.lastIndexOf(","), dec = "";
  if (dot >= 0 && comma >= 0) dec = dot > comma ? "." : ",";
  else if (comma >= 0) dec = s.split(",").length === 2 && /,\d{1,2}$/.test(s) ? "," : "";
  else if (dot >= 0) dec = s.split(".").length === 2 && !/\.\d{3}$/.test(s) ? "." : "";
  var intPart = s, frac = "";
  if (dec) { intPart = s.slice(0, s.lastIndexOf(dec)); frac = s.slice(s.lastIndexOf(dec) + 1); }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart) || (frac && !/^\d{1,2}$/.test(frac))) return null;
  return { value: Math.round(Number(intPart + (frac ? "." + frac : "")) * 100) / 100, decimals: !!frac };
}

function finTgMonthWord(t) {
  for (var i = 0; i < FIN_TG_MONTH_WORDS.length; i++) if (FIN_TG_MONTH_WORDS[i].indexOf(t) >= 0) return i + 1;
  return 0;
}

function finTgNorm(s) {
  return String(s || "").toLowerCase().replace(/[ăâ]/g, "a").replace(/î/g, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
}

/* ============================== FOAIA ============================== */

function finTgSheets() {
  var ss = finSpreadsheet();
  var set = ss.getSheetByName("Setări");
  var cats = set.getRange("A4:B30").getValues().filter(function (r) { return String(r[0]).trim() !== ""; })
    .map(function (r) { return { name: String(r[0]).trim(), fixed: String(r[1]).trim() === "Fixă lunară" }; });
  return { ss: ss, ch: ss.getSheetByName("Cheltuieli"), sej: ss.getSheetByName("Sejururi"), cats: cats };
}

function finTgIsFixed(S, cat) {
  return S.cats.some(function (c) { return c.name === cat && c.fixed; });
}

// Rândurile cu dată din Cheltuieli: { row, date, cat, vendor, amount ("" = fără sumă), sejur, note, bon, hash }
function finTgRows(S) {
  var last = S.ch.getLastRow();
  if (last < 4) return [];
  var v = S.ch.getRange(4, 1, last - 3, 7).getValues(), out = [];
  for (var i = 0; i < v.length; i++) if (v[i][0] instanceof Date) out.push(finTgRowObj(4 + i, v[i]));
  return out;
}

function finTgRowObj(row, v) {
  var o = { row: row, date: v[0], cat: String(v[1] || ""), vendor: String(v[2] || ""), amount: v[3] === "" || v[3] == null ? "" : v[3],
            sejur: v[4] == null ? "" : v[4], note: String(v[5] || ""), bon: String(v[6] || "") };
  o.hash = finTgHash([v[0] instanceof Date ? finTgYmd(v[0]) : String(v[0]), o.cat, String(o.amount)].join("|"));
  return o;
}

function finTgReadRow(S, row) {
  return finTgRowObj(row, S.ch.getRange(row, 1, 1, 7).getValues()[0]);
}

// Rândul, doar dacă are încă aceeași dată, categorie și sumă ca atunci când a plecat butonul (altfel null).
function finTgRowIfSame(S, row, hash) {
  if (!(row >= 4) || row > S.ch.getLastRow()) return null;
  var r = finTgReadRow(S, row);
  return r.date instanceof Date && r.hash === String(hash) ? r : null;
}

function finTgLastRow(S) {
  var last = S.ch.getLastRow();
  if (last < 4) return 3;
  var v = S.ch.getRange(4, 1, last - 3, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (v[i][0] !== "" && v[i][0] != null) return 4 + i;
  return 3;
}

/* ============================== TELEGRAM ============================== */

// keyboard: rânduri de butoane [{ text, callback_data }]. sound = cu notificare (implicit fără).
function finTgSend(html, keyboard, sound) {
  var payload = { chat_id: PropertiesService.getScriptProperties().getProperty(TG_CHAT_PROPERTY), text: html,
                  parse_mode: "HTML", disable_web_page_preview: true, disable_notification: !sound };
  if (keyboard && keyboard.length) payload.reply_markup = { inline_keyboard: keyboard };
  return tgApi("sendMessage", payload);
}

function finTgEdit(chatId, messageId, html, keyboard) {
  var payload = { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", disable_web_page_preview: true,
                  reply_markup: { inline_keyboard: keyboard && keyboard.length ? keyboard : [] } };
  try { return tgApi("editMessageText", payload); }
  catch (e) { if (!/not modified/.test(String(e.message))) return finTgSend(html, keyboard); }
}

function finTgAnswer(id, text) {
  try { tgApi("answerCallbackQuery", { callback_query_id: id, text: text || "" }); } catch (e) {}
}

function finTgRowKeyboard(r) {
  var id = r.row + ":" + r.hash;
  return [[{ text: "Altă categorie", callback_data: "c:" + id }, { text: "Altă dată", callback_data: "d:" + id },
           { text: "Anulează", callback_data: "x:" + id }]];
}

function finTgCategoryKeyboard(S, prefix) {
  var kb = [];
  S.cats.forEach(function (c, i) {
    var b = { text: c.name, callback_data: prefix + ":" + i };
    if (kb.length && kb[kb.length - 1].length < 2) kb[kb.length - 1].push(b); else kb.push([b]);
  });
  return kb;
}

/* ============================== STARE (cache) ============================== */

function finTgCacheGet(key) {
  var v = CacheService.getScriptCache().get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function finTgGetState() { return finTgCacheGet("fin_tg_state"); }

function finTgSetState(st) {
  var c = CacheService.getScriptCache();
  if (st) c.put("fin_tg_state", JSON.stringify(st), FIN_TG_STATE_TTL); else c.remove("fin_tg_state");
}

function finTgRemember(r, undo) {
  var c = CacheService.getScriptCache();
  c.put("fin_tg_undo_" + r.row + "_" + r.hash, JSON.stringify(undo), FIN_TG_UNDO_TTL);
  c.put("fin_tg_last", JSON.stringify({ row: r.row, hash: r.hash }), FIN_TG_UNDO_TTL);
}

function finTgRecall(r) { return finTgCacheGet("fin_tg_undo_" + r.row + "_" + r.hash); }

function finTgForget(r) {
  var c = CacheService.getScriptCache();
  c.remove("fin_tg_undo_" + r.row + "_" + r.hash);
  var last = finTgCacheGet("fin_tg_last");
  if (last && last.row === r.row) c.remove("fin_tg_last");
}

function finTgDraftOut(p) {
  return { amount: p.amount, category: p.category, vendor: p.vendor, date: finTgYmd(p.date), dateExplicit: p.dateExplicit,
           monthOnly: p.monthOnly, note: p.note, photo: p.photo || "" };
}

function finTgDraftIn(d) {
  return { amount: d.amount, category: d.category, vendor: d.vendor, date: finTgDate(d.date), dateExplicit: d.dateExplicit,
           monthOnly: d.monthOnly, note: d.note, photo: d.photo };
}

/* ============================== DATE ȘI SUME ============================== */

function finTgNow() { return new Date(); }

function finTgYmd(d) { return Utilities.formatDate(d, FIN_TZ, "yyyy-MM-dd"); }
function finTgYm(d) { return Utilities.formatDate(d, FIN_TZ, "yyyy-MM"); }
function finTgDay(d) { return Number(Utilities.formatDate(d, FIN_TZ, "d")); }
function finTgDate(ymd) { return Utilities.parseDate(ymd, FIN_TZ, "yyyy-MM-dd"); }

function finTgValidYmd(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
}

function finTgShift(ymd, days) {
  var p = ymd.split("-").map(Number), t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return finTgValidYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function finTgMonthName(d) { return FIN_TG_MONTHS[Number(Utilities.formatDate(d, FIN_TZ, "M")) - 1]; }

function finTgDateLabel(d, now) {
  var ymd = finTgYmd(d), today = finTgYmd(now), short = Utilities.formatDate(d, FIN_TZ, "dd.MM");
  if (ymd === today) return "azi, " + short;
  if (ymd === finTgShift(today, -1)) return "ieri, " + short;
  return Utilities.formatDate(d, FIN_TZ, "dd.MM.yyyy");
}

function finTgCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// 1020.4 → „1.020,40 lei” · 200 → „200 lei”
function finTgLei(n) {
  if (typeof n !== "number") return "fără sumă";
  var neg = n < 0, v = Math.round(Math.abs(n) * 100) / 100;
  var whole = String(Math.floor(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  var cents = Math.round((v - Math.floor(v)) * 100);
  return (neg ? "-" : "") + whole + (cents ? "," + (cents < 10 ? "0" : "") + cents : "") + " lei";
}

function finTgHash(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
