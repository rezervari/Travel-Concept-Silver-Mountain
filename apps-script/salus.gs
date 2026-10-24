/**
 * A13 Travel Concept — termostatele Salus iT600 (Google Apps Script): citire, încălzirea după rezervări, geamuri uitate.
 *
 * Termostatele (gateway UGE600) se administrează din aplicația Salus Smart Home, care rulează pe cloud-ul Salus din
 * AWS. Salus nu are API public: drumul de aici e cel descoperit de binding-ul openHAB „salus-aws-bridge”
 * (org.openhab.binding.salus, reverse engineering): login Amazon Cognito (SRP) → chei AWS temporare → lista
 * dispozitivelor de la service-api.eu.premium.salusconnect.io → starea fiecărui termostat din AWS IoT („device shadow”).
 *   salusSetup    — prima dată sau după o parolă nouă: uită sesiunea salvată și rulează salusTest.
 *   salusTest     — termostatele: temperatura din cameră, cea setată, modul și ce reglaje au. Nu schimbă nimic.
 *   salusDiagnoza — pas cu pas, când salusTest dă eroare (verifică și cloud-ul vechi Salus).
 *   salusViteza   — fără cont și fără rețea: verifică calculul cu numere mari pe motorul Apps Script și cât durează.
 *   salusDetalii  — toate valorile raportate (blocare taste, senzori deschis/închis, baterii). Nu schimbă nimic.
 * Automatizarea (salSync, pas în checkinSync la 10 minute; pornită doar cu salusPornire, oprită cu salusOprire):
 *   - încălzirea: în ziua sosirii de la 07:00 → 23 °C, manual permanent, taste deblocate; în ziua plecării de la
 *     11:00 → 21 °C (dacă nu sosește altcineva în aceeași zi). Doar la aceste momente: ce reglează oaspetele între
 *     ele rămâne neatins. Comanda se verifică la rulările următoare (retrimisă după 20 min, alertă după o oră).
 *   - geamurile: senzor deschis de cel puțin o oră ȘI camera sub 20 °C → o alertă (o dată pe deschidere); senzor
 *     fără semnal de 2 ore (de obicei bateria) → o alertă. Deschiderile scurte nu trimit nimic.
 *   - bateriile: termostate (nivel 0–5 + alarmă), capete termostatice (doar alarmă, nu nivel), senzori (tensiune, cu
 *     pragurile aplicației Salus) → o alertă când una e slabă, un mesaj fără sunet după schimbare.
 *   salusPlan — fără să schimbe nimic: sejururile văzute, ce ar face acum automatizarea, starea senzorilor.
 *
 * Comenzile sunt doar cele din SAL_COMMANDS (temperatura, modul, blocarea tastelor), cu valori verificate înainte.
 *
 * Datele de acces stau DOAR în Script Properties (Project Settings → Script Properties), niciodată în cod:
 *   SALUS_USERNAME — e-mailul cu care intri în aplicația Salus Smart Home
 *   SALUS_PASSWORD — parola contului; după primul login reușit rămâne doar ca hash (SALUS_PASSWORD_HASH +
 *                    SALUS_SRP_USER), iar cea în clar se șterge. O parolă nouă se pune tot în SALUS_PASSWORD.
 *   SALUS_HOME     — opțional: numele proprietății din aplicația Salus; implicit „Cora Silver” (contul are mai multe
 *                    proprietăți, doar aceasta e a apartamentului A13 și doar pe ea lucrează scriptul).
 *   SALUS_HEATING  — „1” = automatizarea pornită (o pune salusPornire); altceva sau lipsă = oprită.
 *   SAL_STATE      — starea automatizării (scrisă de script): ultimul mod aplicat, sosirile tratate, verificări, senzori.
 * Sesiunea: SALUS_REFRESH_TOKEN în Script Properties; tokenurile de o oră și cheile AWS temporare doar în cache.
 * Același proiect cu celelalte fișiere: numele globale de aici încep cu SAL_ / sal. Motor vechi (Rhino) → ES5,
 * fără BigInt → calculul SRP folosește numerele mari de la finalul fișierului.
 */

var SAL_REGION = "eu-central-1";
var SAL_USER_POOL = "eu-central-1_XGRz3CgoY";
var SAL_CLIENT_ID = "4pk5efh3v84g5dav43imsv4fbj";
var SAL_IDENTITY_POOL = "eu-central-1:60912c00-287d-413b-a2c9-ece3ccef9230";
var SAL_API = "https://service-api.eu.premium.salusconnect.io";
var SAL_LEGACY_API = "https://eu.salusconnect.io";   // cloud-ul vechi (Ayla, certificat expirat), doar pentru salusDiagnoza
var SAL_COMPANY = "salus-eu";
var SAL_IOT_HOST = "a24u3z7zzwrtdl-ats.iot.eu-central-1.amazonaws.com";
var SAL_IOT_SERVICE = "iotdevicegateway";
var SAL_SESSION_CACHE = "salus_session";
var SAL_HOME_DEFAULT = "Cora Silver";   // proprietatea apartamentului A13 în aplicația Salus (alta: Script Property SALUS_HOME)
var SAL_HOME_NAME_FIELDS = ["name", "title", "label", "alias", "display_name", "property_name"];
var SAL_HOLD_TYPES = { 0: "program", 1: "manual temporar (până la următorul pas din program)", 2: "manual permanent", 7: "oprit" };
var SAL_MODEL_FIELDS = ["model", "oem_model", "product_name", "device_type", "type"];
var SAL_LAST_SRP_MS = 0;
var SAL_SELF_CHECK = "39c95c94681701e36cc66115029a575443d5b6909f50db27a74b9a381f2c09b6";   // pentru salusViteza

// Automatizarea (salSync).
var SAL_ENABLED_PROPERTY = "SALUS_HEATING";
var SAL_STATE_PROPERTY = "SAL_STATE";
var SAL_DEVICES_CACHE = "salus_devices2";  // termostatele, capetele termostatice și senzorii proprietății, 6 ore
var SAL_PANEL_CACHE = "sal_panel2";        // citirea pentru panou, rezumat și baterii, 15 minute (golită după o comandă)
var SAL_STAY_X100 = 2300;                  // pe durata sejurului
var SAL_BETWEEN_X100 = 2100;               // între sejururi
var SAL_HEAT_ON_HOUR = 7;                  // în ziua sosirii, de la 07:00 (ventiloconvectoarele încălzesc repede)
var SAL_HEAT_OFF_HOUR = 11;                // în ziua plecării, de la 11:00 (ora de check-out)
var SAL_NO_CHECKOUT_DAYS = 14;             // rezervare încă fără dată de plecare: 23 °C cel mult atâtea zile
var SAL_VERIFY_RETRY_MIN = 20;             // termostat care n-a preluat comanda: o retrimit după 20 și 40 de minute ...
var SAL_VERIFY_ALERT_MIN = 60;             // ... iar după o oră, alertă (o dată)
var SAL_WINDOW_OPEN_MIN = 60;              // geam deschis de cel puțin o oră ...
var SAL_WINDOW_COLD_X100 = 2000;           // ... și camera sub 20 °C → alertă
var SAL_SENSOR_OFFLINE_MIN = 120;          // senzor fără semnal de 2 ore → alertă
var SAL_THERMOSTAT_MODELS = /^(SQ6|VS[12]0|TS600|HTR|FC600|iT600TH)/i;
var SAL_SENSOR_MODELS = /^SW600/i;
var SAL_TRV_MODELS = /TRV/i;               // capetele termostatice (it600MINITRV)
// Bateriile. Termostat: nivel 0–5 (BatteryLevel), slabă la 1 sau mai puțin sau cu alarma Error32. Cap termostatic: nu
// raportează nivelul, doar alarma TRVError22 (iar termostatul lui, Error22). Senzor SW600: tensiunea, cu pragurile din
// aplicația web Salus (după integrarea Home Assistant din comunitate): ≥ 2,6 V plină, ≥ 2,3 V pe jumătate, ≥ 2,1 V
// slabă, sub = critică; alertă sub 2,3 V sau cu alarma de baterie a senzorului.
var SAL_THERMO_LOW_LEVEL = 1;
var SAL_SENSOR_VOLTS = [[2.6, "plină"], [2.3, "pe jumătate"], [2.1, "slabă"], [0, "critică"]];
var SAL_SENSOR_LOW_V = 2.3;
// Senzorul → termostatul camerei (numele din aplicația Salus, fără diacritice și litere mari).
var SAL_SENSOR_ROOMS = { "terasa living": "t living", "terasa dormitor mare": "t dormitor mare",
                         "terasa dormitor mic": "t dormitor mic", "usa intrare": "t hol" };
// Singurele comenzi trimise (în afară de temperatură, 10–30 °C din 0,5 în 0,5): mod manual permanent și taste.
var SAL_COMMANDS = { SetHoldType: [0, 1, 2, 7], SetLockKey: [0, 1] };

/* ============================== PUNCTE DE INTRARE ============================== */

// Prima dată (după ce ai pus SALUS_USERNAME + SALUS_PASSWORD) sau după o parolă nouă: login de la zero + test.
function salusSetup() {
  PropertiesService.getScriptProperties().deleteProperty("SALUS_REFRESH_TOKEN");
  CacheService.getScriptCache().remove(SAL_SESSION_CACHE);
  salusTest();
}

