/**
 * A13 Travel Concept — legătura cu yala TTLock (Google Apps Script), Faza 2.
 *
 * Yala ușii apartamentului e administrată din aplicația TTLock, cu gateway Wi-Fi în apartament, deci codurile
 * se pot pune și șterge din cloud (TTLock Open Platform, serverul EU: euapi.ttlock.com).
 *   Pasul 1 — legătura, doar citire: ttlockSetup / ttlockTest (yalele, gateway-ul, câte coduri există).
 *   Pasul 2 — cod de test, MODIFICĂ yala, doar la cerere: ttlockCodTest (6 cifre, valabil o oră) și
 *             ttlockStergeCodTest. ttlAddCode / ttlDeleteCode sunt aceleași funcții pe care le va folosi check-in-ul.
 *
 * Datele de acces stau DOAR în Script Properties (Project Settings → Script Properties), niciodată în cod:
 *   TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET — aplicația aprobată pe euopen.ttlock.com (Management → aplicația)
 *   TTLOCK_USERNAME                        — contul din aplicația TTLock (telefonul sau e-mailul de logare)
 *   TTLOCK_PASSWORD                        — parola contului; ttlockSetup o păstrează doar ca MD5
 *                                            (TTLOCK_PASSWORD_MD5) și o șterge pe cea în clar
 * Tokenul (valabil 90 de zile) se păstrează tot acolo (TTLOCK_ACCESS_TOKEN / _REFRESH_TOKEN / _TOKEN_EXPIRES)
 * și se reînnoiește singur cu o săptămână înainte să expire.
 * Același proiect cu rezervari.gs și checkin.gs: numele globale de aici încep cu TTL_ / ttl. Motor vechi (Rhino) → ES5.
 */

var TTL_API = "https://euapi.ttlock.com";
var TTL_RENEW_BEFORE_MS = 7 * 86400000;   // reînnoiește tokenul cu 7 zile înainte de expirare

/* ============================== PUNCTE DE INTRARE ============================== */

// O singură dată, după ce ai pus datele în Script Properties: transformă parola în MD5, cere un token nou
// și rulează testul de citire.
function ttlockSetup() {
  var p = PropertiesService.getScriptProperties();
  var plain = p.getProperty("TTLOCK_PASSWORD");
  if (plain) {
    p.setProperty("TTLOCK_PASSWORD_MD5", ttlMd5(plain));
    p.deleteProperty("TTLOCK_PASSWORD");
    console.log("Parola TTLock e păstrată acum doar ca MD5 (TTLOCK_PASSWORD_MD5).");
  }
  ["TTLOCK_ACCESS_TOKEN", "TTLOCK_REFRESH_TOKEN", "TTLOCK_TOKEN_EXPIRES"].forEach(function (k) { p.deleteProperty(k); });
  ttlockTest();
}

// Test doar-citire: yalele contului, gateway, versiunea de coduri, bateria și câte coduri are fiecare yală.
// Codurile în sine și numele lor (pot conține nume de oaspeți) NU se afișează.
function ttlockTest() {
  var locks = ttlCall("/v3/lock/list", { pageNo: 1, pageSize: 20 }).list || [];
  console.log("Yale în cont: " + locks.length);
  locks.forEach(function (l) {
    var codes = ttlCall("/v3/lock/listKeyboardPwd", { lockId: l.lockId, pageNo: 1, pageSize: 100 }).list || [];
    var now = Date.now();
    var active = codes.filter(function (c) { return !c.endDate || c.endDate > now; }).length;
    console.log("lockId " + l.lockId + " · „" + (l.lockAlias || l.lockName) + "” · gateway: " + (l.hasGateway ? "da" : "NU") +
                " · versiune coduri: " + l.keyboardPwdVersion + " · baterie: " + l.electricQuantity + "%" +
                " · coduri: " + codes.length + " (" + active + " încă valabile)");
  });
}

