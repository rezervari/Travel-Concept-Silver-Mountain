(function(){
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- CONFIG ---------- */
  // Adresa la care ajung solicitările trimise prin varianta de rezervă (mailto) — aceeași căsuță ca Apps Script; nu se afișează.
  var CONTACT_EMAIL = ["mircea.george.vulcanescu", "gmail.com"].join("@");
  // Adresa publică a firmei (afișată în footer și pe paginile legale) — butonul „E-mail” din footer.
  var PUBLIC_EMAIL = "travel@travelconcept.ro";
  // URL-ul web app-ului Google Apps Script (apps-script/rezervari.gs) care trimite solicitarea pe e-mail.
  // Gol = se foloseste varianta veche (mailto, deschide clientul de e-mail al oaspetelui).
  var BOOKING_ENDPOINT = "https://script.google.com/macros/s/AKfycbwdwQ-uHv0ZGgtc8yEBdIt-DV1OxBZg7Lu75PYILBTBHXUJ5E0dMIKL669JBf6p_c7L/exec";
  var BOOKED_JSON = "booked-dates.json"; // generat periodic de update-calendar.js
  var PRICING_JSON = "pricing.json";     // tarife pe sezon + trepte de reducere
  // Statistici de trafic fără cookie-uri (Umami Cloud): Website ID din cloud.umami.is → Settings → Websites.
  // Gol = fără statistici (scriptul Umami nu se încarcă, evenimentele se ignoră).
  var UMAMI_WEBSITE_ID = "3cf7367d-db23-466c-81f8-e5c4e7942d28"; // cont Umami Cloud (regiune EU) al lui Mircea

  /* ---------- SURSA VIZITEI (UTM / referrer) — trimisă cu solicitarea, fără cookie-uri ---------- */
  // Ex.: „google / organic · gbp · rezervare”, „referrer: www.facebook.com”, „direct”.
  // Se păstrează în sessionStorage, ca o reîncărcare fără parametri să nu șteargă sursa.
  var VISIT_SOURCE = captureVisitSource();

  function captureVisitSource(){
    var KEY = "a13_src";
    function clean(v){ return String(v || "").replace(/[^\w.\-+ ]/g, "").trim().slice(0, 60); }
    var q = new URLSearchParams(location.search);
    var utm = ["utm_source","utm_medium","utm_campaign","utm_content"].map(function(k){ return clean(q.get(k)); });
    var ref = "";
    try{
      var host = document.referrer ? new URL(document.referrer).hostname : "";
      if(host && host !== location.hostname) ref = host;
    }catch(e){}
    var label = "direct";
    if(utm[0]) label = utm[0] + (utm[1] ? " / " + utm[1] : "") + (utm[2] ? " · " + utm[2] : "") + (utm[3] ? " · " + utm[3] : "");
    else if(q.get("gclid")) label = "google / cpc (gclid)";
    else if(ref) label = "referrer: " + ref;
    var current = { label: label, referrer: ref };
    try{
      if(label !== "direct"){ sessionStorage.setItem(KEY, JSON.stringify(current)); return current; }
      var saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if(saved && saved.label) return saved;
    }catch(e){}
    return current;
  }

  /* ---------- DUPĂ AFIȘAREA POZEI HERO ----------
   * Datele (JSON-uri, galeria) și statisticile pornesc abia după ce poza hero (elementul LCP) e pe ecran,
   * ca să nu intre în calculul LCP pe conexiuni lente (PageSpeed mobil: „element render delay”).
   * Semnalul = intrarea LCP a pozei hero (momentul real al afișării). Rezerve: browsere fără LCP (Safari) →
   * după încărcarea pozei + un cadru; prima interacțiune; tab în fundal; limită de siguranță 2,5 s. */
  var heroShownQueue = [];
  var heroShown = false;
  function afterHeroShown(fn){
    if(heroShown) fn(); else heroShownQueue.push(fn);
  }
  (function(){
    var img = document.getElementById("heroPhoto");
    function run(){
      if(heroShown) return;
      heroShown = true;
      heroShownQueue.splice(0).forEach(function(fn){ fn(); });
    }
    if(!img || document.hidden){ run(); return; }
    setTimeout(run, 2500);
    ["scroll", "pointerdown", "keydown"].forEach(function(type){
      window.addEventListener(type, run, {once:true, passive:true});
    });
    var lcpSupported = window.PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
      PerformanceObserver.supportedEntryTypes.indexOf("largest-contentful-paint") !== -1;
    if(lcpSupported){
      new PerformanceObserver(function(list){
        list.getEntries().forEach(function(entry){ if(entry.element === img) setTimeout(run, 0); });
      }).observe({ type: "largest-contentful-paint", buffered: true });
      img.addEventListener("error", run, {once:true});
    } else {
      var afterPaint = function(){ requestAnimationFrame(function(){ setTimeout(run, 0); }); };
      if(img.complete) afterPaint();
      else { img.addEventListener("load", afterPaint, {once:true}); img.addEventListener("error", run, {once:true}); }
    }
  })();

  /* ---------- STATISTICI (Umami, fără cookie-uri) ---------- */
  // Umami înregistrează singur vizitele și parametrii UTM; aici se adaugă doar evenimentele de conversie.
  if(UMAMI_WEBSITE_ID){
    afterHeroShown(function(){
      var umamiScript = document.createElement("script");
      umamiScript.src = "https://cloud.umami.is/script.js";
      umamiScript.setAttribute("data-website-id", UMAMI_WEBSITE_ID);
      umamiScript.setAttribute("data-domains", "rezervari.github.io"); // fără statistici din teste locale
      document.head.appendChild(umamiScript);
    });
  }

  // Fără date personale în evenimente: doar nopți, total, sursa vizitei, platforma, locul pe pagină.
  function track(name, data){
    try{
      if(window.umami && typeof window.umami.track === "function") window.umami.track(name, data);
    }catch(e){}
  }

  // Click-uri pe contact și pe linkurile spre platforme (inclusiv cele generate din JS, ex. recenziile).
  // Faza de captură: rulează înaintea handlerelor care opresc propagarea (smooth-scroll, #footMail).
  document.addEventListener("click", function(e){
    var a = e.target.closest ? e.target.closest("a") : null;
    if(!a) return;
    var href = a.getAttribute("href") || "";
    var loc = a.closest("footer") ? "footer" : a.closest("#mobileStickyCta") ? "bara-mobil" : a.closest("#rezervare") ? "formular"
      : a.closest("#recenzii") ? "recenzii" : a.closest("#harta") ? "harta" : "pagina";
    if(a.id === "footMail") track("contact-email", { loc: loc });
    else if(href.indexOf("tel:") === 0) track("contact-telefon", { loc: loc });
    else if(href.indexOf("wa.me") >= 0) track("contact-whatsapp", { loc: loc });
    else if(href.indexOf("writereview") >= 0) track("recenzie-google", { loc: loc });
    else {
      var platform = /booking\.com/.test(href) ? "booking"
        : /airbnb\./.test(href) ? "airbnb"
        : /travelminit\./.test(href) ? "travelminit"
        : /maps\.app\.goo\.gl|google\.[a-z.]+\/maps/.test(href) ? "google-maps" : "";
      if(platform) track("iesire-platforma", { platforma: platform, loc: loc });
    }
  }, true);

  // Fallback defensiv daca pricing.json nu poate fi incarcat
  var FALLBACK_PRICING = {
    currency: "RON",
    defaultPrice: 700,
    globalMinNights: 2,
    defaultDiscountTiers: [
      { minNights:2, discount:10 }, { minNights:3, discount:12 },
      { minNights:4, discount:15 }, { minNights:5, discount:20 },
      { minNights:6, discount:25 }, { minNights:7, discount:33 }
    ],
    seasons: []
  };
  var pricingData = null;

  var bookedRanges = []; // [{start:Date, end:Date}] end este exclusiv (ca in ICS)
  var calStatusEl = document.getElementById("calStatus");
  var calStatusInlineEl = document.getElementById("calStatusInline");

  function setStatus(msg, isError){
    [calStatusEl, calStatusInlineEl].forEach(function(el){
      if(!el) return;
      el.innerHTML = '<span class="dot"></span> ' + msg;
      el.className = "cal-status" + (isError ? " error" : "");
    });
  }

  // Calendarul se randeaza abia dupa ce au sosit AMBELE fisiere (booked-dates.json + pricing.json).
  // Altfel, daca zilele ocupate soseau primele, toate zilele apareau "Fara tarif definit".
  var calendarDataPending = 2;
  function calendarDataLoaded(){
    calendarDataPending--;
    if(calendarDataPending <= 0) renderCalendar();
  }

  function loadCalendar(){
    fetch(BOOKED_JSON, {cache:"no-store"})
      .then(function(res){
        if(!res.ok) throw new Error("missing");
        return res.json();
      })
      .then(function(data){
        bookedRanges = (data.ranges || []).map(function(r){
          return { start:new Date(r.start), end:new Date(r.end) };
        });
        // updatedAt = ultima modificare a zilelor ocupate (nu ultima verificare), deci nu se afiseaza
        setStatus("Disponibilitate sincronizată automat cu Booking, Airbnb și Travelminit.", false);
        calendarDataLoaded();
      })
      .catch(function(){
        setStatus("Nu am găsit fișierul de disponibilitate. Rulează update-calendar.js pentru a-l genera.", true);
        calendarDataLoaded();
      });
  }

  function isDateBooked(date){
    for(var i=0;i<bookedRanges.length;i++){
      var r = bookedRanges[i];
      if(date >= stripTime(r.start) && date < stripTime(r.end)) return true;
    }
    return false;
  }

  function stripTime(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // Prima zi a unei rezervari existente: ocupata, dar poate fi aleasa ca zi de check-out
  // (oaspetele nostru pleaca pana la 11:00, urmatorul soseste dupa 16:00) -- doar daca
  // noaptea dinainte e libera si are tarif.
  function isCheckoutOnlyDay(date){
    if(!isDateBooked(date)) return false;
    var prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return prev >= today && !isDateBooked(prev) && isDatePriced(prev);
  }

  // O zi poate fi check-in doar daca are tarif definit si nu e ocupata.
  function canCheckin(date){
    return isDatePriced(date) && !isDateBooked(date);
  }

  /* ---------- PRICING ENGINE (tarife pe sezon + reduceri progresive) ---------- */
  var headerPriceEl = document.getElementById("headerPriceValue");
  var infoPriceEl = document.getElementById("infoPriceValue");
  var infoPriceHintEl = document.getElementById("infoPriceHint");

  function loadPricing(){
    fetch(PRICING_JSON, {cache:"no-store"})
      .then(function(res){ if(!res.ok) throw new Error("missing"); return res.json(); })
      .then(function(data){
        pricingData = data;
        renderTeaserPrice();
        updateSummary();
        calendarDataLoaded();
      })
      .catch(function(){
        pricingData = FALLBACK_PRICING;
        renderTeaserPrice();
        updateSummary();
        calendarDataLoaded();
      });
  }

  function getSeasonForDate(date){
    if(!pricingData || !pricingData.seasons) return null;
    var t = stripTime(date).getTime();
    for(var i=0;i<pricingData.seasons.length;i++){
      var s = pricingData.seasons[i];
      var start = stripTime(new Date(s.start)).getTime();
      var end = stripTime(new Date(s.end)).getTime();
      if(t >= start && t <= end) return s;
    }
    return null;
  }

  // O zi este "tarifata" doar daca se afla intr-un sezon definit explicit in pricing.json.
  // In afara sezoanelor definite NU se ofera pret implicit -- rezervarea este blocata.
  function isDatePriced(date){
    return !!getSeasonForDate(date);
  }

  function getNightPrice(date){
    var season = getSeasonForDate(date);
    if(season && typeof season.price === "number") return season.price;
    return (pricingData && pricingData.defaultPrice) || FALLBACK_PRICING.defaultPrice;
  }

  function getDiscountTiers(checkinDate){
    var season = getSeasonForDate(checkinDate);
    if(season && season.discountTiers && season.discountTiers.length) return season.discountTiers;
    return (pricingData && pricingData.defaultDiscountTiers) || FALLBACK_PRICING.defaultDiscountTiers;
  }

  function getDiscountPct(nights, tiers){
    var pct = 0;
    (tiers || []).forEach(function(t){
      if(nights >= t.minNights && t.discount > pct) pct = t.discount;
    });
    return pct;
  }

  function getGlobalMinNights(){
    return (pricingData && pricingData.globalMinNights) || FALLBACK_PRICING.globalMinNights || 1;
  }

  // Sejur minim specific sezonului in care cade check-in-ul (ex: Craciun/Revelion = minim 3 nopti).
  // Cade pe globalMinNights doar daca sezonul nu are propriul minNights definit.
  function getMinNightsForDate(date){
    var season = getSeasonForDate(date);
    if(season && typeof season.minNights === "number") return season.minNights;
    return getGlobalMinNights();
  }

  function getMinBasePrice(){
    var data = pricingData || FALLBACK_PRICING;
    var seasonPrices = (data.seasons || [])
      .map(function(s){ return s.price; })
      .filter(function(p){ return typeof p === "number"; });
    if(seasonPrices.length) return Math.min.apply(null, seasonPrices);
    return data.defaultPrice || FALLBACK_PRICING.defaultPrice;
  }

  // Sezon cu reduceri pe durată. Cele de sărbători (Crăciun, Revelion) au toate pragurile 0%: nopțile lor rămân
  // la preț întreg și când sejurul începe înainte (ca pe Booking și Travelminit). Aceeași regulă în rezervari.gs.
  function seasonHasDiscounts(s){
    return !s || !s.discountTiers || !s.discountTiers.length ||
      s.discountTiers.some(function(t){ return t.discount > 0; });
  }

  function computeStay(ciDate, coDate){
    var nights = Math.round((coDate - ciDate) / 86400000);
    var rawTotal = 0, discountable = 0, fullPriceNights = 0;
    var d = new Date(ciDate);
    while(d < coDate){
      var price = getNightPrice(d);
      rawTotal += price;
      if(seasonHasDiscounts(getSeasonForDate(d))) discountable += price; else fullPriceNights++;
      d.setDate(d.getDate()+1);
    }
    var tiers = getDiscountTiers(ciDate);
    var pct = getDiscountPct(nights, tiers);
    var total = Math.round(rawTotal - discountable + discountable * (100 - pct) / 100);
    return {
      nights: nights,
      rawTotal: rawTotal,
      discountPct: pct,
      fullPriceNights: pct > 0 ? fullPriceNights : 0,
      total: total,
      avgPerNight: Math.round(rawTotal / nights),
      avgPerNightDiscounted: Math.round(total / nights)
    };
  }

  /* ---------- COMPARAȚIE CU PLATFORMELE (din pricing.json → otaComparison + seasons[].ota) ----------
   * Cel mai mic și cel mai mare preț pentru același sejur pe platformele de rezervări, cu regulile lor:
   * reducerile pe durată ale site-ului pe platformele care le aplică (…UsesSiteDiscounts, din foaia „Platforme”),
   * fără nopțile de sărbători pe Booking/Travelminit; Booking + reducerea de mobil; Airbnb = reduceri globale.
   * { min, max } sau null dacă lipsesc datele pentru vreo noapte. Pe site nu se numește nicio platformă în comparație. */
  function computeOtaRange(ci, co){
    var cfg = pricingData && pricingData.otaComparison;
    if(!cfg) return null;
    var nights = Math.round((co - ci) / 86400000);
    var sums = { booking:{ all:0, disc:0 }, airbnb:{ all:0, disc:0 }, travelminit:{ all:0, disc:0 } };
    for(var d = new Date(ci); d < co; d.setDate(d.getDate() + 1)){
      var s = getSeasonForDate(d);
      if(!s || !s.ota) return null;
      var hasDisc = seasonHasDiscounts(s);
      Object.keys(sums).forEach(function(k){
        var v = (typeof s.ota[k] === "number") ? s.ota[k] : NaN;
        sums[k].all += v;
        if(hasDisc) sums[k].disc += v;
      });
    }
    var pct = getDiscountPct(nights, getDiscountTiers(ci));
    function withLos(x, uses){ return uses ? x.all - x.disc + x.disc * (100 - pct) / 100 : x.all; }
    var candidates = [];
    if(isFinite(sums.booking.all)){
      candidates.push(withLos(sums.booking, cfg.bookingUsesSiteDiscounts) * (100 - (cfg.bookingMobileDiscount || 0)) / 100);
    }
    if(isFinite(sums.airbnb.all)){
      // Reducerile Airbnb sunt globale (și pe sărbători): săptămânal (7+) / lunar (28+), iar 2–6 nopți = „Trip length”
      // cu scara implicită a site-ului (prețurile de sărbători de pe Airbnb sunt ridicate ca să compenseze).
      var air = nights >= 28 ? (cfg.airbnbMonthlyDiscount || 0) : nights >= 7 ? (cfg.airbnbWeeklyDiscount || 0)
        : cfg.airbnbUsesSiteDiscounts ? getDiscountPct(nights, (pricingData && pricingData.defaultDiscountTiers) || FALLBACK_PRICING.defaultDiscountTiers) : 0;
      candidates.push(sums.airbnb.all * (100 - air) / 100);
    }
    if(isFinite(sums.travelminit.all)) candidates.push(withLos(sums.travelminit, cfg.travelminitUsesSiteDiscounts));
    return candidates.length ? { min: Math.min.apply(null, candidates), max: Math.max.apply(null, candidates) } : null;
  }

  // Economia afișată: față de cea mai ieftină și cea mai scumpă platformă, rotunjită prudent (în jos, la 10 RON);
  // afișată doar dacă direct e mai ieftin decât TOATE platformele cu cel puțin 50 RON.
  function getDirectSaving(ci, co, siteTotal){
    var ota = computeOtaRange(ci, co);
    if(ota === null) return null;
    var saving = Math.floor((ota.min - siteTotal) / 10) * 10;
    if(saving < 50) return null;
    var savingMax = Math.floor((ota.max - siteTotal) / 10) * 10;
    var checked = pricingData.otaComparison.checkedAt;
    return {
      otaFrom: Math.round(ota.min / 10) * 10,
      otaTo: Math.round(ota.max / 10) * 10,
      saving: saving,
      savingMax: savingMax,
      isRange: savingMax - saving >= 20,
      checkedAt: checked ? checked.split("-").reverse().join(".") : ""
    };
  }
  // „între 60 și 420 RON” sau „~60 RON” când platformele au practic același preț
  function savingAmountText(direct){
    return direct.isRange ? 'între ' + direct.saving + ' și ' + direct.savingMax + '\u00a0RON' : '~' + direct.saving + '\u00a0RON';
  }

  function renderTeaserPrice(){
    var minPrice = getMinBasePrice();
    if(headerPriceEl) headerPriceEl.textContent = minPrice + " RON";
    if(infoPriceEl) infoPriceEl.textContent = minPrice + " RON";
    if(infoPriceHintEl){
      var maxDiscount = getDiscountPct(99, (pricingData && pricingData.defaultDiscountTiers) || FALLBACK_PRICING.defaultDiscountTiers);
      infoPriceHintEl.textContent = "Reduceri automate de la " + getGlobalMinNights() + " nopți — până la -" + maxDiscount + "% pentru șederi lungi.";
    }
  }

  /* ---------- CALENDAR RENDER ---------- */
  var today = stripTime(new Date());
  var viewYear = today.getFullYear();
  var viewMonth = today.getMonth(); // luna curenta = prima din cele 2 afisate

  var selection = { checkin:null, checkout:null };

  var MONTH_NAMES = ["ianuarie","februarie","martie","aprilie","mai","iunie","iulie","august","septembrie","octombrie","noiembrie","decembrie"];
  var DOW = ["L","Ma","Mi","J","V","S","D"];

  function buildMonthEl(year, month){
    var wrap = document.createElement("div");
    wrap.className = "cal-month";
    var h3 = document.createElement("h3");
    h3.textContent = MONTH_NAMES[month] + " " + year;
    wrap.appendChild(h3);

    var grid = document.createElement("div");
    grid.className = "cal-grid";
    DOW.forEach(function(d){
      var el = document.createElement("div");
      el.className = "dow"; el.textContent = d;
      grid.appendChild(el);
    });

    var firstDay = new Date(year, month, 1);
    var startOffset = (firstDay.getDay() + 6) % 7; // Luni = 0
    var daysInMonth = new Date(year, month+1, 0).getDate();

    for(var i=0;i<startOffset;i++){
      var empty = document.createElement("div");
      empty.className = "cal-day empty";
      grid.appendChild(empty);
    }

    for(var d2=1; d2<=daysInMonth; d2++){
      var date = new Date(year, month, d2);
      var cell = document.createElement("div");
      cell.className = "cal-day";
      cell.textContent = d2;

      var past = date < today;
      var booked = isDateBooked(date);
      var unpriced = !past && !booked && !isDatePriced(date);

      if(past){
        cell.classList.add("past");
      } else if(booked){
        cell.classList.add("booked");
        if(isCheckoutOnlyDay(date)){
          cell.classList.add("checkout-only");
          cell.title = "Ocupat de la această dată — disponibilă doar ca zi de check-out";
          cell.addEventListener("click", function(dt){
            return function(){ handleDayClick(dt); };
          }(date));
        }
      } else if(unpriced){
        // Fara sezon/tarif definit: nu poate fi ales ca prima zi (check-in),
        // dar ramane clickabil pentru a putea servi drept zi de check-out
        // (ziua de plecare nu "consuma" o noapte tarifata).
        cell.classList.add("unpriced");
        cell.title = "Fără tarif definit pentru această dată — disponibilă doar ca zi de check-out";
        cell.addEventListener("click", function(dt){
          return function(){ handleDayClick(dt); };
        }(date));
      } else {
        cell.classList.add("available");
        cell.addEventListener("click", function(dt){
          return function(){ handleDayClick(dt); };
        }(date));
      }

      if(selection.checkin && sameDay(date, selection.checkin)) cell.classList.add("selected");
      if(selection.checkout && sameDay(date, selection.checkout)) cell.classList.add("selected");
      if(selection.checkin && selection.checkout && date > selection.checkin && date < selection.checkout){
        cell.classList.add("in-range");
      }

      grid.appendChild(cell);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

  function isDesktopOrTablet(){
    return window.matchMedia("(min-width: 720px)").matches;
  }

  function fillMonthsHost(host, showTwoMonths){
    if(!host) return;
    host.innerHTML = "";
    host.appendChild(buildMonthEl(viewYear, viewMonth));
    if(showTwoMonths){
      var nextM = viewMonth+1, nextY = viewYear;
      if(nextM > 11){ nextM = 0; nextY++; }
      host.appendChild(buildMonthEl(nextY, nextM));
    }
  }

  function renderCalendar(){
    fillMonthsHost(document.getElementById("calMonths"), true);
    fillMonthsHost(document.getElementById("calMonthsInline"), isDesktopOrTablet());
  }

  var calResizeTimer;
  window.addEventListener("resize", function(){
    clearTimeout(calResizeTimer);
    calResizeTimer = setTimeout(renderCalendar, 150);
  });

  function hasBookedBetween(a,b){
    var d = new Date(a);
    while(d < b){
      if(isDateBooked(d)) return true;
      d.setDate(d.getDate()+1);
    }
    return false;
  }

  // Nopti fara tarif definit in interval [a, b) -- b (check-out) este exclus intentionat,
  // pentru ca ziua de check-out nu reprezinta o noapte cazata.
  function hasUnpricedBetween(a,b){
    var d = new Date(a);
    while(d < b){
      if(!isDatePriced(d)) return true;
      d.setDate(d.getDate()+1);
    }
    return false;
  }

  function hasBlockedBetween(a,b){
    return hasBookedBetween(a,b) || hasUnpricedBetween(a,b);
  }

  function handleDayClick(date){
    if(!selection.checkin || (selection.checkin && selection.checkout)){
      // Prima zi selectata devine check-in -> trebuie sa fie o noapte libera, cu tarif definit
      if(!canCheckin(date)) return;
      selection.checkin = date; selection.checkout = null;
    } else {
      if(date <= selection.checkin){
        if(!canCheckin(date)) return;
        selection.checkin = date; selection.checkout = null;
      } else if(hasBlockedBetween(selection.checkin, date)){
        // Intervalul curent contine zile ocupate sau fara tarif -> pornim o noua selectie
        // doar daca noua zi e valida ca si check-in
        if(!canCheckin(date)) return;
        selection.checkin = date; selection.checkout = null;
      } else {
        selection.checkout = date;
      }
    }
    syncFormFromSelection();
    renderCalendar();

    if(selection.checkin && selection.checkout){
      var chosenNights = Math.round((selection.checkout - selection.checkin) / 86400000);
      var minForStay = getMinNightsForDate(selection.checkin);
      if(chosenNights < minForStay) track("sejur-minim-eroare", { nopti: chosenNights, minim: minForStay });
      else track("date-alese", { nopti: chosenNights, total: computeStay(selection.checkin, selection.checkout).total });
      setTimeout(function(){
        closePopup();
        document.getElementById("rezervare").scrollIntoView({behavior:"smooth", block:"start"});
      }, 450);
    }
  }

  function goPrevMonth(){
    viewMonth--; if(viewMonth<0){ viewMonth=11; viewYear--; }
    renderCalendar();
  }
  function goNextMonth(){
    viewMonth++; if(viewMonth>11){ viewMonth=0; viewYear++; }
    renderCalendar();
  }
  ["calPrev","calPrevInline"].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener("click", goPrevMonth);
  });
  ["calNext","calNextInline"].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener("click", goNextMonth);
  });

  /* ---------- FORM SYNC + PRICE (calendarul este singura sursă de adevăr) ---------- */
  var inCheckin = document.getElementById("fcheckin");
  var inCheckout = document.getElementById("fcheckout");
  var quickCheckin = document.getElementById("quickCheckin");
  var quickCheckout = document.getElementById("quickCheckout");
  var summaryBody = document.getElementById("summaryBody");
  var rangeHint = document.getElementById("rangeHint");
  var calendarWrap = document.querySelector(".calendar-wrap");
  var popupOverlay = document.getElementById("popupOverlay");
  var popupClose = document.getElementById("popupClose");
  var openCalBtn = document.getElementById("openCalBtn"); // buton eliminat din HTML (calendar inline vizibil); handler ramane defensiv

  function fmtDate(d){
    return d.toLocaleDateString("ro-RO", { day:"2-digit", month:"short", year:"numeric" });
  }
  function toInputValue(d){
    var mm = (d.getMonth()+1+"").padStart(2,"0");
    var dd = (d.getDate()+"").padStart(2,"0");
    return d.getFullYear()+"-"+mm+"-"+dd;
  }

  function openPopup(){
    popupOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
    renderCalendar();
  }
  function closePopup(){
    popupOverlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  [quickCheckin, quickCheckout, inCheckin, inCheckout].forEach(function(el){
    el.addEventListener("click", openPopup);
    el.addEventListener("focus", openPopup);
  });
  document.getElementById("quickCheckBtn").addEventListener("click", openPopup);
  if(openCalBtn) openCalBtn.addEventListener("click", openPopup);
  popupClose.addEventListener("click", closePopup);
  popupOverlay.addEventListener("click", function(e){
    if(e.target === popupOverlay) closePopup();
  });
  rangeHint.addEventListener("click", function(e){
    if(e.target.tagName === "A"){ e.preventDefault(); openPopup(); }
  });

  function syncFormFromSelection(){
    quickCheckin.value = selection.checkin ? fmtDate(selection.checkin) : "";
    quickCheckin.dataset.iso = selection.checkin ? toInputValue(selection.checkin) : "";
    quickCheckout.value = selection.checkout ? fmtDate(selection.checkout) : "";
    quickCheckout.dataset.iso = selection.checkout ? toInputValue(selection.checkout) : "";

    inCheckin.value = selection.checkin ? fmtDate(selection.checkin) : "";
    inCheckin.dataset.iso = selection.checkin ? toInputValue(selection.checkin) : "";
    inCheckout.value = selection.checkout ? fmtDate(selection.checkout) : "";
    inCheckout.dataset.iso = selection.checkout ? toInputValue(selection.checkout) : "";

    updateSummary();
  }

  /* ---------- OASPETI + TAXE LOCALE (incluse in pret, doar pentru adulti) ---------- */
  // Capacitate: max. 4 persoane în total (ca în certificatul de clasificare și pe platforme).
  var MAX_GUESTS = 4, MAX_ADULTS = 4, MAX_CHILDREN = 3;
  var TAX_TOURIST = 7;    // RON / adult / noapte
  var TAX_SALVAMONT = 5;  // RON / adult / noapte
  var selAdults = document.getElementById("fadults");
  var selChildren = document.getElementById("fchildren");

  function clampInt(v, min, max, def){
    var n = parseInt(v, 10);
    if(isNaN(n)) return def;
    return Math.min(max, Math.max(min, n));
  }
  function getGuests(){
    var adults = clampInt(selAdults ? selAdults.value : 2, 1, MAX_ADULTS, 2);
    return {
      adults: adults,
      children: clampInt(selChildren ? selChildren.value : 0, 0, Math.min(MAX_CHILDREN, MAX_GUESTS - adults), 0)
    };
  }
  // Copiii disponibili depind de adulți: adulți + copii ≤ 4.
  function syncChildrenOptions(){
    if(!selAdults || !selChildren) return;
    var limit = MAX_GUESTS - clampInt(selAdults.value, 1, MAX_ADULTS, 2);
    [].forEach.call(selChildren.options, function(o){ o.disabled = parseInt(o.value, 10) > limit; });
    if(parseInt(selChildren.value, 10) > limit) selChildren.value = String(limit);
  }
  syncChildrenOptions();
  function guestsLabel(g){
    var s = g.adults + (g.adults === 1 ? " adult" : " adulți");
    if(g.children > 0) s += ", " + g.children + (g.children === 1 ? " copil" : " copii");
    return s;
  }
  function computeTaxes(adults, nights){
    var tourist = TAX_TOURIST * adults * nights;
    var salvamont = TAX_SALVAMONT * adults * nights;
    return { tourist: tourist, salvamont: salvamont, total: tourist + salvamont };
  }
  function nightsWord(n){ return n === 1 ? "noapte" : "nopți"; }
  function adultsWord(n){ return n === 1 ? "adult" : "adulți"; }

  [selAdults, selChildren].forEach(function(el){
    if(el) el.addEventListener("change", function(){ syncChildrenOptions(); updateSummary(); });
  });

  /* ---------- REZUMAT: stare initiala (fara date alese) ----------
   * In loc de "pret de pornire": scara reducerilor pe durata + perioadele
   * speciale viitoare (sejur minim mai mare / tarif fix), citite din pricing.json. */
  var RO_MONTHS_SHORT = ["ian","feb","mar","apr","mai","iun","iul","aug","sep","oct","noi","dec"];
  function parseISODay(iso){
    var p = String(iso).split("-");
    return { y: +p[0], m: +p[1] - 1, d: +p[2] };
  }
  function fmtSeasonRange(s){
    var a = parseISODay(s.start), b = parseISODay(s.end);
    if(a.m === b.m && a.y === b.y) return a.d + "–" + b.d + " " + RO_MONTHS_SHORT[b.m];
    return a.d + " " + RO_MONTHS_SHORT[a.m] + " – " + b.d + " " + RO_MONTHS_SHORT[b.m];
  }
  function buildSummaryIntro(){
    var data = pricingData || FALLBACK_PRICING;
    var html = '<p class="summary-empty">Alege datele în calendar și vezi instant prețul final al sejurului, cu reducerea aplicată automat.</p>';

    var tiers = (data.defaultDiscountTiers || []).filter(function(t){ return t.discount > 0; })
      .slice().sort(function(a,b){ return a.minNights - b.minNights; });
    if(tiers.length){
      var maxPct = tiers[tiers.length-1].discount || 1;
      html += '<div class="summary-block"><h4>Cu cât stai mai mult, cu atât economisești</h4><ul class="discount-ladder">';
      tiers.forEach(function(t, i){
        var label = t.minNights + (i === tiers.length-1 ? "+" : "") + " nopți";
        var w = Math.max(12, Math.round(t.discount / maxPct * 100));
        html += '<li><span class="dl-nights">' + label + '</span>' +
          '<span class="dl-bar" aria-hidden="true"><span style="width:' + w + '%"></span></span>' +
          '<b class="dl-pct">−' + t.discount + '%</b></li>';
      });
      html += '</ul></div>';
    }

    var todayT = stripTime(new Date()).getTime();
    var globalMin = getGlobalMinNights();
    var special = (data.seasons || []).filter(function(s){
      var e = parseISODay(s.end);
      return new Date(e.y, e.m, e.d).getTime() >= todayT && typeof s.minNights === "number" && s.minNights > globalMin;
    }).sort(function(a,b){ return a.start < b.start ? -1 : 1; }).slice(0, 3);
    if(special.length){
      html += '<div class="summary-block"><h4>Perioade de sărbători</h4><ul class="special-periods">';
      special.forEach(function(s){
        var noDiscount = !(s.discountTiers || []).some(function(t){ return t.discount > 0; });
        html += '<li><span>' + fmtSeasonRange(s) + '</span><span>minim ' + s.minNights + ' nopți' +
          (noDiscount ? ' · tarif fix' : '') + '</span></li>';
      });
      html += '</ul><p class="summary-note">Locurile de sărbători se ocupă primele — verifică acum disponibilitatea.</p></div>';
    }
    return html;
  }

  function updateSummary(){
    updateRateUI();
    renderSummary();
    updateQuickContact();
  }

  /* ---------- TARIF: NERAMBURSABIL / FLEXIBIL ----------
   * Flexibil = nerambursabil + 10%, anulare gratuită până cu 14 zile înainte de sosire. Oferit doar dacă toate
   * nopțile cad în sezoane „flexibil” (pricing.json → seasons[].cancellation, din coloana „Politică anulare” a
   * foii „Sezoane”) și sosirea e peste cel puțin 15 zile. Aceleași reguli în apps-script/rezervari.gs. */
  var FLEX_MARKUP_PCT = 10, FLEX_CANCEL_DAYS = 14, FLEX_MIN_LEAD_DAYS = 15;
  var rateNonref = document.getElementById("rateNonref");
  var rateFlex = document.getElementById("rateFlex");

  function seasonIsFlexible(s){
    if(typeof s.cancellation === "string") return s.cancellation.indexOf("flexibil") === 0;
    return (s.discountTiers || []).some(function(t){ return t.discount > 0; });
  }
  function flexTooSoon(ci){
    return Math.round((stripTime(ci) - today) / 86400000) < FLEX_MIN_LEAD_DAYS;
  }
  function flexAvailable(ci, co){
    if(!ci || !co || co <= ci || flexTooSoon(ci)) return false;
    for(var d = new Date(ci); d < co; d.setDate(d.getDate() + 1)){
      var s = getSeasonForDate(d);
      if(!s || !seasonIsFlexible(s)) return false;
    }
    return true;
  }
  function currentRate(ci, co){
    return rateFlex && rateFlex.checked && flexAvailable(ci, co) ? "flexibil" : "nerambursabil";
  }
  function totalForRate(base, rate){
    return rate === "flexibil" ? Math.round(base * (100 + FLEX_MARKUP_PCT) / 100) : base;
  }
  function flexDeadline(ci){
    return new Date(ci.getFullYear(), ci.getMonth(), ci.getDate() - FLEX_CANCEL_DAYS);
  }

  // Alegerea oaspetelui se păstrează: dacă alte date nu permit flexibil, revine la flexibil când e din nou posibil.
  var preferFlex = false;
  function updateRateUI(){
    if(!rateNonref || !rateFlex) return;
    var ci = selection.checkin, co = selection.checkout;
    var valid = ci && co && co > ci, avail = valid && flexAvailable(ci, co);
    rateFlex.disabled = valid && !avail;
    if(rateFlex.disabled) rateNonref.checked = true;
    else if(preferFlex) rateFlex.checked = true;
    var base = valid ? computeStay(ci, co).total : null;
    document.getElementById("rateNonrefPrice").textContent = valid ? base + " RON" : "";
    document.getElementById("rateFlexPrice").textContent = avail ? totalForRate(base, "flexibil") + " RON" : "";
    document.getElementById("rateHint").textContent = !valid ? ""
      : avail ? "La tariful flexibil, anularea e gratuită până pe " + fmtDate(flexDeadline(ci)) + "."
      : flexTooSoon(ci) ? "Tariful flexibil e disponibil doar pentru sosirile peste cel puțin " + FLEX_MIN_LEAD_DAYS + " zile."
      : "Tariful flexibil nu e disponibil de sărbători (Crăciun, Revelion).";
  }
  [rateNonref, rateFlex].forEach(function(el){
    if(el) el.addEventListener("change", function(){
      preferFlex = rateFlex.checked;
      track("tarif-ales", { tarif: rateFlex.checked ? "flexibil" : "nerambursabil" });
      updateSummary();
    });
  });

  /* ---------- CONTACT RAPID + TOTAL LÂNGĂ BUTON + BARA DE JOS (mobil) ---------- */
  var WA_NUMBER = "40744332234";
  var formTotalEl = document.getElementById("formTotal");
  var stickyBtn = document.getElementById("mobileStickyBtn");

  // Mesaj WhatsApp precompletat cu datele și oaspeții aleși (dacă există).
  function whatsappHref(){
    var ci = selection.checkin, co = selection.checkout, msg;
    if(ci && co && co > ci){
      var n = Math.round((co - ci) / 86400000);
      msg = "Bună ziua! Aș dori să rezerv A13 Travel Concept pentru " + fmtDate(ci) + " – " + fmtDate(co) +
            " (" + n + " " + nightsWord(n) + ", " + guestsLabel(getGuests()) +
            (currentRate(ci, co) === "flexibil" ? ", tarif flexibil" : "") + "). Este disponibil?";
    } else {
      msg = "Bună ziua! Aș dori informații despre rezervarea apartamentului A13 Travel Concept.";
    }
    return "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(msg);
  }

  function updateQuickContact(){
    var href = whatsappHref();
    // Toate linkurile WhatsApp au același mesaj (și același nume accesibil) — Lighthouse: „Identical links have the same purpose”
    ["formWhatsApp", "mobileStickyWa", "footWhatsApp"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.href = href;
    });

    var ci = selection.checkin, co = selection.checkout, html = "", validTotal = null;
    if(ci && co && co > ci){
      var stay = computeStay(ci, co), minNights = getMinNightsForDate(ci);
      if(stay.nights < minNights){
        html = '<span class="form-total-warn">Sejur minim ' + minNights + ' nopți pentru aceste date — alege un interval mai lung.</span>';
      } else if(hasBlockedBetween(ci, co)){
        html = '<span class="form-total-warn">Intervalul include zile ocupate sau fără tarif — alege alte date.</span>';
      } else {
        var rate = currentRate(ci, co);
        validTotal = totalForRate(stay.total, rate);
        var direct = getDirectSaving(ci, co, validTotal);
        html = '<span class="form-total-dates">' + fmtDate(ci) + ' – ' + fmtDate(co) + ' · ' + stay.nights + ' ' + nightsWord(stay.nights) + ' · ' + guestsLabel(getGuests()) + '</span>' +
               '<span class="form-total-sum">Total ' + validTotal + ' RON</span>' +
               '<span class="form-total-note">taxe locale incluse' + (stay.discountPct > 0 ? ' · reducere −' + stay.discountPct + '%' : '') +
               ' · tarif ' + (rate === "flexibil" ? 'flexibil' : 'nerambursabil') + '</span>' +
               (direct ? '<span class="form-total-save"><span>Direct economisești</span> <strong>' + savingAmountText(direct) + '</strong> <span>față de platformele de rezervări</span></span>' : '');
      }
    }
    // Pe mobil rezumatul e sub formular: totalul apare și chiar deasupra politicii și a butonului.
    if(formTotalEl){
      formTotalEl.innerHTML = html;
      formTotalEl.classList.toggle("is-empty", !html);
    }
    if(stickyBtn){
      stickyBtn.textContent = validTotal !== null ? "Continuă rezervarea · " + validTotal + " RON" : "Verifică disponibilitatea";
      stickyBtn.setAttribute("href", validTotal !== null ? "#rezervare" : "#disponibilitate");
    }
  }

  // Bara de jos dispare cât timp butonul de trimitere e pe ecran (nu-l mai acoperă și nu se dublează).
  var stickyBar = document.getElementById("mobileStickyCta");
  var submitRowEl = document.querySelector("#bookingForm .submit-row");
  if(stickyBar && submitRowEl && "IntersectionObserver" in window){
    new IntersectionObserver(function(entries){
      stickyBar.classList.toggle("is-hidden", entries[entries.length - 1].isIntersecting);
    }).observe(submitRowEl);
  }

  function renderSummary(){
    var ci = selection.checkin, co = selection.checkout;

    if(!ci || !co || co <= ci){
      summaryBody.innerHTML = buildSummaryIntro();
      rangeHint.innerHTML = 'Alege datele direct din <a href="#disponibilitate" class="hint-link">calendarul de disponibilitate</a> de mai sus — zilele ocupate sunt blocate automat.';
      rangeHint.style.color = "";
      return;
    }

    var conflict = hasBlockedBetween(ci, co);
    var stay = computeStay(ci, co);
    var minNights = getMinNightsForDate(ci);

    if(stay.nights < minNights){
      summaryBody.innerHTML =
        '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
        '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>' +
        '<p class="summary-empty" style="color:var(--red);margin-top:10px;">Sejur minim ' + minNights + ' nopți.</p>';
      rangeHint.textContent = "Sejurul minim acceptat este de " + minNights + " nopți. Alege un interval mai lung.";
      rangeHint.style.color = "var(--red)";
      return;
    }

    var guests = getGuests();
    var rows =
      '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
      '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>' +
      '<div class="summary-row"><span>Oaspeți</span><span>' + guestsLabel(guests) + '</span></div>';

    if(stay.discountPct > 0){
      rows +=
        '<div class="discount-badge">🎉 Reducere -' + stay.discountPct + '% pentru ' + stay.nights + ' nopți' +
          (stay.fullPriceNights ? ' (fără ' + (stay.fullPriceNights === 1 ? 'noaptea' : 'cele ' + stay.fullPriceNights + ' nopți') + ' de sărbători)' : '') + '</div>' +
        '<div class="summary-row"><span>' + stay.nights + ' nopți × ' + stay.avgPerNight + ' RON</span><span class="price-strike">' + stay.rawTotal + ' RON</span></div>' +
        '<div class="summary-row"><span>Preț cu reducere</span><span>' + stay.total + ' RON</span></div>';
    } else {
      rows +=
        '<div class="summary-row"><span>' + stay.nights + ' nopți × ' + stay.avgPerNight + ' RON</span><span>' + stay.total + ' RON</span></div>';
    }
    var rate = currentRate(ci, co), finalTotal = totalForRate(stay.total, rate);
    if(rate === "flexibil"){
      rows += '<div class="summary-row"><span>Tarif flexibil (+' + FLEX_MARKUP_PCT + '%)</span><span>+' + (finalTotal - stay.total) + ' RON</span></div>';
    }
    rows += '<div class="summary-row"><span>Tarif</span><span>' + (rate === "flexibil" ? "Flexibil" : "Nerambursabil") + '</span></div>';
    rows += '<div class="summary-row total"><span>Total</span><span>' + finalTotal + ' RON</span></div>';

    var direct = conflict ? null : getDirectSaving(ci, co, finalTotal);
    if(direct){
      rows +=
        '<div class="summary-save">' +
          '<span class="summary-save-label">Direct economisești</span>' +
          '<strong>' + savingAmountText(direct) + '</strong>' +
          '<span>față de platformele de rezervări online, unde același sejur costă ' +
            (direct.isRange ? 'între ~' + direct.otaFrom + ' și ~' + direct.otaTo : 'de la ~' + direct.otaFrom) + '\u00a0RON.</span>' +
          '<small>Prețuri verificate' + (direct.checkedAt ? ' la ' + direct.checkedAt : '') + ', cu reducerile automate ale platformelor (inclusiv pentru mobil). ' +
          (rate === "flexibil"
            ? 'Tariful direct ales are anulare gratuită până pe ' + fmtDate(flexDeadline(ci)) + '.'
            : 'Pe platforme, unele tarife includ anulare gratuită; tariful direct ales e nerambursabil.') + '</small>' +
        '</div>';
    }

    var tx = computeTaxes(guests.adults, stay.nights);
    var calcTxt = function(rate){
      return rate + ' RON × ' + guests.adults + ' ' + adultsWord(guests.adults) + ' × ' + stay.nights + ' ' + nightsWord(stay.nights);
    };
    rows +=
      '<div class="summary-taxes" aria-label="Taxe locale incluse în preț">' +
        '<h4>Taxe incluse în preț</h4>' +
        '<div class="summary-row"><span>Taxă turistică<span class="tax-calc">' + calcTxt(TAX_TOURIST) + '</span></span><span>' + tx.tourist + ' RON</span></div>' +
        '<div class="summary-row"><span>Taxă Salvamont<span class="tax-calc">' + calcTxt(TAX_SALVAMONT) + '</span></span><span>' + tx.salvamont + ' RON</span></div>' +
        '<p>Taxele se aplică doar adulților și sunt deja incluse în total — nu se plătesc suplimentar.</p>' +
      '</div>';

    summaryBody.innerHTML = rows;

    if(conflict){
      rangeHint.textContent = "Atenție: intervalul selectat include zile ocupate sau fără tarif definit. Alege alte date.";
      rangeHint.style.color = "var(--red)";
    } else if(stay.discountPct > 0){
      rangeHint.textContent = stay.nights + " nopți selectate — ai economisit " + (stay.rawTotal - stay.total) + " RON cu reducerea de -" + stay.discountPct + "%.";
      rangeHint.style.color = "var(--green)";
    } else {
      rangeHint.textContent = stay.nights + " nopți selectate — total " + stay.total + " RON.";
      rangeHint.style.color = "var(--green)";
    }
  }

  syncFormFromSelection();

  /* ---------- SUBMIT (Google Apps Script, cu rezerva mailto) ---------- */
  var form = document.getElementById("bookingForm");
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var name = document.getElementById("fname").value.trim();
    var phone = document.getElementById("fphone").value.trim();
    var email = document.getElementById("femail").value.trim();
    var ciDate = selection.checkin, coDate = selection.checkout;
    var msgEl = document.getElementById("formMsg");

    if(!name || !phone || !email || !ciDate || !coDate){
      msgEl.textContent = "Completează toate câmpurile și alege datele din calendar pentru a trimite solicitarea.";
      msgEl.className = "form-msg show warn";
      track("formular-incomplet", { faraDate: !ciDate || !coDate });
      return;
    }
    if(coDate <= ciDate){
      msgEl.textContent = "Data de check-out trebuie să fie după data de check-in.";
      msgEl.className = "form-msg show warn";
      return;
    }
    if(hasBlockedBetween(ciDate, coDate)){
      msgEl.textContent = "Intervalul selectat include zile ocupate sau fără tarif definit. Te rugăm alege alte date.";
      msgEl.className = "form-msg show warn";
      return;
    }
    var minNights = getMinNightsForDate(ciDate);
    var checkNights = Math.round((coDate - ciDate) / 86400000);
    if(checkNights < minNights){
      msgEl.textContent = "Sejurul minim acceptat este de " + minNights + " nopți.";
      msgEl.className = "form-msg show warn";
      return;
    }

    var adultsRaw = selAdults ? parseInt(selAdults.value, 10) : NaN;
    var childrenRaw = selChildren ? parseInt(selChildren.value, 10) : 0;
    if(isNaN(adultsRaw) || adultsRaw < 1 || adultsRaw > MAX_ADULTS ||
       isNaN(childrenRaw) || childrenRaw < 0 || childrenRaw > MAX_CHILDREN || adultsRaw + childrenRaw > MAX_GUESTS){
      msgEl.textContent = "Capacitatea maximă este de " + MAX_GUESTS + " persoane (adulți și copii).";
      msgEl.className = "form-msg show warn";
      return;
    }
    var guests = getGuests();

    var ci = toInputValue(ciDate), co = toInputValue(coDate);
    var stay = computeStay(ciDate, coDate);
    var tx = computeTaxes(guests.adults, stay.nights);
    var rate = currentRate(ciDate, coDate);

    var payload = {
      name: name, phone: phone, email: email,
      checkin: ci, checkout: co, nights: stay.nights,
      adults: guests.adults, children: guests.children,
      rawTotal: stay.rawTotal, discountPct: stay.discountPct, total: totalForRate(stay.total, rate),
      rate: rate, cancelBy: rate === "flexibil" ? toInputValue(flexDeadline(ciDate)) : "",
      taxTourist: tx.tourist, taxSalvamont: tx.salvamont,
      source: VISIT_SOURCE.label, referrer: VISIT_SOURCE.referrer,
      website: document.getElementById("fwebsite") ? document.getElementById("fwebsite").value : ""
    };

    if(!BOOKING_ENDPOINT){ openMailto(payload, msgEl); return; }

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    var btnLabel = submitBtn.textContent;
    submitBtn.textContent = "Se trimite…";
    msgEl.className = "form-msg";

    // text/plain = cerere „simpla” (fara preflight CORS), compatibila cu Apps Script
    fetch(BOOKING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    })
      .then(function(res){ return res.json(); })
      .then(function(res){
        if(res && res.ok){
          msgEl.textContent = "Mulțumim, " + name + "! Solicitarea a fost trimisă. Ți-am trimis o confirmare a primirii pe " + email + " și îți răspundem în cel mult 2 ore (între 08:00 și 22:00).";
          msgEl.className = "form-msg show ok";
          form.querySelectorAll("#fname, #fphone, #femail").forEach(function(el){ el.value = ""; });
          track("solicitare-trimisa", { nopti: stay.nights, total: payload.total, tarif: rate, sursa: VISIT_SOURCE.label });
        } else if(res && res.error === "rate_limit"){
          msgEl.textContent = "Am primit deja mai multe solicitări de la această adresă. Te rugăm să încerci din nou peste o oră sau să ne contactezi telefonic.";
          msgEl.className = "form-msg show warn";
          track("solicitare-limita");
        } else {
          throw new Error((res && res.error) || "send_failed");
        }
      })
      .catch(function(){
        // Rezerva: nu pierdem solicitarea — deschidem clientul de e-mail precompletat
        openMailto(payload, msgEl, true);
      })
      .then(function(){
        submitBtn.disabled = false;
        submitBtn.textContent = btnLabel;
      });
  });

  function openMailto(p, msgEl, afterError){
    track(afterError ? "solicitare-mailto-dupa-eroare" : "solicitare-mailto", { nopti: p.nights, total: p.total, tarif: p.rate, sursa: p.source });
    var subject = "Solicitare rezervare A13 Travel Concept — " + p.checkin + " → " + p.checkout;
    var body =
      "Solicitare nouă de rezervare — A13 Travel Concept (Silver Mountain, Poiana Brașov)\n\n" +
      "Nume: " + p.name + "\n" +
      "Telefon: " + p.phone + "\n" +
      "Email: " + p.email + "\n\n" +
      "Check-in: " + p.checkin + "\n" +
      "Check-out: " + p.checkout + "\n" +
      "Nopți: " + p.nights + "\n" +
      "Adulți: " + p.adults + "\n" +
      "Copii: " + p.children + "\n\n" +
      "Preț de bază: " + p.rawTotal + " RON\n" +
      (p.discountPct > 0 ? "Reducere aplicată: -" + p.discountPct + "%\n" : "") +
      (p.rate === "flexibil" ? "Tarif flexibil: +" + FLEX_MARKUP_PCT + "% (anulare gratuită până pe " + p.cancelBy + ")\n" : "Tarif: nerambursabil\n") +
      "Total: " + p.total + " RON\n\n" +
      "Taxe incluse în total (doar adulți):\n" +
      "- Taxă turistică: " + TAX_TOURIST + " RON × " + p.adults + " × " + p.nights + " = " + p.taxTourist + " RON\n" +
      "- Taxă Salvamont: " + TAX_SALVAMONT + " RON × " + p.adults + " × " + p.nights + " = " + p.taxSalvamont + " RON\n\n" +
      "Sursa vizitei: " + p.source + "\n";

    window.location.href = "mailto:" + CONTACT_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    msgEl.textContent = (afterError ? "Nu am putut trimite automat solicitarea. " : "") +
      "Se deschide clientul tău de email cu solicitarea precompletată. Trimite mesajul pentru a finaliza cererea.";
    msgEl.className = "form-msg show " + (afterError ? "warn" : "ok");
  }

  /* ---------- MOBILE MENU ---------- */
  var menuToggle = document.getElementById("menuToggle");
  var mobileNav = document.getElementById("mobileNav");
  menuToggle.addEventListener("click", function(){
    var open = mobileNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  /* ---------- SMOOTH SCROLL NAV (evita navigarea de pagina la #hash) ---------- */
  // #footMail are href="#rezervare" doar ca rezerva fara JS; handlerul lui (mailto) nu trebuie blocat aici.
  document.querySelectorAll('a[href^="#"]:not(#footMail)').forEach(function(a){
    a.addEventListener("click", function(e){
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if(target){
        e.preventDefault();
        e.stopPropagation();
        if(e.stopImmediatePropagation) e.stopImmediatePropagation();
        mobileNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        target.scrollIntoView({behavior:"smooth", block:"start"});
      }
    }, true);
  });

  /* ---------- FUNDALURI „ZONA” LA NEVOIE ----------
   * Pozele de fundal din #zona (~300 KB, jumătate din pagină) sunt mult sub primul ecran:
   * data-lazy-style (cardurile) se aplică și data-lazy-bg (secțiunea → clasa .bg-ready) abia când se apropie de ecran. */
  (function(){
    var lazyBgs = document.querySelectorAll("[data-lazy-style], [data-lazy-bg]");
    function applyBg(el){
      if(el.hasAttribute("data-lazy-style")){
        el.setAttribute("style", el.getAttribute("data-lazy-style"));
        el.removeAttribute("data-lazy-style");
      }
      if(el.hasAttribute("data-lazy-bg")){
        el.classList.add("bg-ready");
        el.removeAttribute("data-lazy-bg");
      }
    }
    if(!("IntersectionObserver" in window)){
      Array.prototype.forEach.call(lazyBgs, applyBg);
      return;
    }
    var bgObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){ applyBg(entry.target); bgObserver.unobserve(entry.target); }
      });
    }, { rootMargin: "600px 0px" });
    Array.prototype.forEach.call(lazyBgs, function(el){ bgObserver.observe(el); });
  })();

  /* ---------- GALERIE FOTO ----------
   * Pozele vin din images/gallery.json ({ "categorie": ["01-nume-descriptiv-...", ...] }, generat de optimize-images.cjs).
   * Mozaic: poza principală + până la 6 miniaturi (desktop: 3 coloane × 2 rânduri alături; ecrane mici: dedesubt);
   * la mai multe poze, ultima miniatură arată „+N” și deschide galeria completă (lightbox). */
  // label = tab (scurt, să încapă pe un rând pe desktop); title = titlul din galeria mărită
  var GALLERY = [
    { key:"living",             label:"Living & bucătărie", title:"Living & bucătărie" },
    { key:"terasa-living",      label:"Terasă",             title:"Terasa livingului" },
    { key:"dormitor-mare",      label:"Dormitor mare",      title:"Dormitorul mare" },
    { key:"baie-dormitor-mare", label:"Baie mare",          title:"Baia dormitorului mare" },
    { key:"dormitor-mic",       label:"Dormitor mic",       title:"Dormitorul mic" },
    { key:"baie-dormitor-mic",  label:"Baie mică",          title:"Baia dormitorului mic" },
    { key:"balcon-dormitoare",  label:"Balcon",             title:"Balconul dormitoarelor" }
  ];
  // Ordinea din „Toate”: primele 7 se văd în mozaic (prima = poza principală); restul urmează în ordinea categoriilor.
  var GALLERY_FEATURED = [
    "living/01-living-semineu-canapea-fotolii-a13-poiana-brasov",
    "dormitor-mare/01-dormitor-mare-pat-dublu-fereastra-padure-a13-poiana-brasov",
    "terasa-living/01-terasa-living-vedere-padure-brazi-a13-poiana-brasov",
    "living/03-bucatarie-utilata-espressor-plita-cuptor-a13-poiana-brasov",
    "dormitor-mic/01-dormitor-mic-pat-dublu-usa-balcon-a13-poiana-brasov",
    "baie-dormitor-mare/01-baie-dormitor-mare-cada-lavoar-a13-poiana-brasov",
    "balcon-dormitoare/01-balcon-inchis-dormitoare-vedere-padure-a13-poiana-brasov"
  ];
  /* Texte alternative (SEO + accesibilitate), cheia = „categorie/nume fișier fără extensie”.
   * Poză nouă fără text aici → alt generic. Dacă gallery.json nu se încarcă, galeria se construiește din aceste chei. */
  var GALLERY_ALTS = {
    "living/01-living-semineu-canapea-fotolii-a13-poiana-brasov":
      "Living cu șemineu, fotolii, canapea și ieșire pe terasă, apartament A13 Travel Concept, Poiana Brașov",
    "living/02-living-open-space-bucatarie-scara-a13-poiana-brasov":
      "Living open-space cu masă de dining, bucătărie și scara spre dormitoare, apartament duplex A13 Silver Mountain",
    "living/03-bucatarie-utilata-espressor-plita-cuptor-a13-poiana-brasov":
      "Bucătărie complet utilată cu espressor, microunde, plită, cuptor și mașină de spălat vase, apartament A13",
    "terasa-living/01-terasa-living-vedere-padure-brazi-a13-poiana-brasov":
      "Terasă cu masă și fotolii, cu vedere spre pădurea de brazi, apartament A13 Travel Concept, Poiana Brașov",
    "terasa-living/02-terasa-living-fotolii-masa-umbrela-a13-poiana-brasov":
      "Terasa livingului cu fotolii, masă, scaune și umbrelă, complex Silver Mountain, Poiana Brașov",
    "dormitor-mare/01-dormitor-mare-pat-dublu-fereastra-padure-a13-poiana-brasov":
      "Dormitor mare cu pat dublu, prosoape pregătite și fereastră spre pădure, apartament A13 Poiana Brașov",
    "dormitor-mare/02-dormitor-mare-pat-tv-birou-usa-balcon-a13-poiana-brasov":
      "Dormitor mare cu pat dublu, TV, birou și ieșire pe balcon, apartament A13 Travel Concept, Silver Mountain",
    "dormitor-mare/03-dormitor-mare-pat-dublu-baie-proprie-a13-poiana-brasov":
      "Dormitor mare cu pat dublu și baie proprie, apartament A13 Travel Concept, Silver Mountain",
    "dormitor-mare/04-dormitor-mare-acces-baie-dressing-a13-poiana-brasov":
      "Dormitor mare văzut de sus, cu acces la baia proprie și la dressing, apartament A13 Poiana Brașov",
    "baie-dormitor-mare/01-baie-dormitor-mare-cada-lavoar-a13-poiana-brasov":
      "Baia dormitorului mare, cu cadă, lavoar pe blat și oglindă iluminată, apartament A13 Poiana Brașov",
    "baie-dormitor-mare/02-baie-dormitor-mare-cada-toaleta-suspendata-a13-poiana-brasov":
      "Baie cu cadă, toaletă suspendată, uscător de prosoape și produse de toaletă, apartament A13 Travel Concept",
    "dormitor-mic/01-dormitor-mic-pat-dublu-usa-balcon-a13-poiana-brasov":
      "Dormitor mic cu pat dublu și ușă spre balconul cu vedere la pădure, apartament A13 Silver Mountain",
    "dormitor-mic/02-dormitor-mic-pat-matrimonial-tablou-a13-poiana-brasov":
      "Al doilea dormitor, cu pat matrimonial, noptiere și prosoape pregătite, apartament A13 Travel Concept",
    "dormitor-mic/03-dormitor-mic-baie-cu-dus-a13-poiana-brasov":
      "Intrarea în dormitorul mic, cu baia cu duș și patul dublu, apartament A13 Poiana Brașov",
    "dormitor-mic/04-dormitor-mic-pat-dublu-tv-a13-poiana-brasov":
      "Dormitor mic cu pat dublu și TV pe perete, cazare în regim hotelier Silver Mountain, Poiana Brașov",
    "baie-dormitor-mic/01-baie-dormitor-mic-cabina-dus-a13-poiana-brasov":
      "Baia dormitorului mic, cu cabină de duș și lavoar, apartament A13 Travel Concept, Poiana Brașov",
    "baie-dormitor-mic/02-baie-dormitor-mic-dus-lavoar-oglinda-a13-poiana-brasov":
      "Baie modernă cu cabină de duș, lavoar și oglindă, apartament A13 Silver Mountain",
    "balcon-dormitoare/01-balcon-inchis-dormitoare-vedere-padure-a13-poiana-brasov":
      "Balcon închis între dormitoare, cu vedere spre pădurea de brazi, apartament A13 Travel Concept"
  };
  var GAL_MAX_TILES = 7;
  var GAL_MAIN_SIZES = "(min-width:900px) 460px, 100vw";
  var GAL_THUMB_SIZES = "(min-width:900px) 210px, 34vw";
  var galTabsEl = document.getElementById("galTabs");
  var galGridEl = document.getElementById("galGrid");
  var galPhotos = [];      // în ordinea categoriilor: { key, name, label }
  var galAll = [];         // ordinea din „Toate”
  var galFilter = "all";

  function galFile(p, suffix, ext){ return "images/" + p.key + "/" + p.name + (suffix || "") + ext; }
  function galAlt(p){
    return GALLERY_ALTS[p.key + "/" + p.name] || (p.title + " – apartament A13 Travel Concept, Silver Mountain, Poiana Brașov");
  }
  function galList(){
    return galFilter === "all" ? galAll : galPhotos.filter(function(p){ return p.key === galFilter; });
  }

  // manifest = { "living": ["01-...", ...], ... } (numerele vechi 1, 2… sunt acceptate și ele)
  function buildGallery(manifest){
    if(!manifest){
      manifest = {};
      Object.keys(GALLERY_ALTS).forEach(function(id){
        var parts = id.split("/");
        (manifest[parts[0]] = manifest[parts[0]] || []).push(parts[1]);
      });
    }
    galPhotos = [];
    GALLERY.forEach(function(cat){
      (manifest[cat.key] || []).forEach(function(name){
        galPhotos.push({ key:cat.key, name:String(name), label:cat.label, title:cat.title });
      });
    });
    var byId = {};
    galPhotos.forEach(function(p){ byId[p.key + "/" + p.name] = p; });
    galAll = GALLERY_FEATURED.map(function(id){ return byId[id]; }).filter(Boolean);
    galPhotos.forEach(function(p){ if(galAll.indexOf(p) === -1) galAll.push(p); });
    var openBtn = document.getElementById("openGalleryBtn");
    if(openBtn && galAll.length) openBtn.textContent = "🖼️ Vezi toate cele " + galAll.length + " fotografii";
    renderGalleryTabs();
    renderGallery();
  }

  function renderGalleryTabs(){
    var tabs = [{ key:"all", label:"Toate", count:galAll.length }];
    GALLERY.forEach(function(cat){
      var n = galPhotos.filter(function(p){ return p.key === cat.key; }).length;
      if(n) tabs.push({ key:cat.key, label:cat.label, count:n });
    });
    galTabsEl.innerHTML = "";
    tabs.forEach(function(t){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "gal-tab" + (t.key === galFilter ? " active" : "");
      b.setAttribute("aria-pressed", t.key === galFilter ? "true" : "false");
      b.innerHTML = escapeHtml(t.label) + ' <span class="gal-count">' + t.count + "</span>";
      b.addEventListener("click", function(){
        galFilter = t.key;
        galTabsEl.querySelectorAll(".gal-tab").forEach(function(x){
          var on = x === b;
          x.classList.toggle("active", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        renderGallery();
      });
      galTabsEl.appendChild(b);
    });
  }

  function renderGallery(){
    var list = galList();
    var shown = list.slice(0, GAL_MAX_TILES);
    var more = list.length - shown.length;
    galGridEl.className = "gal-mosaic gal-n" + shown.length;
    galGridEl.innerHTML = "";
    if(!shown.length){
      galGridEl.innerHTML = '<div class="gal-empty">Fotografiile nu au putut fi încărcate momentan.</div>';
      return;
    }
    shown.forEach(function(p, i){
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "gal-tile" + (i === 0 ? " gal-main" : "");
      var img = document.createElement("img");
      img.alt = galAlt(p);
      img.loading = "lazy";
      img.decoding = "async";
      img.width = 600; img.height = 400;
      img.sizes = i === 0 ? GAL_MAIN_SIZES : GAL_THUMB_SIZES;
      img.srcset = galFile(p, "-600", ".webp") + " 600w, " + galFile(p, "", ".webp") + " 1024w";
      img.src = galFile(p, "-600", ".webp");
      img.onerror = function(){
        // WebP lipsă (încă negenerat de workflow) → JPG-ul original
        img.onerror = null;
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.src = galFile(p, "", ".jpg");
      };
      tile.appendChild(img);
      if(i === shown.length - 1 && more > 0){
        var badge = document.createElement("span");
        badge.className = "gal-more";
        badge.innerHTML = "<b>+" + more + "</b> fotografii";
        tile.appendChild(badge);
      }
      tile.addEventListener("click", function(){ openLightbox(list, i); });
      galGridEl.appendChild(tile);
    });
  }

  if(galTabsEl && galGridEl){
    afterHeroShown(function(){
      fetch("images/gallery.json", {cache:"no-cache"})
        .then(function(r){ if(!r.ok) throw new Error("gallery.json " + r.status); return r.json(); })
        .then(function(m){ buildGallery(m); })
        .catch(function(){ buildGallery(null); });
    });
  }

  document.getElementById("openGalleryBtn").addEventListener("click", function(){
    document.getElementById("galerie").scrollIntoView({behavior:"smooth", block:"start"});
  });

  /* LIGHTBOX — lista curentă (filtrul activ), săgeți, tastatură (← → Esc) și glisare pe telefon */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxTitle = document.getElementById("lightboxTitle");
  var lightboxCounter = document.getElementById("lightboxCounter");
  var lightboxCaption = document.getElementById("lightboxCaption");
  var lbList = [], lbIndex = 0;

  function openLightbox(list, index){
    lbList = list; lbIndex = index;
    renderLightbox();
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
    document.body.classList.add("lightbox-open");
  }
  function closeLightbox(){
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
    document.body.classList.remove("lightbox-open");
  }
  function renderLightbox(){
    var p = lbList[lbIndex];
    if(!p) return;
    lightboxImg.onerror = function(){
      lightboxImg.onerror = null;
      lightboxImg.src = galFile(p, "", ".jpg");
    };
    lightboxImg.alt = galAlt(p);
    lightboxImg.src = galFile(p, "", ".webp");
    lightboxTitle.textContent = p.title;
    if(lightboxCaption) lightboxCaption.textContent = galAlt(p);
    lightboxCounter.textContent = (lbIndex + 1) + " / " + lbList.length;
    var next = lbList[(lbIndex + 1) % lbList.length];
    if(next && next !== p) (new Image()).src = galFile(next, "", ".webp");
  }
  function stepLightbox(d){
    if(!lbList.length) return;
    lbIndex = (lbIndex + d + lbList.length) % lbList.length;
    renderLightbox();
  }
  document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function(e){ if(e.target === lightbox) closeLightbox(); });
  document.getElementById("lightboxPrev").addEventListener("click", function(){ stepLightbox(-1); });
  document.getElementById("lightboxNext").addEventListener("click", function(){ stepLightbox(1); });
  document.addEventListener("keydown", function(e){
    if(!lightbox.classList.contains("open")) return;
    if(e.key === "ArrowLeft") stepLightbox(-1);
    else if(e.key === "ArrowRight") stepLightbox(1);
    else if(e.key === "Escape") closeLightbox();
  });
  var lbTouchX = null;
  lightboxImg.addEventListener("touchstart", function(e){ lbTouchX = e.touches[0].clientX; }, {passive:true});
  lightboxImg.addEventListener("touchend", function(e){
    if(lbTouchX === null) return;
    var dx = e.changedTouches[0].clientX - lbTouchX;
    lbTouchX = null;
    if(Math.abs(dx) > 40) stepLightbox(dx < 0 ? 1 : -1);
  }, {passive:true});

  /* ---------- RECENZII (Google / Booking.com / Airbnb / Travelminit) ---------- */
  var REVIEWS_JSON = "reviews.json"; // regenerat periodic (Google auto, Booking/Airbnb manual)
  var reviewsData = null;
  var reviewsFilter = "all";
  var reviewsActiveDot = 0;

  var PLATFORM_META = {
    google:  { label:"Google",       badge:"G", cls:"rp-google",  scale:5  },
    booking: { label:"Booking.com",  badge:"B", cls:"rp-booking", scale:10 },
    airbnb:  { label:"Airbnb",       badge:"A", cls:"rp-airbnb",  scale:5  },
    travelminit: { label:"Travelminit", badge:"T", cls:"rp-travelminit", scale:10 }
  };

  var reviewsSummaryEl = document.getElementById("reviewsSummary");
  var reviewsTabsEl = document.getElementById("reviewsTabs");
  var reviewsTrackEl = document.getElementById("reviewsTrack");
  var reviewsDotsEl = document.getElementById("reviewsDots");
  var reviewsPrevBtn = document.getElementById("reviewsPrev");
  var reviewsNextBtn = document.getElementById("reviewsNext");

  function loadReviews(){
    if(!reviewsSummaryEl || !reviewsTrackEl) return; // sectiunea nu exista in aceasta pagina
    fetch(REVIEWS_JSON, {cache:"no-store"})
      .then(function(res){ if(!res.ok) throw new Error("missing"); return res.json(); })
      .then(function(data){ reviewsData = data; initReviewsUI(); })
      .catch(function(){
        reviewsSummaryEl.innerHTML = '<span style="color:var(--gray);font-size:.85rem;">Recenziile nu au putut fi încărcate momentan.</span>';
      });
  }

  function starString(rating, scale){
    var pct = Math.max(0, Math.min(1, rating / scale));
    var filled = Math.round(pct * 5);
    var out = "";
    for(var i=0;i<5;i++) out += (i < filled) ? "★" : "☆";
    return out;
  }

  function fmtReviewDate(iso){
    // "YYYY-MM" = platforma afiseaza doar luna (Airbnb, Google)
    if(/^\d{4}-\d{2}$/.test(iso || "")){
      var p = iso.split("-");
      return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString("ro-RO", { month:"long", year:"numeric" });
    }
    try{
      return new Date(iso).toLocaleDateString("ro-RO", { day:"2-digit", month:"short", year:"numeric" });
    } catch(e){ return iso || ""; }
  }

  // Pastilele cu nota pe platforme: click = filtrează recenziile AICI, pe site; săgeata ↗ (secundară)
  // deschide pagina de recenzii a platformei. Ordonate după numărul de recenzii.
  function renderReviewsSummary(){
    var platforms = (reviewsData && reviewsData.platforms) || {};
    var withText = {};
    ((reviewsData && reviewsData.reviews) || []).forEach(function(r){ withText[r.platform] = true; });
    var keys = Object.keys(PLATFORM_META)
      .filter(function(k){ return platforms[k] && platforms[k].totalReviews; })
      .sort(function(a, b){ return platforms[b].totalReviews - platforms[a].totalReviews; });
    var html = "";
    keys.forEach(function(key){
      var p = platforms[key], meta = PLATFORM_META[key];
      var scale = p.scaleMax || meta.scale;
      var score = String(p.rating).replace(".", ",");
      var countTxt = p.totalReviews + (p.totalReviews === 1 ? " recenzie" : " recenzii");
      var label = meta.label + ": " + score + " din " + scale + ", " + countTxt;
      var inner =
        '<span class="rp-badge ' + meta.cls + '" aria-hidden="true">' + meta.badge + '</span>' +
        '<span class="rp-name">' + meta.label + '</span>' +
        '<span class="rp-score">' + score + '/' + scale + '</span>' +
        '<span class="rp-count">' + countTxt + '</span>';
      var main = withText[key]
        ? '<button type="button" class="rp-main" data-platform="' + key + '" aria-pressed="' + (reviewsFilter === key) + '" aria-label="' + label + '. Arată recenziile de pe ' + meta.label + '">' + inner + '</button>'
        : '<span class="rp-main" aria-label="' + label + '">' + inner + '</span>';
      var extUrl = p.reviewsUrl || p.url;
      var ext = extUrl
        ? '<a class="rp-ext" href="' + extUrl + '" target="_blank" rel="noopener" aria-label="Vezi recenziile pe ' + meta.label + ' (se deschide într-o fereastră nouă)">↗</a>'
        : '';
      html += '<div class="review-platform-pill' + (reviewsFilter === key ? ' is-active' : '') + '">' + main + ext + '</div>';
    });
    reviewsSummaryEl.innerHTML = html || '<span style="color:var(--gray);font-size:.85rem;">Recenziile apar aici după prima sincronizare.</span>';
    reviewsSummaryEl.querySelectorAll("button.rp-main").forEach(function(btn){
      btn.addEventListener("click", function(){
        var key = btn.getAttribute("data-platform");
        setReviewsFilter(reviewsFilter === key ? "all" : key);
      });
    });
  }

  function setReviewsFilter(key){
    reviewsFilter = key;
    renderReviewsSummary();
    renderReviewsTabs();
    renderReviewsTrack();
    track("recenzii-filtru", { platforma: key });
  }

  function renderReviewsTabs(){
    var reviews = (reviewsData && reviewsData.reviews) || [];
    var present = {};
    reviews.forEach(function(r){ present[r.platform] = true; });

    var tabs = [{ key:"all", label:"Toate" }];
    Object.keys(PLATFORM_META).forEach(function(key){
      if(present[key]) tabs.push({ key:key, label:PLATFORM_META[key].label });
    });

    reviewsTabsEl.innerHTML = "";
    tabs.forEach(function(tab){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reviews-tab" + (tab.key === reviewsFilter ? " active" : "");
      btn.setAttribute("role", "tab");
      btn.textContent = tab.label;
      btn.addEventListener("click", function(){ setReviewsFilter(tab.key); });
      reviewsTabsEl.appendChild(btn);
    });
  }

  function getFilteredReviews(){
    var reviews = (reviewsData && reviewsData.reviews) || [];
    return reviewsFilter === "all" ? reviews : reviews.filter(function(r){ return r.platform === reviewsFilter; });
  }

  function renderReviewsTrack(){
    var list = getFilteredReviews();
    reviewsActiveDot = 0;

    if(!list.length){
      reviewsTrackEl.innerHTML = '<p class="summary-empty" style="padding:10px 4px;">Nicio recenzie de pe această platformă momentan.</p>';
      reviewsDotsEl.innerHTML = "";
      return;
    }

    reviewsTrackEl.innerHTML = list.map(function(r){
      var meta = PLATFORM_META[r.platform] || { badge:"?", cls:"", label:"" };
      var platformInfo = (reviewsData && reviewsData.platforms && reviewsData.platforms[r.platform]) || {};
      var scale = platformInfo.scaleMax || meta.scale || 5;
      var scoreLabel = scale === 10 ? (r.rating + "/10") : starString(r.rating, scale);
      var scoreAria = "Notă " + r.rating + " din " + scale;
      var platformName = platformInfo.label || meta.label || "";
      var moreUrl = platformInfo.reviewsUrl || platformInfo.url || "";

      // etichete sejur (doar date reale de pe platformă)
      var tags = [];
      if(r.tripType) tags.push(r.tripType);
      if(r.travelerType) tags.push(r.travelerType);
      if(r.nights) tags.push(typeof r.nights === "number" ? (r.nights === 1 ? "1 noapte" : r.nights + " nopți") : r.nights);
      var tagsHtml = tags.length
        ? '<ul class="review-tags" aria-label="Detalii sejur">' + tags.map(function(t){ return '<li>' + escapeHtml(String(t)) + '</li>'; }).join("") + '</ul>'
        : "";

      // note pe categorii date de oaspete (doar unde platforma le publică per recenzie, ex. Google)
      var catsHtml = (r.categories && r.categories.length)
        ? '<ul class="review-cats" aria-label="Note pe categorii">' + r.categories.map(function(c){
            return '<li><span>' + escapeHtml(c.label) + '</span><b>' + c.score + '/' + scale + '</b></li>';
          }).join("") + '</ul>'
        : "";

      var langAttr = r.lang ? ' lang="' + escapeHtml(r.lang) + '"' : "";
      var titleLang = r.titleLang || r.lang;
      var titleHtml = r.title
        ? '<p class="review-title"' + (titleLang ? ' lang="' + escapeHtml(titleLang) + '"' : "") + '>„' + escapeHtml(r.title) + '”</p>'
        : "";
      var moreHtml = moreUrl
        ? '<a class="review-more" href="' + escapeHtml(moreUrl) + '" target="_blank" rel="noopener">Citește recenzia pe ' + escapeHtml(platformName) + ' <span aria-hidden="true">↗</span></a>'
        : "";

      return (
        '<article class="review-card">' +
          '<div class="review-card-top">' +
            '<span class="review-platform">' +
              '<span class="rp-badge ' + meta.cls + '" aria-hidden="true">' + meta.badge + '</span>' +
              '<span class="review-platform-name">' + escapeHtml(platformName) + '</span>' +
            '</span>' +
            '<span class="review-stars" role="img" aria-label="' + scoreAria + '">' + scoreLabel + '</span>' +
          '</div>' +
          titleHtml +
          tagsHtml +
          '<div class="review-body">' +
            '<p class="review-text"' + langAttr + '>' + escapeHtml(r.text || "") + '</p>' +
            moreHtml +
          '</div>' +
          catsHtml +
          '<div class="review-card-bottom">' +
            '<span class="review-author">' + escapeHtml(r.author || "Oaspete") + '</span>' +
            '<span>' + fmtReviewDate(r.date) + (r.translated ? ' · tradus automat' : '') + '</span>' +
          '</div>' +
        '</article>'
      );
    }).join("");
    markLongReviews();

    reviewsDotsEl.innerHTML = list.map(function(_, i){
      return '<button type="button" class="review-dot' + (i === 0 ? " active" : "") + '" aria-label="Recenzia ' + (i+1) + '"></button>';
    }).join("");

    reviewsDotsEl.querySelectorAll(".review-dot").forEach(function(dot, i){
      dot.addEventListener("click", function(){ scrollToReviewCard(i); });
    });
  }

  function escapeHtml(str){
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function reviewCardStep(){
    var card = reviewsTrackEl.querySelector(".review-card");
    if(!card) return 300;
    var style = window.getComputedStyle(reviewsTrackEl);
    var gap = parseFloat(style.gap) || 16;
    return card.getBoundingClientRect().width + gap;
  }

  function scrollToReviewCard(index){
    var list = getFilteredReviews();
    if(!list.length) return;
    reviewsActiveDot = Math.max(0, Math.min(list.length - 1, index));
    reviewsTrackEl.scrollTo({ left: reviewsActiveDot * reviewCardStep(), behavior:"smooth" });
    updateActiveDot();
  }

  function updateActiveDot(){
    reviewsDotsEl.querySelectorAll(".review-dot").forEach(function(dot, i){
      dot.classList.toggle("active", i === reviewsActiveDot);
    });
  }

  if(reviewsPrevBtn) reviewsPrevBtn.addEventListener("click", function(){ scrollToReviewCard(reviewsActiveDot - 1); });
  if(reviewsNextBtn) reviewsNextBtn.addEventListener("click", function(){ scrollToReviewCard(reviewsActiveDot + 1); });

  if(reviewsTrackEl){
    var reviewsScrollTimer = null;
    reviewsTrackEl.addEventListener("scroll", function(){
      clearTimeout(reviewsScrollTimer);
      reviewsScrollTimer = setTimeout(function(){
        var step = reviewCardStep();
        reviewsActiveDot = Math.round(reviewsTrackEl.scrollLeft / step);
        updateActiveDot();
      }, 120);
    });
  }

  /* Texte trunchiate (line-clamp) → afișează linkul „Citește recenzia pe …” */
  function markLongReviews(){
    if(!reviewsTrackEl) return;
    reviewsTrackEl.querySelectorAll(".review-card").forEach(function(card){
      var txt = card.querySelector(".review-text");
      if(!txt) return;
      card.classList.toggle("is-long", txt.scrollHeight > txt.clientHeight + 2);
    });
  }
  var reviewsResizeTimer = null;
  window.addEventListener("resize", function(){
    clearTimeout(reviewsResizeTimer);
    reviewsResizeTimer = setTimeout(markLongReviews, 200);
  });

  /* Medii pe categorii (Booking publică doar media proprietății, nu nota fiecărui oaspete) */
  function renderReviewsCategories(){
    if(!reviewsSummaryEl) return;
    var old = document.getElementById("reviewsCats");
    if(old) old.parentNode.removeChild(old);
    var platforms = (reviewsData && reviewsData.platforms) || {};
    var key = Object.keys(PLATFORM_META).find(function(k){
      return platforms[k] && platforms[k].categories && platforms[k].categories.length;
    });
    if(!key) return;
    var p = platforms[key];
    var meta = PLATFORM_META[key];
    var scale = p.scaleMax || meta.scale;
    var box = document.createElement("div");
    box.className = "reviews-cats";
    box.id = "reviewsCats";
    box.innerHTML =
      '<p class="reviews-cats-head">Note pe categorii · <span>media ' + escapeHtml(p.label || meta.label) +
        (p.totalReviews ? ', ' + p.totalReviews + ' evaluări' : '') + '</span></p>' +
      '<ul class="reviews-cats-grid">' + p.categories.map(function(c){
        var pct = Math.max(0, Math.min(100, c.score / scale * 100));
        return '<li><span class="rc-label">' + escapeHtml(c.label) + '</span>' +
          '<span class="rc-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
          '<span class="rc-score">' + String(c.score).replace(".", ",") + '</span></li>';
      }).join("") + '</ul>';
    reviewsSummaryEl.parentNode.insertBefore(box, reviewsSummaryEl.nextSibling);
  }

  // Nota din primul ecran: platforma cu cele mai multe recenzii + totalul recenziilor (duce la #recenzii).
  function renderHeroRating(){
    var el = document.getElementById("heroRating");
    if(!el || !reviewsData || !reviewsData.platforms) return;
    var best = null, total = 0, count = 0;
    Object.keys(reviewsData.platforms).forEach(function(k){
      var p = reviewsData.platforms[k];
      if(!p || !p.totalReviews) return;
      total += p.totalReviews; count++;
      if(!best || p.totalReviews > best.p.totalReviews) best = { k:k, p:p };
    });
    if(!best) return;
    var meta = PLATFORM_META[best.k] || { label:best.k, scale:10 };
    var scale = best.p.scaleMax || meta.scale;
    var score = String(best.p.rating).replace(".", ",");
    el.innerHTML = '<span class="hr-star" aria-hidden="true">★</span><span class="hr-score">' + score + '/' + scale + '</span> pe ' + meta.label +
                   ' <span class="hr-sep" aria-hidden="true">·</span> ' + total + ' recenzii pe ' + count + ' platforme';
    el.setAttribute("aria-label", "Notă " + score + " din " + scale + " pe " + meta.label + ", " + total + " recenzii pe " + count + " platforme. Vezi recenziile");
    el.hidden = false;
  }

  function initReviewsUI(){
    renderHeroRating();
    renderReviewsSummary();
    renderReviewsCategories();
    renderReviewsTabs();
    renderReviewsTrack();
  }

  /* ---------- FOOTER: butonul E-mail deschide adresa publică a firmei ---------- */
  var footMail = document.getElementById("footMail");
  if (footMail) {
    footMail.addEventListener("click", function(e){
      e.preventDefault();
      window.location.href = "mailto:" + PUBLIC_EMAIL + "?subject=" + encodeURIComponent("Întrebare A13 Travel Concept");
    });
  }

  /* ---------- INIT ---------- */
  afterHeroShown(function(){
    loadPricing();
    loadCalendar();
    loadReviews();
  });
})();