// Test doar-citire pe proprietatea apartamentului: fiecare termostat cu temperatura din cameră, cea setată, modul și
// reglajele raportate. Celelalte proprietăți din cont apar doar cu numele. Nu afișează nimic secret (parolă, tokenuri,
// chei); din ID-urile dispozitivelor arată doar ultimele 4 caractere.
function salusTest() {
  var used = null;
  var inv = salWithSession(function (s) { used = s; return salInventory(s); }), devices = inv.devices, models = {};
  console.log("Salus: autentificare OK (" + salHowText(used) + ").");
  console.log("Proprietăți în cont: " + inv.homes.length + " (" + inv.homes.map(salHomeLabel).join(", ") +
              ") · folosesc „" + inv.home.name + "”");
  console.log("„" + inv.home.name + "”: dispozitive " + devices.length +
              " · termostate " + devices.filter(function (d) { return d.thermostats.length; }).length);
  devices.forEach(function (d) {
    console.log("— „" + d.name + "” · model: " + (d.model || "?") + " · ID …" + d.dsn.slice(-4) +
                (d.shadow ? "" : " · fără stare în AWS IoT"));
    d.thermostats.forEach(function (t) { console.log("   " + salThermostatText(t)); });
    var key = d.propertyNames.join(", ");
    if (key && !models[key]) {
      models[key] = true;
      console.log("   reglaje raportate: " + key);
    }
  });
  var first = devices[0];
  if (first) console.log("Câmpuri în lista dispozitivelor (pentru pasul următor): " + first.itemKeys.join(", ") +
                         (first.reportedKeys.length ? " · în stare: " + first.reportedKeys.join(", ") : ""));
}

// Fără rețea și fără cont: verifică pe motorul Apps Script calculul cu numere mari (față de un rezultat calculat
// dinainte cu BigInt în Node) și măsoară cât durează calculul unui login SRP. Merge înainte de datele contului.
function salusViteza() {
  var t0 = new Date().getTime(), ctx = salMont(), init = new Date().getTime() - t0;
  var e = salBnFromBytes(salSha256(salUtf8("A13 Travel Concept")).concat(salSha256(salUtf8("Silver Mountain"))));
  var gp = salMontFrom(ctx, salMontPow2(ctx, e));
  var kp = salMontFrom(ctx, salMontPow(ctx, salMontTo(ctx, ctx.k), e));
  var ok = salHex(salSha256(salBnToByteArray(kp).concat(salBnToByteArray(gp)))) === SAL_SELF_CHECK;
  t0 = new Date().getTime();
  salSrpKey(salSrpStart(), salBnToHex(gp), "8f3e2a1b0c9d8e7f", salSha256(salUtf8("test")));
  var srp = new Date().getTime() - t0;
  console.log("Calcul cu numere mari: " + (ok ? "corect" : "GREȘIT — nu rula încă salusSetup") + " · pregătire " + init +
              " ms · calculul unui login SRP " + (srp / 1000).toFixed(1).replace(".", ",") + " s");
}

// Doar citire: valorile raportate de fiecare dispozitiv al proprietății (fără programe orare, ID-uri hardware și
// linkuri; erorile doar dacă sunt active), ca să se vadă blocarea tastelor, starea senzorilor și bateriile.
function salusDetalii() {
  var inv = salWithSession(function (s) { return salInventory(s); });
  inv.devices.forEach(function (d) {
    var parts = [];
    Object.keys(d.raw).sort().forEach(function (k) {
      var v = d.raw[k], name = k.split(":").slice(1).join(":") || k;
      if (/Schedule|EUID|DSN|URL|AppData|JoinConfig|Registration|DailyTH|Version|DeviceName|Leave|OTA|ModelIdentifier|ManufactureName|Threshold|AlarmMask/.test(name)) return;
      if (/Error/.test(name) && !v) return;
      if (v === null || typeof v === "object" || String(v).length > 30) return;
      parts.push(name + "=" + v);
    });
    console.log("— „" + d.name + "” (" + (d.model || "?") + "): " + parts.join(", "));
  });
}

// Pas cu pas: datele din Script Properties (fără să le afișeze), login, proprietăți, dispozitive, stare.
// Dacă login-ul pe cloud-ul nou (AWS) nu merge și parola e încă în clar, încearcă și cloud-ul vechi Salus.
function salusDiagnoza() {
  var p = PropertiesService.getScriptProperties();
  var raw = p.getProperty("SALUS_USERNAME") || "", user = raw.trim(), plain = p.getProperty("SALUS_PASSWORD");
  console.log("SALUS_USERNAME: " + (user ? (user.indexOf("@") > 0 ? "adresă de e-mail" :
              "alt format (aplicația Salus folosește e-mailul)") + ", " + user.length + " caractere" +
              (raw !== user ? " (spațiile de la capete sunt ignorate)" : "") : "LIPSEȘTE"));
  console.log("Parola: " + (plain ? "SALUS_PASSWORD (în clar; devine hash la primul login reușit)" :
              p.getProperty("SALUS_PASSWORD_HASH") ? "hash-ul salvat" : "LIPSEȘTE") +
              " · sesiune salvată: " + (p.getProperty("SALUS_REFRESH_TOKEN") ? "da" : "nu"));
  CacheService.getScriptCache().remove(SAL_SESSION_CACHE);

  var s;
  try {
    s = salSession(false);
    console.log("1. Login cloud nou (AWS): OK (" + salHowText(s) + ").");
  } catch (e) {
    console.log("1. Login cloud nou (AWS): " + e.message);
    if (plain && user && (e.awsType === "UserNotFoundException" || e.awsType === "NotAuthorizedException")) {
      try { salLegacyCheck(user, plain); } catch (err) { console.log("   Cloud vechi Salus: indisponibil (" + err.message + ")."); }
    }
    return;
  }
  var homes, home, items;
  try {
    homes = salHomes(s);
    console.log("2. Proprietăți în cont: " + homes.length + " (" + homes.map(salHomeLabel).join(", ") + ")");
  } catch (e) { console.log("2. Lista proprietăților: " + e.message); return; }
  try {
    home = salHome(homes);
    console.log("   folosesc „" + home.name + "” (ID …" + home.id.slice(-4) + ")");
  } catch (e) {
    console.log("   " + e.message);
    if (homes[0]) console.log("   câmpurile unei proprietăți: " + homes[0].keys.join(", "));
    return;
  }
  try {
    items = salDevicesOf(s, home.id);
    console.log("3. Dispozitive în „" + home.name + "”: " + items.length);
  } catch (e) { console.log("3. Dispozitivele: " + e.message); return; }
  items.forEach(function (item) {
    if (!item.device_code) { console.log("   „" + (item.name || "?") + "”: fără device_code, sărit"); return; }
    try {
      var shadow = salShadow(s, String(item.device_code));
      console.log("4. „" + (item.name || "?") + "”: " + (shadow ? "stare citită din AWS IoT (" +
                  salPropertyKeys(shadow).length + " valori)" : "fără stare în AWS IoT (404)"));
    } catch (e) { console.log("4. „" + (item.name || "?") + "”: " + e.message); }
  });
}

/* ============================== DISPOZITIVE ============================== */

// Dispozitivele proprietății apartamentului, fiecare cu starea raportată (shadow): { homes, home, devices }.
// Celelalte proprietăți din cont nu se citesc deloc (doar numele lor, din listă).
function salInventory(s) {
  var homes = salHomes(s), home = salHome(homes), devices = [];
  salDevicesOf(s, home.id).forEach(function (item) {
    if (!item.device_code) return;
    devices.push(salDescribe(home.id, item, salShadow(s, String(item.device_code))));
  });
  return { homes: homes, home: home, devices: devices };
}

// Proprietățile (gateway-urile) din cont, așa cum apar în aplicația Salus: [{ id, name, values, keys }].
// O intrare arată ca { id, type, gateway: { … } }: numele se caută în câmpurile obișnuite, întâi pe primul nivel, apoi
// în obiectele de pe al doilea (de ex. gateway.name); „values” = toate textele de pe ambele niveluri, pentru potrivire.
function salHomes(s) {
  var data = salParse((salApi(s, "/api/v1/occupants/slider_list") || {}).data) || [];
  return data.filter(function (g) { return g && g.id !== undefined && g.id !== null && g.id !== ""; }).map(function (g) {
    var levels = [{ obj: g, prefix: "" }], name = "", values = [], keys = [];
    Object.keys(g).forEach(function (k) {
      var v = salParse(g[k]);
      if (v && typeof v === "object" && !(v instanceof Array)) levels.push({ obj: v, prefix: k + "." });
    });
    levels.forEach(function (l) {
      SAL_HOME_NAME_FIELDS.forEach(function (f) { if (!name && typeof l.obj[f] === "string" && l.obj[f].trim()) name = l.obj[f].trim(); });
      Object.keys(l.obj).forEach(function (k) {
        keys.push(l.prefix + k);
        if (typeof l.obj[k] === "string") values.push(l.obj[k]);
      });
    });
    return { id: String(g.id), name: name, values: values, keys: keys.sort() };
  });
}

// Proprietatea apartamentului: SALUS_HOME sau „Cora Silver”, fără să conteze literele mari, diacriticele sau spațiile.
function salHome(homes) {
  var wanted = (PropertiesService.getScriptProperties().getProperty("SALUS_HOME") || SAL_HOME_DEFAULT).trim();
  var found = homes.filter(function (h) {
    return h.values.some(function (v) { return salNorm(v) === salNorm(wanted); });
  });
  if (found.length === 1) {
    if (!found[0].name) found[0].name = wanted;
    return found[0];
  }
  throw new Error("Salus: " + (found.length ? "mai multe proprietăți" : "nicio proprietate") + " cu numele „" + wanted +
                  "” (în cont: " + (homes.map(salHomeLabel).join(", ") || "niciuna") + "). Numele exact se pune în SALUS_HOME.");
}

function salHomeLabel(h) { return h.name ? "„" + h.name + "”" : "fără nume (ID …" + h.id.slice(-4) + ")"; }