// Diagnostic la eroarea 10007 („invalid account or invalid password”): încearcă tokenul pe serverul EU și pe cel
// global și spune ce fel de nume de utilizator e salvat. Afișează doar codurile de răspuns, nimic secret.
function ttlockDiagnoza() {
  var p = PropertiesService.getScriptProperties();
  var plain = p.getProperty("TTLOCK_PASSWORD");
  var md5 = plain ? ttlMd5(plain) : ttlProp("TTLOCK_PASSWORD_MD5");
  ["https://euapi.ttlock.com", "https://api.ttlock.com"].forEach(function (base) {
    var res = UrlFetchApp.fetch(base + "/oauth2/token", { method: "post", muteHttpExceptions: true, payload: {
      client_id: ttlProp("TTLOCK_CLIENT_ID"), client_secret: ttlProp("TTLOCK_CLIENT_SECRET"),
      username: ttlProp("TTLOCK_USERNAME"), password: md5 } });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    console.log(base + ": HTTP " + res.getResponseCode() + " · " +
                (body.access_token ? "token OK" : (body.errcode || "") + " " + (body.errmsg || body.description || "")));
  });
  var u = ttlProp("TTLOCK_USERNAME");
  console.log("TTLOCK_USERNAME e " + (u.indexOf("@") > 0 ? "o adresă de e-mail" : /^\+?\d+$/.test(u) ?
              "un telefon " + (u.charAt(0) === "+" ? "cu prefix +" : "fără prefix +") : "în alt format") +
              ", " + u.length + " caractere; parola folosită: " + (plain ? "TTLOCK_PASSWORD (nouă)" : "MD5-ul salvat"));
}

/* ============================== CODURI ============================== */

// Test (cu acordul lui Mircea): pune pe yală un cod nou de 6 cifre, valabil o oră, prin gateway, și îl afișează.
// Se șterge cu ttlockStergeCodTest; oricum nu mai deschide după o oră.
function ttlockCodTest() {
  var lockId = ttlLockId();
  var existing = (ttlCall("/v3/lock/listKeyboardPwd", { lockId: lockId, pageNo: 1, pageSize: 100 }).list || [])
    .map(function (c) { return String(c.keyboardPwd); });
  var code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (existing.indexOf(code) >= 0);
  var now = new Date().getTime(), end = now + 3600000;
  var id = ttlAddCode(lockId, code, "TEST automatizare " + Utilities.formatDate(new Date(now), "Europe/Bucharest", "dd.MM HH:mm"),
                      now - 60000, end);
  PropertiesService.getScriptProperties().setProperty("TTLOCK_TEST_CODE_ID", String(id));
  console.log("Cod de test pus pe yală: " + code + "#  · valabil până la " +
              Utilities.formatDate(new Date(end), "Europe/Bucharest", "HH:mm") + " · keyboardPwdId " + id);
}

function ttlockStergeCodTest() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty("TTLOCK_TEST_CODE_ID");
  if (!id) { console.log("Nu există niciun cod de test de șters."); return; }
  ttlDeleteCode(ttlLockId(), id);
  p.deleteProperty("TTLOCK_TEST_CODE_ID");
  console.log("Codul de test (keyboardPwdId " + id + ") a fost șters de pe yală.");
}

// Pune pe yală un cod personalizat, prin gateway (addType 2), valabil între startMs și endMs. Întoarce keyboardPwdId.
function ttlAddCode(lockId, code, name, startMs, endMs) {
  return ttlCall("/v3/keyboardPwd/add", { lockId: lockId, keyboardPwd: code, keyboardPwdName: name,
                                          startDate: startMs, endDate: endMs, addType: 2 }).keyboardPwdId;
}

// Șterge un cod de pe yală, prin gateway (deleteType 2).
function ttlDeleteCode(lockId, keyboardPwdId) {
  ttlCall("/v3/keyboardPwd/delete", { lockId: lockId, keyboardPwdId: keyboardPwdId, deleteType: 2 });
}