function salNorm(text) {
  return String(text).toLowerCase().replace(/[ăâ]/g, "a").replace(/î/g, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t")
    .replace(/\s+/g, " ").trim();
}

function salDevicesOf(s, gatewayId) {
  var data = salParse((salApi(s, "/api/v1/occupants/slider_details?id=" + encodeURIComponent(gatewayId) +
                               "&type=gateway") || {}).data) || {};
  return salParse(data.items) || [];
}

// Starea raportată a unui dispozitiv din AWS IoT (GET semnat SigV4); null dacă dispozitivul nu are shadow.
function salShadow(s, dsn) {
  var path = "/things/" + encodeURIComponent(dsn) + "/shadow";
  return salFetchJson("https://" + SAL_IOT_HOST + path, {
    method: "get", headers: salSigV4(s, SAL_REGION, SAL_IOT_SERVICE, "GET", SAL_IOT_HOST, path, "", "", new Date())
  }, "AWS IoT");
}

// { gateway, dsn, name, model, itemKeys, reportedKeys, propertyNames, thermostats: [{ ep, temp, setpoint, hold, … }] }
function salDescribe(gateway, item, shadow) {
  var reported = shadow && shadow.state && salParse(shadow.state.reported) || {};
  var props = salParse((salParse(reported["11"]) || {}).properties) || {};
  var model = "", byEp = {}, names = {};
  SAL_MODEL_FIELDS.forEach(function (f) { if (!model && item[f]) model = String(item[f]); });
  Object.keys(props).forEach(function (k) {
    var parts = k.split(":");
    if (parts.length < 3) { names[k] = true; return; }
    var ep = parts[0], cluster = parts[1], name = parts.slice(2).join(":");
    names[cluster + ":" + name] = true;
    if (cluster !== "sIT600TH") return;
    if (!byEp[ep]) byEp[ep] = { ep: ep };
    byEp[ep][name] = props[k];
  });
  return {
    gateway: gateway, dsn: String(item.device_code), name: String(item.name || "?"), model: model, shadow: !!shadow,
    itemKeys: Object.keys(item).sort(), reportedKeys: Object.keys(reported).sort(),
    propertyNames: Object.keys(names).sort(), raw: props,
    thermostats: Object.keys(byEp).sort().map(function (ep) { return salThermostat(byEp[ep]); })
  };
}

function salThermostat(raw) {
  function x100(name) { return typeof raw[name] === "number" ? raw[name] / 100 : null; }
  return {
    ep: raw.ep, temp: x100("LocalTemperature_x100"), setpoint: x100("HeatingSetpoint_x100"),
    hold: typeof raw.HoldType === "number" ? raw.HoldType : null,
    running: typeof raw.RunningState === "number" ? raw.RunningState : null,
    min: x100("MinHeatSetpoint_x100"), max: x100("MaxHeatSetpoint_x100"), frost: x100("FrostSetpoint_x100"),
    lock: typeof raw.LockKey === "number" ? raw.LockKey : null
  };
}

function salThermostatText(t) {
  function deg(v) { return v === null ? "?" : v.toFixed(1).replace(".", ",") + " °C"; }
  var parts = [t.ep + ": cameră " + deg(t.temp), "setat " + deg(t.setpoint),
               "mod: " + (t.hold === null ? "?" : SAL_HOLD_TYPES[t.hold] || "cod " + t.hold)];
  if (t.running !== null) parts.push("încălzește: " + (t.running ? "da" : "nu"));
  if (t.min !== null || t.max !== null) parts.push("limite " + deg(t.min) + " – " + deg(t.max));
  if (t.frost !== null) parts.push("anti-îngheț " + deg(t.frost));
  if (t.lock !== null) parts.push("taste blocate: " + (t.lock ? "da" : "nu"));
  return parts.join(" · ");
}

function salPropertyKeys(shadow) {
  var reported = shadow && shadow.state && salParse(shadow.state.reported) || {};
  return Object.keys(salParse((salParse(reported["11"]) || {}).properties) || {});
}

/* ============================== AUTOMATIZARE: ÎNCĂLZIRE ȘI GEAMURI ============================== */

// Pornește automatizarea și o rulează imediat: între sejururi pune acum 21 °C, în timpul unui sejur 23 °C (manual
// permanent, taste deblocate). După 20 de secunde arată ce raportează termostatele.
function salusPornire() {
  PropertiesService.getScriptProperties().setProperty(SAL_ENABLED_PROPERTY, "1");
  console.log("Automatizarea termostatelor e pornită (rulează și la fiecare 10 minute, din checkinSync).");
  salRunNow();
}

// Oprește automatizarea. Termostatele rămân cum sunt; starea salvată rămâne pentru o repornire.
function salusOprire() {
  PropertiesService.getScriptProperties().setProperty(SAL_ENABLED_PROPERTY, "0");
  console.log("Automatizarea termostatelor e oprită. Termostatele rămân cum sunt acum.");
}

// Fără să schimbe nimic: sejururile din următoarele 30 de zile, ce ar face automatizarea acum, termostatele și senzorii.
function salusPlan() {
  var ctx = ciOpen(), st = salState(), stays = salStays(ctx);
  var on = PropertiesService.getScriptProperties().getProperty(SAL_ENABLED_PROPERTY) === "1";
  console.log("Automatizarea: " + (on ? "PORNITĂ" : "oprită (pornește cu salusPornire)") + " · ultimul mod aplicat: " +
              (st.mode === "stay" ? "sejur (" + salDeg(SAL_STAY_X100) + ")" :
               st.mode === "between" ? "între sejururi (" + salDeg(SAL_BETWEEN_X100) + ")" : "niciunul"));
  stays.filter(function (x) { return x.to > ctx.now && x.from < ctx.now + 30 * 86400000; })
    .sort(function (a, b) { return a.from - b.from; })
    .forEach(function (x) {
      console.log("Sejur " + x.label + ": " + salDeg(SAL_STAY_X100) + " de la " + ciClock(x.from) + ", " +
                  salDeg(SAL_BETWEEN_X100) + " de la " + ciClock(x.to) + (st.on && st.on[x.key] ? " · aplicat" : ""));
    });
  var d = salDecide(ctx, st, stays);
  console.log("Acum: " + (d.target === null ? "nimic de schimbat" : "aș pune " + salDeg(d.target) + " (" + d.why + ")"));
  salWithSession(function (s) {
    var devs = salDevices(s, true);
    salReadAll(s, devs.thermostats).forEach(function (t) { console.log("Termostat " + salThermoLine(t)); });
    salReadAll(s, devs.sensors).forEach(function (x) { console.log("Senzor " + salSensorLine(x)); });
  });
}

function salRunNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("O altă rulare e în curs; încearcă peste un minut.");
  try {
    var ctx = ciOpen();
    salSync(ctx);
    if (ctx.events.length) ciAppendLog(ctx);
  } finally {
    lock.releaseLock();
  }
  Utilities.sleep(20000);
  salWithSession(function (s) {
    salReadAll(s, salDevices(s, false).thermostats).forEach(function (t) { console.log("După 20 s: " + salThermoLine(t)); });
  });
}

// Pasul din checkinSync (la 10 minute). Nu face nimic dacă automatizarea nu e pornită sau lipsește contul Salus.
// Încălzirea și geamurile sunt separate: o eroare la una nu o oprește pe cealaltă.
function salSync(ctx) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SAL_ENABLED_PROPERTY) !== "1" || !props.getProperty("SALUS_USERNAME")) return;
  var st = salState(), before = JSON.stringify(st), errors = [];
  try {
    salWithSession(function (s) {
      errors = [];
      var devs = salDevices(s, false);
      [["încălzire", salHeatStep], ["geamuri", salWindowStep], ["baterii", salBatteryStep]].forEach(function (x) {
        try { x[1](ctx, s, devs, st); }
        catch (e) {
          if (e && e.salAuth) throw e;
          errors.push(x[0] + ": " + String(e && e.message || e).slice(0, 250));
        }
      });
    });
  } finally {
    if (JSON.stringify(st) !== before) props.setProperty(SAL_STATE_PROPERTY, JSON.stringify(st));
  }
  errors.forEach(function (m) { ciStepError(ctx, "termostate", m); });
}

function salState() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(SAL_STATE_PROPERTY) || "{}"); }
  catch (e) { return {}; }
}

// Sejururile reale: Booking și site din „Rezervări” (fără anulate și teste), Airbnb „Reserved” și Travelminit din iCal
// (citite de calendar.gs). Blocările nu pornesc încălzirea. Fiecare: { key, label, start, end, from, to } (from/to în ms).
function salStays(ctx) {
  var list = [];
  ctx.active.rows.forEach(function (r) {
    var start = String(r["Check-in"] || ""), end = String(r["Check-out"] || "");
    if (r["Stare"] === CI_STATE_CANCELLED || r["Sursă"] === "Test" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return;
    list.push({ key: "rez:" + r["Nr. rezervare"], label: r["Sursă"] + " " + r["Nr. rezervare"], start: start,
                end: /^\d{4}-\d{2}-\d{2}$/.test(end) && end > start ? end : null });
  });
  if (typeof calPlatformEvents === "function") {
    var p = calPlatformEvents(false);
    ((p.Airbnb && p.Airbnb.events) || []).forEach(function (e) {
      if (/reserved/i.test(e.summary)) list.push({ key: "airbnb:" + e.start, label: "Airbnb " + e.start, start: e.start, end: e.end });
    });
    ((p.Travelminit && p.Travelminit.events) || []).forEach(function (e) {
      list.push({ key: "travelminit:" + e.start, label: "Travelminit " + e.start, start: e.start, end: e.end });
    });
  }
  return list.map(function (x) {
    x.from = ciAt(x.start, SAL_HEAT_ON_HOUR);
    x.to = x.end ? ciAt(x.end, SAL_HEAT_OFF_HOUR) : x.from + SAL_NO_CHECKOUT_DAYS * 86400000;
    return x;
  });
}

// Ce e de făcut acum. Doar la tranziții: o sosire încă netratată → 23 °C; niciun sejur în curs după unul (sau la prima
// pornire) → 21 °C. Altfel nimic, ca să rămână ce a reglat oaspetele. { target (x100 sau null), why, fresh, active }.
function salDecide(ctx, st, stays) {
  var on = st.on || {}, now = ctx.now;
  var active = stays.filter(function (x) { return now >= x.from && now < x.to; });
  var fresh = active.filter(function (x) { return !on[x.key]; });
  if (fresh.length) {
    return { target: SAL_STAY_X100, why: "sosire " + fresh.map(function (x) { return x.label; }).join(", "), fresh: fresh, active: active };
  }
  if (!active.length && st.mode !== "between") {
    return { target: SAL_BETWEEN_X100, why: st.mode === "stay" ? "după plecare" : "între sejururi", fresh: [], active: active };
  }
  return { target: null, why: "", fresh: [], active: active };
}

function salHeatStep(ctx, s, devs, st) {
  var d = salDecide(ctx, st, salStays(ctx));
  ctx.salActive = d.active;
  if (d.target === null) {
    if (d.active.length) st.mode = "stay";
    salVerifyStep(ctx, s, devs, st);
  } else {
    var done = salReadAll(s, devs.thermostats).map(function (t) {
      return t.ok && t.ep ? salApplyOne(s, t, d.target) : t.name + ": " + (t.error || "fără stare") + ", reîncerc";
    });
    st.mode = d.active.length ? "stay" : "between";
    st.on = st.on || {};
    d.fresh.forEach(function (x) { st.on[x.key] = ctx.now; });
    st.verify = { target: d.target, since: ctx.now, tries: 1, pending: devs.thermostats.map(function (t) { return t.dsn; }) };
    CacheService.getScriptCache().remove(SAL_PANEL_CACHE);   // panoul arată imediat noua temperatură setată
    ciLog(ctx, "Încălzire " + salDeg(d.target), "", d.why + " · " + done.join("; "));
  }
  Object.keys(st.on || {}).forEach(function (k) { if (ctx.now - st.on[k] > 60 * 86400000) delete st.on[k]; });
}

// Trimite doar ce diferă: mod manual permanent, temperatura, taste deblocate. Întoarce un rând pentru Jurnal.
function salApplyOne(s, t, target) {
  var sent = [];
  if (salTh(t, "HoldType") !== 2) { salSet(s, t.dsn, t.ep, "SetHoldType", 2); sent.push("manual"); }
  if (salTh(t, "HeatingSetpoint_x100") !== target) { salSet(s, t.dsn, t.ep, "SetHeatingSetpoint_x100", target); sent.push(salDeg(target)); }
  if (salTh(t, "LockKey")) { salSet(s, t.dsn, t.ep, "SetLockKey", 0); sent.push("taste deblocate"); }
  return t.name + (sent.length ? ": " + sent.join(", ") : ": era deja așa");
}

// Termostatele au preluat comanda? Se citesc la rulările următoare; cele rămase în urmă primesc comanda din nou după
// 20 și 40 de minute; după o oră, alertă (o dată). După 6 ore verificarea se abandonează (rămâne în Jurnal).
function salVerifyStep(ctx, s, devs, st) {
  var v = st.verify;
  if (!v) return;
  var left = salReadAll(s, devs.thermostats.filter(function (t) { return v.pending.indexOf(t.dsn) >= 0; }))
    .filter(function (t) {
      return !(t.ok && salTh(t, "HeatingSetpoint_x100") === v.target && salTh(t, "HoldType") === 2 && !salTh(t, "LockKey"));
    });
  var age = ctx.now - v.since;
  v.pending = left.map(function (t) { return t.dsn; });
  if (!left.length) {
    ciLog(ctx, "Încălzire confirmată", "", salDeg(v.target) + " pe toate termostatele, după " + ciAgo(age));
    delete st.verify;
    return;
  }
  if (v.tries < 3 && age >= SAL_VERIFY_RETRY_MIN * 60000 * v.tries) {
    left.forEach(function (t) { if (t.ok && t.ep) salApplyOne(s, t, v.target); });
    v.tries++;
  }
  if (!v.alerted && age >= SAL_VERIFY_ALERT_MIN * 60000) {
    v.alerted = ctx.now;
    ciAlertOwner("Termostate: " + salDeg(v.target) + " nepreluat de " + left.length + " din " + devs.thermostats.length,
      "Am trimis " + salDeg(v.target) + " (manual, taste deblocate) acum " + ciAgo(age) + ", dar aceste termostate încă " +
      "nu raportează valoarea:\n- " + left.map(salThermoLine).join("\n- ") + "\n\nVerifică în aplicația Salus gateway-ul " +
      "și termostatele; la nevoie setează temperatura de acolo. Reîncerc automat.");
  }
  if (age > 6 * 3600000) {
    ciLog(ctx, "Încălzire neconfirmată", "", left.map(function (t) { return t.name; }).join(", "));
    delete st.verify;
  }
}

// Geamuri și uși: alertă doar dacă un senzor e deschis de cel puțin o oră ȘI camera a coborât sub 20 °C (geam uitat),
// o dată pe deschidere; la închidere, un mesaj fără sunet. Starea unui senzor fără semnal e veche și nu contează
// pentru „deschis”; fără semnal de 2 ore → o alertă cu toți senzorii căzuți (de obicei bateria).
function salWindowStep(ctx, s, devs, st) {
  if (!devs.sensors.length) return;
  var now = ctx.now, mem = st.sensors || (st.sensors = {}), thermos = null, offline = [];
  salReadAll(s, devs.sensors).forEach(function (x) {
    if (!x.ok) return;   // necitit acum: rămâne cum era
    var m = mem[x.dsn] || (mem[x.dsn] = {}), state = salSensorState(x);
    m.name = x.name;
    if (!state.online) {
      delete m.openSince; delete m.openAlerted;
      if (!m.offlineSince) m.offlineSince = now;
      if (!m.offlineAlerted && now - m.offlineSince >= SAL_SENSOR_OFFLINE_MIN * 60000) { m.offlineAlerted = now; offline.push(x); }
      return;
    }
    if (m.offlineSince) {
      if (m.offlineAlerted) ciLog(ctx, "Senzor din nou online", "", x.name);
      delete m.offlineSince; delete m.offlineAlerted;
    }
    if (!state.open) {
      if (m.openAlerted) ciLog(ctx, "Geam închis", "", x.name + ", după " + ciAgo(now - m.openSince));
      delete m.openSince; delete m.openAlerted;
      return;
    }
    if (!m.openSince) m.openSince = now;
    if (m.openAlerted || now - m.openSince < SAL_WINDOW_OPEN_MIN * 60000) return;
    if (!thermos) thermos = salReadAll(s, devs.thermostats);
    var room = salRoomFor(x.name, thermos), temp = room ? salTh(room, "LocalTemperature_x100") : null;
    if (temp === null) temp = state.temp;
    if (temp === null || temp >= SAL_WINDOW_COLD_X100) return;
    m.openAlerted = now;
    var guests = ctx.salActive ? (ctx.salActive.length ? "E un oaspete în apartament (" +
      ctx.salActive.map(function (a) { return a.label; }).join(", ") + "): poți să-i scrii." :
      "Nu e niciun oaspete acum: trebuie închis la prima vizită.") : "";
    ciLog(ctx, "Geam uitat deschis", "", x.name + ", " + ciAgo(now - m.openSince) + ", " + salDeg(temp));
    ciAlertOwner("Geam deschis de " + ciAgo(now - m.openSince) + ": " + x.name + " (" + salDeg(temp) + ")",
      "Senzorul „" + x.name + "” arată deschis de " + ciAgo(now - m.openSince) + ", iar temperatura " +
      (room ? "din „" + room.name + "”" : "de lângă senzor") + " a coborât la " + salDeg(temp) + ". Probabil a rămas " +
      "uitat deschis. " + guests + "\n\nÎți scriu când se închide.");
  });
  if (offline.length) {
    var names = offline.map(function (x) { return x.name; }).join(", ");
    ciLog(ctx, "Senzori fără semnal", "", names);
    ciAlertOwner("Senzori geam fără semnal: " + names,
      "Acești senzori nu mai comunică de cel puțin 2 ore (de obicei bateria e descărcată):\n- " +
      offline.map(salSensorLine).join("\n- ") + "\n\nCât nu au semnal, nu văd dacă geamurile rămân deschise, iar " +
      "termostatul camerei poate rămâne cu ultima stare primită (de ex. „deschis” = încălzire oprită acolo). Îți scriu când revin.");
  }
}

/* ---------- Pentru panou (secțiunea Sistem, „De făcut”) și rezumatul de la 08:00 ---------- */

// Starea încălzirii: termostatele, senzorii, modul aplicat, verificarea în curs și următoarea schimbare. Citirea
// dispozitivelor (8 cereri, câteva secunde) stă în cache 15 minute, ca cererile panoului la 5 minute să nu ajungă la
// Salus; force (⟳ din panou) citește din nou. ctx = { now, active: { rows } } (foaia „Rezervări”).
function salPanelStatus(ctx, force) {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SALUS_USERNAME")) return { configured: false };
  var cache = CacheService.getScriptCache(), hit = force ? null : cache.get(SAL_PANEL_CACHE), read = hit ? JSON.parse(hit) : null;
  if (!read) {
    try { read = salWithSession(function (s) { return salReadPanel(s, true); }); }
    catch (e) {
      read = { ok: false, at: new Date().getTime(), error: String(e && e.message || e).slice(0, 200) };
      try { cache.put(SAL_PANEL_CACHE, JSON.stringify(read), 120); } catch (x) {}
    }
  }
  var st = salState(), mem = st.sensors || {}, names = {};
  var out = { configured: true, enabled: props.getProperty(SAL_ENABLED_PROPERTY) === "1", mode: st.mode || "",
              stayC: SAL_STAY_X100 / 100, betweenC: SAL_BETWEEN_X100 / 100, ok: read.ok, at: read.at,
              error: read.error || "", home: read.home || "", thermostats: read.thermostats || [], trvs: read.trvs || [],
              sensors: read.sensors || [] };
  out.thermostats.forEach(function (t) { names[t.dsn] = t.name; delete t.dsn; });
  out.trvs.forEach(function (x) { delete x.dsn; });
  out.sensors.forEach(function (x) {
    var m = mem[x.dsn] || {};
    x.openSince = m.openSince || null;
    x.offlineSince = m.offlineSince || null;
    delete x.dsn;
  });
  if (st.verify) {
    out.verify = { target: st.verify.target / 100, since: st.verify.since, alerted: !!st.verify.alerted,
                   pending: (st.verify.pending || []).map(function (d) { return names[d] || "?"; }) };
  }
  try { out.next = salNextChange(ctx); } catch (e) { out.next = null; }
  return out;
}

// Citirea comună pentru panou, rezumat și baterii: termostatele, capetele termostatice și senzorii (13 cereri), în
// cache 15 minute (golit după o comandă). Fiecare dispozitiv cu dsn (scos înainte de panou) și starea bateriei.
function salReadPanel(s, force) {
  var cache = CacheService.getScriptCache(), hit = force ? null : cache.get(SAL_PANEL_CACHE);
  if (hit) return JSON.parse(hit);
  var devs = salDevices(s, false), th = salReadAll(s, devs.thermostats);
  var read = { ok: true, at: new Date().getTime(), home: devs.home, thermostats: th.map(salPanelThermo),
               trvs: salReadAll(s, devs.trvs || []).map(function (x) { return salPanelTrv(x, th); }),
               sensors: salReadAll(s, devs.sensors).map(salPanelSensor) };
  try { cache.put(SAL_PANEL_CACHE, JSON.stringify(read), 900); } catch (e) {}
  return read;
}

function salPanelThermo(t) {
  function c(name) { var v = salTh(t, name); return v === null ? null : v / 100; }
  var hold = salTh(t, "HoldType"), level = salTh(t, "BatteryLevel");
  return { dsn: t.dsn, name: t.name, ok: t.ok, error: t.error || "", temp: c("LocalTemperature_x100"), set: c("HeatingSetpoint_x100"),
           mode: hold === null ? "" : SAL_HOLD_TYPES[hold] || "mod " + hold, locked: !!salTh(t, "LockKey"), heating: !!salTh(t, "RunningState"),
           online: salOnline(t), battery: level,
           batteryLow: salTh(t, "Error32") === 1 || (level !== null && level <= SAL_THERMO_LOW_LEVEL),
           trvLow: salTh(t, "Error22") === 1 };
}

// Cap termostatic: alarma lui de baterie și termostatul cu care e cuplat (PairedThermostatShortID = ShortID_d).
function salPanelTrv(x, thermos) {
  var paired = x.v["sIT600I:PairedThermostatShortID"], th = null;
  thermos.forEach(function (t) { if (paired != null && t.ok && Number(t.v["sZDO:ShortID_d"]) === Number(paired)) th = t; });
  return { dsn: x.dsn, name: x.name, ok: x.ok, error: x.error || "", online: salOnline(x), thermostat: th ? th.name : "",
           batteryLow: Number(x.v["sIT600I:TRVError22"]) === 1, pairedLow: !!th && salTh(th, "Error22") === 1 };
}

function salPanelSensor(x) {
  var st = salSensorState(x);
  return { dsn: x.dsn, name: x.name, ok: x.ok, error: x.error || "", online: st.online, open: st.open, volts: st.volts,
           temp: st.temp === null ? null : st.temp / 100, battery: st.volts === null ? "" : salVoltText(st.volts),
           batteryLow: st.online && ((st.volts !== null && st.volts < SAL_SENSOR_LOW_V) ||
             Number(x.v["sIASZS:ErrorIASZSLowBattery"]) === 1 || Number(x.v["sPowerS:ErrorPowerSLowBattery"]) === 1) };
}

function salVoltText(v) {
  for (var i = 0; i < SAL_SENSOR_VOLTS.length; i++) if (v >= SAL_SENSOR_VOLTS[i][0]) return SAL_SENSOR_VOLTS[i][1];
  return "";
}

function salOnline(x) {
  var o = x.v["sZDOInfo:OnlineState"];
  return o === undefined || o === null || Number(o) === 1;
}

// Bateriile slabe din citirea comună: { low: [{ key, name, text }], known: { cheie: true } } — known = echipamentele
// citite și online acum (doar la ele se poate spune că bateria e din nou bună). Dacă doar termostatul raportează „un cap
// asociat are baterie slabă” (Error22) și niciun cap nu are alarma proprie, intrarea e pe termostat.
function salLowBatteries(r) {
  var low = [], known = {};
  function v(x) { return x.toFixed(1).replace(".", ",") + " V"; }
  r.thermostats.forEach(function (t) {
    if (!t.ok || !t.online) return;
    known["th:" + t.dsn] = known["th22:" + t.dsn] = true;
    if (t.batteryLow) low.push({ key: "th:" + t.dsn, name: t.name, text: t.name + " (termostat, nivel " + (t.battery === null ? "?" : t.battery + "/5") + ")" });
  });
  (r.trvs || []).forEach(function (x) {
    if (!x.ok || !x.online) return;
    known["trv:" + x.dsn] = true;
    if (x.batteryLow) low.push({ key: "trv:" + x.dsn, name: x.name, text: x.name + " (cap termostatic" + (x.thermostat ? ", cuplat cu " + x.thermostat : "") + ")" });
  });
  r.thermostats.forEach(function (t) {
    if (!t.ok || !t.online || !t.trvLow) return;
    var mine = (r.trvs || []).filter(function (x) { return x.thermostat === t.name; });
    if (mine.some(function (x) { return x.batteryLow; })) return;
    low.push({ key: "th22:" + t.dsn, name: "un cap termostatic al „" + t.name + "”",
               text: "un cap termostatic cuplat cu " + t.name + (mine.length ? " (" + mine.map(function (x) { return x.name; }).join(" sau ") + ")" : "") });
  });
  r.sensors.forEach(function (x) {
    if (!x.ok || !x.online) return;
    known["sen:" + x.dsn] = true;
    if (x.batteryLow) low.push({ key: "sen:" + x.dsn, name: x.name, text: x.name + " (senzor geam / ușă, " + (x.volts === null ? "alarmă de baterie" : v(x.volts)) + ")" });
  });
  return { low: low, known: known };
}

// Bateriile, la fiecare rulare, din citirea comună (cel mult o citire la 15 minute): o alertă când un echipament trece pe
// baterie slabă; un mesaj fără sunet când e din nou în regulă (doar dacă e citit și online — un senzor fără semnal rămâne
// cum era). Starea: SAL_STATE.batt = { cheie: { name, since } }.
function salBatteryStep(ctx, s, devs, st) {
  var r = salReadPanel(s, false);
  if (!r.ok) return;
  var b = salLowBatteries(r), mem = st.batt || (st.batt = {}), fresh = [];
  b.low.forEach(function (x) { if (!mem[x.key]) { mem[x.key] = { name: x.name, since: ctx.now }; fresh.push(x); } });
  Object.keys(mem).forEach(function (k) {
    if (b.known[k] && !b.low.some(function (x) { return x.key === k; })) {
      ciLog(ctx, "Baterie schimbată", "", mem[k].name);
      delete mem[k];
    }
  });
  if (fresh.length) {
    var names = fresh.map(function (x) { return x.name; }).join(", ");
    ciLog(ctx, "Baterie slabă", "", names);
    ciAlertOwner("Baterie slabă: " + names,
      "Echipamente Salus cu baterie slabă:\n- " + fresh.map(function (x) { return x.text; }).join("\n- ") + "\n\n" +
      "Schimbă bateriile la următoarea vizită în apartament. Descărcat de tot, un echipament nu mai răspunde (capul " +
      "termostatic nu mai mișcă robinetul, senzorul nu mai raportează geamul). Îți scriu când e din nou în regulă.");
  }
}

// Următoarea schimbare a automatizării: { at (ms), c (°C), why } sau null. O plecare urmată în aceeași zi de o altă
// sosire nu e schimbare (rămâne 23 °C).
function salNextChange(ctx) {
  var stays = salStays(ctx), now = ctx.now, best = null;
  function activeAt(t) { return stays.some(function (x) { return t >= x.from && t < x.to; }); }
  stays.forEach(function (x) {
    if (x.from > now && (!best || x.from < best.at)) best = { at: x.from, c: SAL_STAY_X100 / 100, why: "sosire " + x.label };
    if (x.to > now && !activeAt(x.to) && (!best || x.to < best.at)) best = { at: x.to, c: SAL_BETWEEN_X100 / 100, why: "plecare " + x.label };
  });
  return best;
}

// Incidentele pentru care s-a trimis deja alertă, cât timp sunt încă de actualitate: geam uitat deschis, senzori fără
// semnal, comandă nepreluată. Același format ca restul listei „De făcut” din panou; „Gata” ascunde incidentul curent.
function salPanelTodo(ctx) {
  var st = salState(), mem = st.sensors || {}, out = [], offline = [], since = 0;
  function item(id, level, title, detail) {
    return { id: id, kind: "alert", level: level, title: title, detail: detail, nr: "", texts: [], links: [] };
  }
  Object.keys(mem).forEach(function (dsn) {
    var m = mem[dsn];
    if (m.openAlerted) {
      out.push(item("salus|geam|" + dsn + "|" + m.openSince, "high", "Geam deschis: " + m.name + " (de " + ciAgo(ctx.now - m.openSince) + ")",
        "Senzorul arată deschis și camera s-a răcit sub " + salDeg(SAL_WINDOW_COLD_X100) + ". Dacă e un oaspete, scrie-i; altfel trebuie închis la prima vizită."));
    }
    if (m.offlineAlerted) { offline.push(m.name); since = since ? Math.min(since, m.offlineSince) : m.offlineSince; }
  });
  if (offline.length) {
    out.push(item("salus|offline|" + offline.sort().join(",") + "|" + since, "normal", "Senzori geam fără semnal: " + offline.join(", "),
      "De obicei bateria. Cât nu au semnal nu văd dacă geamurile rămân deschise, iar termostatul camerei poate ține încălzirea oprită."));
  }
  var batt = Object.keys(st.batt || {}).sort();
  if (batt.length) {
    out.push(item("salus|baterie|" + batt.join(","), "normal", "Baterie slabă: " + batt.map(function (k) { return st.batt[k].name; }).join(", "),
      "Schimbă bateriile la următoarea vizită în apartament. Dispare singur după schimbare (la următoarea citire)."));
  }
  if (st.verify && st.verify.alerted) {
    out.push(item("salus|verificare|" + st.verify.since, "high", "Termostate: " + salDeg(st.verify.target) + " nepreluat",
      "Comanda trimisă " + ciAgo(ctx.now - st.verify.since) + " în urmă nu apare încă pe toate termostatele. Verifică gateway-ul și termostatele în aplicația Salus."));
  }
  return out.filter(function (t) { return !(ctx.dismissed || {})[t.id]; });
}

// Termostatul camerei unui senzor: după SAL_SENSOR_ROOMS sau, altfel, după nume („Terasa X” → „T X”).
function salRoomFor(sensorName, thermos) {
  var n = salNorm(sensorName), want = SAL_SENSOR_ROOMS[n];
  return thermos.filter(function (t) {
    var tn = salNorm(t.name);
    return t.ok && (want ? tn === want : tn.replace(/^t /, "") && n.indexOf(tn.replace(/^t /, "")) >= 0);
  })[0] || null;
}

// Termostatele, capetele termostatice și senzorii de geam ai proprietății (după model), cu cache de 6 ore:
// { home, thermostats, trvs, sensors }.
function salDevices(s, force) {
  var cache = CacheService.getScriptCache(), hit = force ? null : cache.get(SAL_DEVICES_CACHE);
  if (hit) return JSON.parse(hit);
  var home = salHome(salHomes(s)), out = { home: home.name, thermostats: [], trvs: [], sensors: [] };
  salDevicesOf(s, home.id).forEach(function (item) {
    if (!item.device_code) return;
    var model = String(item.model || item.oem_model || ""), d = { dsn: String(item.device_code), name: String(item.name || "?").trim() };
    if (SAL_THERMOSTAT_MODELS.test(model)) out.thermostats.push(d);
    else if (SAL_SENSOR_MODELS.test(model)) out.sensors.push(d);
    else if (SAL_TRV_MODELS.test(model)) out.trvs.push(d);
  });
  if (!out.thermostats.length) throw new Error("Salus: nu găsesc niciun termostat în „" + home.name + "”.");
  cache.put(SAL_DEVICES_CACHE, JSON.stringify(out), 21600);
  return out;
}

// Starea curentă: [{ dsn, name, ok, ep, v: { "cluster:proprietate": valoare } }]. Un dispozitiv care nu răspunde apare
// cu ok: false și nu oprește citirea celorlalte (doar o sesiune refuzată oprește tot, ca să se reia cu una nouă).
function salReadAll(s, list) {
  return list.map(function (d) {
    var r = { dsn: d.dsn, name: d.name, ok: false, ep: "", v: {} };
    try {
      var shadow = salShadow(s, d.dsn);
      var reported = shadow && shadow.state && salParse(shadow.state.reported) || {};
      var props = salParse((salParse(reported["11"]) || {}).properties) || {};
      Object.keys(props).forEach(function (k) {
        var p = k.split(":");
        if (p.length < 3) return;
        if (p[1] === "sIT600TH" && !r.ep) r.ep = p[0];
        r.v[p.slice(1).join(":")] = props[k];
      });
      r.ok = !!shadow;
      if (!shadow) r.error = "fără stare în AWS IoT";
    } catch (e) {
      if (e && e.salAuth) throw e;
      r.error = String(e && e.message || e).slice(0, 120);
    }
    return r;
  });
}

function salTh(r, name) {
  var v = r.v["sIT600TH:" + name];
  return typeof v === "number" ? v : null;
}

function salSensorState(x) {
  var zone = x.v["sIASZS:ZoneStatus_d"], online = x.v["sZDOInfo:OnlineState"];
  var volts = x.v["sPowerS:BatteryVoltage_x10"], temp = x.v["sTempS:MeasuredValue_x100"];
  return { open: typeof zone === "number" && zone % 2 === 1,
           online: online === undefined || online === null || Number(online) === 1,
           volts: typeof volts === "number" ? volts / 10 : null, temp: typeof temp === "number" ? temp : null };
}

function salThermoLine(t) {
  if (!t.ok) return "„" + t.name + "”: " + (t.error || "fără stare");
  var temp = salTh(t, "LocalTemperature_x100"), set = salTh(t, "HeatingSetpoint_x100"), hold = salTh(t, "HoldType");
  return "„" + t.name + "”: cameră " + (temp === null ? "?" : salDeg(temp)) + " · setat " + (set === null ? "?" : salDeg(set)) +
         " · " + (hold === null ? "mod ?" : SAL_HOLD_TYPES[hold] || "mod " + hold) +
         " · taste " + (salTh(t, "LockKey") ? "blocate" : "deblocate") + (salTh(t, "RunningState") ? " · încălzește" : "");
}

function salSensorLine(x) {
  if (!x.ok) return "„" + x.name + "”: " + (x.error || "fără stare");
  var st = salSensorState(x);
  return "„" + x.name + "”: " + (st.online ? (st.open ? "DESCHIS" : "închis") :
         "FĂRĂ SEMNAL (ultima stare: " + (st.open ? "deschis" : "închis") + ")") +
         (st.volts !== null ? " · baterie " + st.volts.toFixed(1).replace(".", ",") + " V" : "") +
         (st.temp !== null ? " · " + salDeg(st.temp) : "");
}

function salDeg(x100) { return (x100 / 100).toFixed(1).replace(".", ",") + " °C"; }

// Comandă către un termostat, ca în aplicația Salus: publică pe topicul shadow/update al dispozitivului (UpdateThingShadow
// singur nu ajunge la termostat). Doar comenzile și valorile permise; altceva aruncă eroare înainte de orice cerere.
function salSet(s, dsn, ep, prop, value) {
  var ok = typeof value === "number" && (prop === "SetHeatingSetpoint_x100" ? value >= 1000 && value <= 3000 && value % 50 === 0 :
           !!SAL_COMMANDS[prop] && SAL_COMMANDS[prop].indexOf(value) >= 0);
  if (!ok || !/^ep_?\d+$/.test(String(ep))) throw new Error("Salus: comandă nepermisă " + ep + ":" + prop + " = " + value);
  var props = {};
  props[ep + ":sIT600TH:" + prop] = value;
  var body = JSON.stringify({ state: { desired: { "11": { properties: props } } } });
  var path = "/topics/" + encodeURIComponent("$aws/things/" + dsn + "/shadow/update");
  var res = UrlFetchApp.fetch("https://" + SAL_IOT_HOST + path + "?qos=1", {
    method: "post", contentType: "application/json", payload: body, muteHttpExceptions: true,
    headers: salSigV4(s, SAL_REGION, SAL_IOT_SERVICE, "POST", SAL_IOT_HOST, path, "qos=1", body, new Date())
  });
  var code = res.getResponseCode();
  if (code >= 400) {
    var err = new Error("Salus comandă " + prop + ": HTTP " + code + (code === 401 || code === 403 ? " (acces refuzat)" : ""));
    err.salAuth = code === 401 || code === 403;
    throw err;
  }
}

/* ============================== SESIUNE ============================== */

// Rulează fn(sesiune); dacă sesiunea din cache e refuzată (401/403), mai încearcă o dată cu una nouă.
function salWithSession(fn) {
  var s = salSession(false);
  try { return fn(s); }
  catch (e) {
    if (!e.salAuth || s.how !== "cache") throw e;
    return fn(salSession(true));
  }
}

// Sesiunea { access, id, akid, secret, token, until, how }: din cache; altfel cu refresh token; altfel login SRP.
function salSession(force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var cached = cache.get(SAL_SESSION_CACHE);
    if (cached) {
      var c = JSON.parse(cached);
      if (c.until - new Date().getTime() > 300000) { c.how = "cache"; return c; }
    }
  }
  var p = PropertiesService.getScriptProperties();
  var refresh = p.getProperty("SALUS_REFRESH_TOKEN"), how = "refresh";
  var auth = refresh ? salCognitoRefresh(refresh) : null;
  if (!auth) { auth = salCognitoLogin(); how = "srp"; }
  if (auth.RefreshToken) p.setProperty("SALUS_REFRESH_TOKEN", auth.RefreshToken);

  var logins = {};
  logins["cognito-idp." + SAL_REGION + ".amazonaws.com/" + SAL_USER_POOL] = auth.IdToken;
  var identity = salAws("cognito-identity", "AWSCognitoIdentityService.GetId",
                        { IdentityPoolId: SAL_IDENTITY_POOL, Logins: logins });
  var creds = salAws("cognito-identity", "AWSCognitoIdentityService.GetCredentialsForIdentity",
                     { IdentityId: identity.IdentityId, Logins: logins }).Credentials;
  var now = new Date().getTime();
  var s = { access: auth.AccessToken, id: auth.IdToken, akid: creds.AccessKeyId, secret: creds.SecretKey,
            token: creds.SessionToken,
            until: Math.min(now + Number(auth.ExpiresIn || 3600) * 1000, Number(creds.Expiration || 0) * 1000 || now + 3600000) };
  var ttl = Math.floor((s.until - now) / 1000) - 300;
  if (ttl > 60) cache.put(SAL_SESSION_CACHE, JSON.stringify(s), Math.min(ttl, 21600));
  s.how = how;
  return s;
}