// Mută intervalul de valabilitate al unui cod existent, prin gateway (changeType 2).
function ttlChangeCode(lockId, keyboardPwdId, startMs, endMs) {
  ttlCall("/v3/keyboardPwd/change", { lockId: lockId, keyboardPwdId: keyboardPwdId,
                                      startDate: startMs, endDate: endMs, changeType: 2 });
}

// ID-ul yalei: din TTLOCK_LOCK_ID sau, dacă contul are o singură yală, din lista yalelor (și se salvează).
function ttlLockId() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty("TTLOCK_LOCK_ID");
  if (id) return id;
  var locks = ttlCall("/v3/lock/list", { pageNo: 1, pageSize: 20 }).list || [];
  if (locks.length !== 1) throw new Error("Contul TTLock are " + locks.length + " yale: pune lockId-ul corect în TTLOCK_LOCK_ID.");
  p.setProperty("TTLOCK_LOCK_ID", String(locks[0].lockId));
  return String(locks[0].lockId);
}

/* ============================== API ============================== */

// Cerere POST către TTLock (formular), cu clientId, token și data curentă adăugate automat.
function ttlCall(path, params) {
  var payload = { clientId: ttlProp("TTLOCK_CLIENT_ID"), accessToken: ttlToken(), date: String(new Date().getTime()) };
  Object.keys(params || {}).forEach(function (k) { payload[k] = String(params[k]); });
  var res = UrlFetchApp.fetch(TTL_API + path, { method: "post", payload: payload, muteHttpExceptions: true });
  var body = ttlJson(res, path);
  if (body.errcode) throw new Error("TTLock " + path + ": " + body.errcode + " " + (body.errmsg || body.description || ""));
  return body;
}

// Tokenul curent; cere unul nou (refresh, apoi cont + parolă) dacă lipsește sau expiră în mai puțin de 7 zile.
function ttlToken() {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty("TTLOCK_ACCESS_TOKEN");
  var expires = Number(p.getProperty("TTLOCK_TOKEN_EXPIRES") || 0);
  if (token && expires - new Date().getTime() > TTL_RENEW_BEFORE_MS) return token;

  var refresh = p.getProperty("TTLOCK_REFRESH_TOKEN");
  var body = refresh ? ttlOauth({ grant_type: "refresh_token", refresh_token: refresh }, true) : null;
  if (!body) body = ttlOauth({ username: ttlProp("TTLOCK_USERNAME"), password: ttlProp("TTLOCK_PASSWORD_MD5") }, false);
  p.setProperties({
    TTLOCK_ACCESS_TOKEN: body.access_token,
    TTLOCK_REFRESH_TOKEN: body.refresh_token || refresh || "",
    TTLOCK_TOKEN_EXPIRES: String(new Date().getTime() + Number(body.expires_in || 7776000) * 1000)
  });
  return body.access_token;
}

// quiet = true: o eroare întoarce null (se încearcă apoi cu cont + parolă), altfel aruncă eroarea.
function ttlOauth(extra, quiet) {
  var payload = { client_id: ttlProp("TTLOCK_CLIENT_ID"), client_secret: ttlProp("TTLOCK_CLIENT_SECRET") };
  Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
  var res = UrlFetchApp.fetch(TTL_API + "/oauth2/token", { method: "post", payload: payload, muteHttpExceptions: true });
  var body = ttlJson(res, "/oauth2/token");
  if (body.access_token) return body;
  if (quiet) return null;
  throw new Error("TTLock: nu primesc token (" + (body.errcode || res.getResponseCode()) + " " +
                  (body.errmsg || body.description || "") + "). Verifică datele din Script Properties.");
}

function ttlJson(res, path) {
  try { return JSON.parse(res.getContentText()); }
  catch (e) { throw new Error("TTLock " + path + ": răspuns neașteptat (HTTP " + res.getResponseCode() + ")"); }
}

function ttlProp(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error("Lipsește " + key + " în Script Properties (vezi apps-script/README.md).");
  return v;
}

// MD5 cu 32 de caractere, litere mici (cum cere TTLock pentru parolă).
function ttlMd5(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8), hex = "";
  for (var i = 0; i < bytes.length; i++) hex += ("0" + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}