// Tokenuri noi cu refresh token; null dacă tokenul a expirat sau a fost revocat (urmează login cu parola).
function salCognitoRefresh(refresh) {
  try {
    return salAws("cognito-idp", "AWSCognitoIdentityProviderService.InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: SAL_CLIENT_ID, AuthParameters: { REFRESH_TOKEN: refresh }
    }).AuthenticationResult || null;
  } catch (e) {
    if (e.awsType !== "NotAuthorizedException") throw e;
    PropertiesService.getScriptProperties().deleteProperty("SALUS_REFRESH_TOKEN");
    return null;
  }
}

// Login Cognito USER_SRP_AUTH (parola nu pleacă niciodată spre server, doar dovada SRP). Parola în clar, dacă
// există, are întâietate; după un login reușit cu ea se păstrează doar hash-ul și se șterge.
function salCognitoLogin() {
  var p = PropertiesService.getScriptProperties();
  var username = salProp("SALUS_USERNAME").trim(), plain = p.getProperty("SALUS_PASSWORD");
  if (!plain && !p.getProperty("SALUS_PASSWORD_HASH")) {
    throw new Error("Lipsește SALUS_PASSWORD în Script Properties (vezi apps-script/README.md).");
  }
  var t0 = new Date().getTime(), srp = salSrpStart(), srpMs = new Date().getTime() - t0;
  var ch = salAws("cognito-idp", "AWSCognitoIdentityProviderService.InitiateAuth", {
    AuthFlow: "USER_SRP_AUTH", ClientId: SAL_CLIENT_ID, AuthParameters: { USERNAME: username, SRP_A: salBnToHex(srp.A) }
  });
  if (ch.ChallengeName !== "PASSWORD_VERIFIER") throw new Error(salChallengeText(ch.ChallengeName));
  var cp = ch.ChallengeParameters || {}, userId = cp.USER_ID_FOR_SRP;
  if (!userId || !cp.SRP_B || !cp.SALT || !cp.SECRET_BLOCK) throw new Error("Salus/SRP: răspuns incomplet de la Cognito.");
  var pwHash;
  if (plain) pwHash = salPasswordHash(userId, plain);
  else if (p.getProperty("SALUS_SRP_USER") === userId) pwHash = salBytes(Utilities.base64Decode(p.getProperty("SALUS_PASSWORD_HASH")));
  else throw new Error("Contul Salus răspunde cu alt utilizator decât cel salvat: pune din nou parola în SALUS_PASSWORD.");

  var ts = salSrpTimestamp(new Date());
  t0 = new Date().getTime();
  var key = salSrpKey(srp, cp.SRP_B, cp.SALT, pwHash);
  SAL_LAST_SRP_MS = srpMs + new Date().getTime() - t0;
  var msg = salUtf8(SAL_USER_POOL.split("_")[1]).concat(salUtf8(userId), salBytes(Utilities.base64Decode(cp.SECRET_BLOCK)), salUtf8(ts));
  var res = salAws("cognito-idp", "AWSCognitoIdentityProviderService.RespondToAuthChallenge", {
    ChallengeName: "PASSWORD_VERIFIER", ClientId: SAL_CLIENT_ID, ChallengeResponses: {
      USERNAME: cp.USERNAME || username, PASSWORD_CLAIM_SECRET_BLOCK: cp.SECRET_BLOCK,
      PASSWORD_CLAIM_SIGNATURE: Utilities.base64Encode(salSigned(salHmac(key, msg))), TIMESTAMP: ts }
  });
  if (!res.AuthenticationResult) throw new Error(salChallengeText(res.ChallengeName));
  if (plain) {
    p.setProperties({ SALUS_PASSWORD_HASH: Utilities.base64Encode(salSigned(pwHash)), SALUS_SRP_USER: userId });
    p.deleteProperty("SALUS_PASSWORD");
    console.log("Parola Salus e păstrată acum doar ca hash (SALUS_PASSWORD_HASH).");
  }
  return res.AuthenticationResult;
}

function salChallengeText(name) {
  if (/MFA|OTP|SELECT_CHALLENGE/.test(String(name))) {
    return "Contul Salus cere verificare în doi pași (" + name + "), pe care automatizarea nu o poate face. " +
           "Dezactiveaz-o în aplicația Salus sau folosește un cont separat, fără ea.";
  }
  if (name === "NEW_PASSWORD_REQUIRED") {
    return "Salus cere schimbarea parolei: schimb-o în aplicația Salus, apoi pune-o în SALUS_PASSWORD.";
  }
  return "Salus a cerut un pas de autentificare neașteptat: " + (name || "fără nume") + ".";
}

function salHowText(s) {
  if (!s) return "?";
  if (s.how === "cache") return "sesiune din cache";
  if (s.how === "refresh") return "sesiune reînnoită cu refresh token";
  return "login cu parola, calculul SRP " + (SAL_LAST_SRP_MS / 1000).toFixed(1).replace(".", ",") + " s";
}

/* ============================== HTTP ============================== */

// Apel Cognito (JSON 1.1). Eroarea are awsType (de ex. NotAuthorizedException) și mesajul AWS, nimic secret.
function salAws(service, target, body) {
  var res = UrlFetchApp.fetch("https://" + service + "." + SAL_REGION + ".amazonaws.com/", {
    method: "post", contentType: "application/x-amz-json-1.1", headers: { "X-Amz-Target": target },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var code = res.getResponseCode(), data = {};
  try { data = JSON.parse(res.getContentText() || "{}"); } catch (e) {}
  if (code >= 400) {
    var type = String(data.__type || "").split("#").pop();
    var err = new Error("Salus " + target.split(".").pop() + ": " + (type || "HTTP " + code) +
                        (data.message ? " — " + data.message : ""));
    err.awsType = type;
    throw err;
  }
  return data;
}

function salApi(s, path) {
  return salFetchJson(SAL_API + path, { method: "get", headers: {
    "x-access-token": s.access, "x-auth-token": s.id, "x-company-code": SAL_COMPANY } }, "API");
}

// GET cu JSON: null la 404; eroare cu salAuth = true la 401/403. Mesajul AWS apare doar dacă e scurt și nu conține
// cererea canonică (în care ar fi tokenul de sesiune).
function salFetchJson(url, opts, label) {
  opts.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, opts), code = res.getResponseCode(), text = res.getContentText() || "";
  if (code === 404) return null;
  if (code >= 400) {
    var msg = "";
    try { msg = String(JSON.parse(text).message || ""); } catch (e) {}
    if (msg.length > 160 || /canonical|string-to-sign/i.test(msg)) msg = "";
    var err = new Error("Salus " + label + ": HTTP " + code + (code === 401 || code === 403 ? " (acces refuzat)" : "") +
                        (msg ? " — " + msg : ""));
    err.salAuth = code === 401 || code === 403;
    throw err;
  }
  try { return text ? JSON.parse(text) : {}; }
  catch (e) { throw new Error("Salus " + label + ": răspuns neașteptat (HTTP " + code + ")"); }
}

// Antetele AWS Signature V4 (semnate: host, x-amz-date și, dacă există, x-amz-security-token). path = calea exact cum
// se trimite (deja codată); în cererea canonică fiecare segment se codează încă o dată, ca la semnătorul AWS.
function salSigV4(cred, region, service, method, host, path, query, body, now) {
  var amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""), day = amzDate.slice(0, 8);
  var scope = day + "/" + region + "/" + service + "/aws4_request";
  var headers = ["host:" + host, "x-amz-date:" + amzDate], signed = "host;x-amz-date";
  if (cred.token) { headers.push("x-amz-security-token:" + cred.token); signed += ";x-amz-security-token"; }
  var canonical = [method, path.split("/").map(salAwsEncode).join("/"), query || ""].concat(headers)
    .concat(["", signed, salHex(salSha256(salUtf8(body || "")))]).join("\n");
  var toSign = ["AWS4-HMAC-SHA256", amzDate, scope, salHex(salSha256(salUtf8(canonical)))].join("\n");
  var key = salUtf8("AWS4" + cred.secret);
  [day, region, service, "aws4_request"].forEach(function (part) { key = salHmac(key, salUtf8(part)); });
  var out = { "Authorization": "AWS4-HMAC-SHA256 Credential=" + cred.akid + "/" + scope + ", SignedHeaders=" + signed +
                               ", Signature=" + salHex(salHmac(key, salUtf8(toSign))),
              "X-Amz-Date": amzDate };
  if (cred.token) out["X-Amz-Security-Token"] = cred.token;
  return out;
}

function salAwsEncode(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
}

// Cloud-ul vechi Salus (Ayla): doar ca să știm, la diagnoză, dacă e acolo contul. Nu e folosit altfel.
function salLegacyCheck(user, plain) {
  var res = UrlFetchApp.fetch(SAL_LEGACY_API + "/users/sign_in.json", {
    method: "post", contentType: "application/json", headers: { Accept: "application/json" },
    payload: JSON.stringify({ user: { email: user, password: plain } }), muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText() || "{}"); } catch (e) {}
  if (!body.access_token) { console.log("   Cloud vechi Salus: login refuzat (HTTP " + res.getResponseCode() + ")."); return; }
  var list = salFetchJson(SAL_LEGACY_API + "/apiv1/devices.json", { method: "get",
    headers: { Authorization: "auth_token " + body.access_token, Accept: "application/json" } }, "cloud vechi") || [];
  console.log("   Cloud vechi Salus: login OK, " + list.length + " dispozitive — contul NU e încă pe cloud-ul nou; " +
              "salus.gs trebuie adaptat pentru cloud-ul vechi.");
  list.forEach(function (x) {
    var d = x.device || {};
    console.log("   — „" + (d.product_name || "?") + "” · model: " + (d.oem_model || "?") + " · " + (d.connection_status || "?"));
  });
}

/* ============================== SRP (Cognito) ============================== */

var SAL_N_HEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
  "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
  "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
  "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";

// a = 256 de biți aleatori (din UUID-uri, pe care Java le generează cu SecureRandom), A = g^a mod N, cu g = 2.
function salSrpStart() {
  var ctx = salMont(), seed = [], a, A;
  do {
    for (var i = 0; i < 4; i++) seed = seed.concat(salUtf8(Utilities.getUuid()));
    a = salBnFromBytes(salSha256(seed));
    A = salMontFrom(ctx, salMontPow2(ctx, a));
  } while (salBnIsZero(A));
  return { a: a, A: A };
}

// Cheia de 16 octeți pentru semnătura PASSWORD_VERIFIER, cu aceleași convenții ca SDK-ul Cognito (octeții numerelor
// ca BigInteger.toByteArray din Java): u = H(A|B), x = H(salt|hash parolă), S = (B − k·g^x)^(a + u·x) mod N, HKDF.
function salSrpKey(srp, bHex, saltHex, pwHash) {
  var ctx = salMont(), B = salBnFromHex(bHex), bm = salMontTo(ctx, B);
  if (salBnIsZero(bm)) throw new Error("Salus/SRP: valoarea B primită de la Cognito e invalidă.");
  var u = salBnFromBytes(salSha256(salBnToByteArray(srp.A).concat(salBnToByteArray(B))));
  if (salBnIsZero(u)) throw new Error("Salus/SRP: u = 0, reîncearcă.");
  var x = salBnFromBytes(salSha256(salBnToByteArray(salBnFromHex(saltHex)).concat(pwHash)));
  var kv = salMontMul(ctx, salMontTo(ctx, ctx.k), salMontPow2(ctx, x));
  var S = salMontFrom(ctx, salMontPow(ctx, salMontSub(ctx, bm, kv), salBnAdd(srp.a, salBnMul(u, x))));
  var prk = salHmac(salBnToByteArray(u), salBnToByteArray(S));
  return salHmac(prk, salUtf8("Caldera Derived Key").concat([1])).slice(0, 16);
}

// H(poolName | userId | ":" | parolă) — singurul lucru din parolă de care are nevoie SRP.
function salPasswordHash(userId, password) {
  return salSha256(salUtf8(SAL_USER_POOL.split("_")[1] + userId + ":" + password));
}

// Formatul cerut de Cognito: „Sat Oct 24 08:05:03 UTC 2026” (ziua lunii fără zero în față).
function salSrpTimestamp(d) {
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function two(n) { return (n < 10 ? "0" : "") + n; }
  return days[d.getUTCDay()] + " " + months[d.getUTCMonth()] + " " + d.getUTCDate() + " " + two(d.getUTCHours()) + ":" +
         two(d.getUTCMinutes()) + ":" + two(d.getUTCSeconds()) + " UTC " + d.getUTCFullYear();
}

/* ============================== NUMERE MARI ============================== */
// Numere naturale ca șiruri de „cifre” în baza 2^24, cea mai puțin semnificativă prima: produsul a două cifre plus
// transporturile rămâne sub 2^53, deci exact în double. Înmulțirea modulo N e Montgomery (CIOS).

var SAL_B = 16777216;
var SAL_MONT = null;

function salBnFromBytes(bytes) {
  var r = [], i = bytes.length, limb, mul;
  while (i > 0) {
    limb = 0; mul = 1;
    for (var k = 0; k < 3 && i > 0; k++) { i--; limb += ((bytes[i] + 256) % 256) * mul; mul *= 256; }
    r.push(limb);
  }
  return salBnTrim(r);
}

function salBnFromHex(hex) {
  hex = String(hex).replace(/^0x/i, "");
  if (hex.length % 2) hex = "0" + hex;
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  return salBnFromBytes(bytes);
}

// Octeții minimi, big-endian, fără semn.
function salBnToBytes(a) {
  var out = [];
  for (var i = 0; i < a.length; i++) out.push(a[i] % 256, Math.floor(a[i] / 256) % 256, Math.floor(a[i] / 65536));
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out.reverse();
}

// Ca BigInteger.toByteArray() din Java, pentru numere pozitive: un 0 în față dacă primul octet are bitul de sus.
function salBnToByteArray(a) {
  var b = salBnToBytes(a);
  if (b[0] >= 128) b.unshift(0);
  return b;
}

// Ca BigInteger.toString(16): litere mici, fără zerouri în față.
function salBnToHex(a) {
  return salHex(salBnToBytes(a)).replace(/^0+/, "") || "0";
}

function salBnTrim(a) {
  while (a.length > 1 && a[a.length - 1] === 0) a.pop();
  if (!a.length) a.push(0);
  return a;
}

function salBnIsZero(a) {
  for (var i = 0; i < a.length; i++) if (a[i]) return false;
  return true;
}

function salBnCmp(a, b) {
  for (var i = Math.max(a.length, b.length) - 1; i >= 0; i--) {
    var x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function salBnAdd(a, b) {
  var r = [], c = 0, n = Math.max(a.length, b.length), x;
  for (var i = 0; i < n; i++) { x = (a[i] || 0) + (b[i] || 0) + c; c = x >= SAL_B ? 1 : 0; r.push(x - c * SAL_B); }
  if (c) r.push(c);
  return r;
}

// a − b, cu a ≥ b; rezultatul are câte cifre are a.
function salBnSub(a, b) {
  var r = [], c = 0, x, B = SAL_B;
  for (var i = 0; i < a.length; i++) { x = a[i] - (b[i] || 0) - c; c = x < 0 ? 1 : 0; r.push(x + c * B); }
  return r;
}

function salBnMul(a, b) {
  var r = [], i, j, c, x;
  for (i = 0; i < a.length + b.length; i++) r.push(0);
  for (i = 0; i < a.length; i++) {
    c = 0;
    for (j = 0; j < b.length; j++) { x = r[i + j] + a[i] * b[j] + c; c = Math.floor(x / SAL_B); r[i + j] = x - c * SAL_B; }
    r[i + b.length] = c;
  }
  return salBnTrim(r);
}

function salBnPad(a, n) {
  var r = salBnTrim(a.slice());
  if (r.length > n) throw new Error("Salus/SRP: număr prea mare pentru modul.");
  while (r.length < n) r.push(0);
  return r;
}

// Contextul Montgomery pentru N (calculat o dată pe rulare): n0inv = −N⁻¹ mod 2^24, one = R mod N, r2 = R² mod N.
function salMont() {
  if (SAL_MONT) return SAL_MONT;
  var N = salBnFromHex(SAL_N_HEX), n = N.length, inv = N[0], i;
  function mod24(v) { return v - Math.floor(v / SAL_B) * SAL_B; }
  for (i = 0; i < 5; i++) inv = mod24(inv * mod24(2 - mod24(N[0] * inv) + SAL_B));   // Newton: biții corecți se dublează
  var ctx = { N: N, n: n, n0inv: mod24(SAL_B - inv) };
  var x = salBnPad([1], n);
  for (i = 0; i < 24 * n; i++) x = salMontDouble(ctx, x);
  ctx.one = x;
  for (i = 0; i < 24 * n; i++) x = salMontDouble(ctx, x);
  ctx.r2 = x;
  ctx.k = salBnFromBytes(salSha256(salBnToByteArray(N).concat([2])));
  SAL_MONT = ctx;
  return ctx;
}

// 2x mod N, pentru x < N (în forma Montgomery dublarea e tot dublare).
function salMontDouble(ctx, x) {
  var r = [], c = 0, v, n = ctx.n, B = 16777216;
  for (var i = 0; i < n; i++) { v = x[i] * 2 + c; c = v >= B ? 1 : 0; r.push(v - c * B); }
  if (c || salBnCmp(r, ctx.N) >= 0) r = salBnSub(r.concat([c]), ctx.N).slice(0, n);
  return r;
}

// a·b·R⁻¹ mod N (CIOS), a și b cu n cifre, a·b < R·N. Bucla cea mai rulată din tot calculul: doar variabile locale
// (o variabilă globală citită aici încetinește calculul de ~20 de ori).
function salMontMul(ctx, a, b) {
  var N = ctx.N, n = ctx.n, q = ctx.n0inv, B = 16777216, t = [], i, j, x, c, ai, m;
  for (i = 0; i < n + 2; i++) t.push(0);
  for (i = 0; i < n; i++) {
    ai = a[i]; c = 0;
    for (j = 0; j < n; j++) { x = t[j] + ai * b[j] + c; c = (x / B) | 0; t[j] = x - c * B; }
    x = t[n] + c; c = (x / B) | 0; t[n] = x - c * B; t[n + 1] = c;
    x = t[0] * q; m = x - ((x / B) | 0) * B;
    x = t[0] + m * N[0]; c = (x / B) | 0;
    for (j = 1; j < n; j++) { x = t[j] + m * N[j] + c; c = (x / B) | 0; t[j - 1] = x - c * B; }
    x = t[n] + c; c = (x / B) | 0; t[n - 1] = x - c * B;
    t[n] = t[n + 1] + c; t[n + 1] = 0;
  }
  var r = t.slice(0, n + 1);
  if (r[n] || salBnCmp(r, N) >= 0) r = salBnSub(r, N);
  return r.slice(0, n);
}

function salMontTo(ctx, a) { return salMontMul(ctx, salBnPad(a, ctx.n), ctx.r2); }
function salMontFrom(ctx, a) { return salBnTrim(salMontMul(ctx, a, salBnPad([1], ctx.n))); }

function salMontSub(ctx, a, b) {
  return (salBnCmp(a, b) >= 0 ? salBnSub(a, b) : salBnSub(salBnAdd(a, ctx.N), b)).slice(0, ctx.n);
}

// base^e, cu base în forma Montgomery (ferestre de 4 biți); rezultatul în forma Montgomery.
function salMontPow(ctx, base, e) {
  var table = [ctx.one, base], r = ctx.one, started = false, i, sh, k, nib;
  for (i = 2; i < 16; i++) table.push(salMontMul(ctx, table[i - 1], base));
  for (i = e.length - 1; i >= 0; i--) {
    for (sh = 20; sh >= 0; sh -= 4) {
      nib = (e[i] >> sh) & 15;
      if (started) for (k = 0; k < 4; k++) r = salMontMul(ctx, r, r);
      if (nib) { r = started ? salMontMul(ctx, r, table[nib]) : table[nib]; started = true; }
    }
  }
  return r;
}

// 2^e mod N în forma Montgomery: la baza 2, înmulțirea cu baza e o simplă dublare.
function salMontPow2(ctx, e) {
  var r = ctx.one, started = false, i, bit;
  for (i = e.length - 1; i >= 0; i--) {
    for (bit = 23; bit >= 0; bit--) {
      if (started) r = salMontMul(ctx, r, r);
      if ((e[i] >> bit) & 1) { r = salMontDouble(ctx, r); started = true; }
    }
  }
  return r;
}

/* ============================== OCTEȚI ȘI UTILITARE ============================== */

// Copie ca șir JS de octeți fără semn (0–255), din orice șir de octeți (inclusiv Byte[] din Apps Script, cu semn).
function salBytes(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) out.push((arr[i] + 256) % 256);
  return out;
}

// Octeți cu semn (−128..127), cum îi cer funcțiile Utilities.
function salSigned(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) out.push(arr[i] > 127 ? arr[i] - 256 : arr[i]);
  return out;
}

function salUtf8(str) {
  var bin = unescape(encodeURIComponent(String(str))), out = [];
  for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i));
  return out;
}

function salSha256(bytes) {
  return salBytes(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salSigned(bytes)));
}

function salHmac(key, msg) {
  return salBytes(Utilities.computeHmacSha256Signature(salSigned(msg), salSigned(key)));
}

function salHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) hex += ("0" + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}

// Unele câmpuri vin ca text JSON în loc de obiect (openHAB tratează la fel ambele forme).
function salParse(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function salProp(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error("Lipsește " + key + " în Script Properties (vezi apps-script/README.md).");
  return v;
}
