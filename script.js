(function(){
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- CONFIG ---------- */
  var CONTACT_EMAIL = ["mircea.george.vulcanescu", "gmail.com"].join("@");
  var BOOKED_JSON = "booked-dates.json"; // generat periodic de update-calendar.js
  var PRICING_JSON = "pricing.json";     // tarife pe sezon + trepte de reducere

  // Fallback defensiv daca pricing.json nu poate fi incarcat
  var FALLBACK_PRICING = {
    currency: "RON",
    defaultPrice: 700,
    globalMinNights: 2,
    defaultDiscountTiers: [
      { minNights:2, discount:10 }, { minNights:3, discount:15 },
      { minNights:4, discount:20 }, { minNights:5, discount:25 },
      { minNights:6, discount:30 }, { minNights:7, discount:33 }
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
        var updated = data.updatedAt ? new Date(data.updatedAt).toLocaleString("ro-RO") : null;
        setStatus(updated ? "Disponibilitate actualizată: " + updated : "Disponibilitate încărcată.", false);
        renderCalendar();
      })
      .catch(function(){
        setStatus("Nu am găsit fișierul de disponibilitate. Rulează update-calendar.js pentru a-l genera.", true);
        renderCalendar();
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
      })
      .catch(function(){
        pricingData = FALLBACK_PRICING;
        renderTeaserPrice();
        updateSummary();
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

  function computeStay(ciDate, coDate){
    var nights = Math.round((coDate - ciDate) / 86400000);
    var rawTotal = 0;
    var d = new Date(ciDate);
    while(d < coDate){
      rawTotal += getNightPrice(d);
      d.setDate(d.getDate()+1);
    }
    var tiers = getDiscountTiers(ciDate);
    var pct = getDiscountPct(nights, tiers);
    var total = Math.round(rawTotal * (100 - pct) / 100);
    return {
      nights: nights,
      rawTotal: rawTotal,
      discountPct: pct,
      total: total,
      avgPerNight: Math.round(rawTotal / nights),
      avgPerNightDiscounted: Math.round(total / nights)
    };
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
      // Prima zi selectata devine check-in -> trebuie sa fie o noapte cu tarif definit
      if(!isDatePriced(date)) return;
      selection.checkin = date; selection.checkout = null;
    } else {
      if(date <= selection.checkin){
        if(!isDatePriced(date)) return;
        selection.checkin = date; selection.checkout = null;
      } else if(hasBlockedBetween(selection.checkin, date)){
        // Intervalul curent contine zile ocupate sau fara tarif -> pornim o noua selectie
        // doar daca noua zi e valida ca si check-in
        if(!isDatePriced(date)) return;
        selection.checkin = date; selection.checkout = null;
      } else {
        selection.checkout = date;
      }
    }
    syncFormFromSelection();
    renderCalendar();

    if(selection.checkin && selection.checkout){
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
  var MAX_ADULTS = 4, MAX_CHILDREN = 2;
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
    return {
      adults: clampInt(selAdults ? selAdults.value : 2, 1, MAX_ADULTS, 2),
      children: clampInt(selChildren ? selChildren.value : 0, 0, MAX_CHILDREN, 0)
    };
  }
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
    if(el) el.addEventListener("change", function(){ updateSummary(); });
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
        '<div class="discount-badge">🎉 Reducere -' + stay.discountPct + '% pentru ' + stay.nights + ' nopți</div>' +
        '<div class="summary-row"><span>' + stay.nights + ' nopți × ' + stay.avgPerNight + ' RON</span><span class="price-strike">' + stay.rawTotal + ' RON</span></div>' +
        '<div class="summary-row"><span>Preț cu reducere</span><span>' + stay.total + ' RON</span></div>';
    } else {
      rows +=
        '<div class="summary-row"><span>' + stay.nights + ' nopți × ' + stay.avgPerNight + ' RON</span><span>' + stay.total + ' RON</span></div>';
    }
    rows += '<div class="summary-row total"><span>Total</span><span>' + stay.total + ' RON</span></div>';

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

  /* ---------- SUBMIT (mailto) ---------- */
  document.getElementById("bookingForm").addEventListener("submit", function(e){
    e.preventDefault();
    var name = document.getElementById("fname").value.trim();
    var phone = document.getElementById("fphone").value.trim();
    var email = document.getElementById("femail").value.trim();
    var ciDate = selection.checkin, coDate = selection.checkout;
    var msgEl = document.getElementById("formMsg");

    if(!name || !phone || !email || !ciDate || !coDate){
      msgEl.textContent = "Completează toate câmpurile și alege datele din calendar pentru a trimite solicitarea.";
      msgEl.className = "form-msg show warn";
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
       isNaN(childrenRaw) || childrenRaw < 0 || childrenRaw > MAX_CHILDREN){
      msgEl.textContent = "Capacitatea maximă este de " + MAX_ADULTS + " adulți și " + MAX_CHILDREN + " copii.";
      msgEl.className = "form-msg show warn";
      return;
    }
    var guests = getGuests();

    var ci = toInputValue(ciDate), co = toInputValue(coDate);
    var stay = computeStay(ciDate, coDate);
    var tx = computeTaxes(guests.adults, stay.nights);

    var subject = "Solicitare rezervare A13 Travel Concept — " + ci + " → " + co;
    var body =
      "Solicitare nouă de rezervare — A13 Travel Concept (Silver Mountain, Poiana Brașov)\n\n" +
      "Nume: " + name + "\n" +
      "Telefon: " + phone + "\n" +
      "Email: " + email + "\n\n" +
      "Check-in: " + ci + "\n" +
      "Check-out: " + co + "\n" +
      "Nopți: " + stay.nights + "\n" +
      "Adulți: " + guests.adults + "\n" +
      "Copii: " + guests.children + "\n\n" +
      "Preț de bază: " + stay.rawTotal + " RON\n" +
      (stay.discountPct > 0 ? "Reducere aplicată: -" + stay.discountPct + "%\n" : "") +
      "Total: " + stay.total + " RON\n\n" +
      "Taxe incluse în total (doar adulți):\n" +
      "- Taxă turistică: " + TAX_TOURIST + " RON × " + guests.adults + " × " + stay.nights + " = " + tx.tourist + " RON\n" +
      "- Taxă Salvamont: " + TAX_SALVAMONT + " RON × " + guests.adults + " × " + stay.nights + " = " + tx.salvamont + " RON\n";

    var mailto = "mailto:" + CONTACT_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    window.location.href = mailto;


    msgEl.textContent = "Se deschide clientul tău de email cu solicitarea precompletată către " + CONTACT_EMAIL + ". Trimite mesajul pentru a finaliza cererea.";
    msgEl.className = "form-msg show ok";
  });

  /* ---------- MOBILE MENU ---------- */
  var menuToggle = document.getElementById("menuToggle");
  var mobileNav = document.getElementById("mobileNav");
  menuToggle.addEventListener("click", function(){
    var open = mobileNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  /* ---------- SMOOTH SCROLL NAV (evita navigarea de pagina la #hash) ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
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

  /* ---------- GALERIE FOTO ---------- */
  var GALLERY = [
    { key:"living",             label:"Living, luat masa & bucătărie", max:8 },
    { key:"dormitor-mare",      label:"Dormitor mare",                 max:8 },
    { key:"baie-mare",          label:"Baie – dormitor mare",          max:6 },
    { key:"dormitor-mic",       label:"Dormitor mic",                  max:8 },
    { key:"baie-mic",           label:"Baie – dormitor mic",           max:6 },
    { key:"terasa-living",      label:"Terasă living",                 max:6 },
    { key:"terasa-dormitoare",  label:"Terasă dormitoare",             max:6 }
  ];
  var galFound = {}; // key -> array de src incarcate cu succes
  var galTabsEl = document.getElementById("galTabs");
  var galGridEl = document.getElementById("galGrid");
  var activeCat = GALLERY[0].key;

  function imgSrc(key, i){ return "images/" + key + "/" + i + ".jpg"; }
  function imgWebp(key, i, suffix){ return "images/" + key + "/" + i + (suffix || "") + ".webp"; }
  var THUMB_SIZES = "(max-width:559px) 50vw, (max-width:819px) 33vw, (max-width:1079px) 25vw, 220px";
  var FIRST_SIZES = "(max-width:559px) 100vw, (max-width:819px) 66vw, (max-width:1079px) 50vw, 440px";

  /* Texte alternative (SEO + accesibilitate). Poze noi fără text aici primesc un alt generic. */
  var GALLERY_ALTS = {
    "living": {
      1: "Living cu canapea, fotolii și șemineu decorativ în apartamentul A13 Travel Concept din Poiana Brașov",
      2: "Living open-space cu zonă de luat masa și bucătărie, apartament A13 Silver Mountain",
      3: "Bucătărie complet utilată cu espressor, cuptor și plită, apartament A13 Travel Concept"
    },
    "dormitor-mare": {
      1: "Dormitor matrimonial cu pat dublu și fereastră spre pădure, apartament A13 Poiana Brașov",
      2: "Dormitor mare cu pat dublu și baie proprie, apartament A13 Travel Concept, Silver Mountain",
      3: "Dormitor mare cu pat dublu, TV și birou, cazare Silver Mountain Poiana Brașov",
      4: "Dormitor mare cu acces la baia privată, apartament A13 Travel Concept"
    },
    "baie-mare": {
      1: "Baie privată cu cadă, lavoar și oglindă iluminată, dormitorul mare, apartament A13",
      2: "Baie cu cadă, toaletă suspendată și uscător de prosoape, apartament A13 Poiana Brașov"
    },
    "dormitor-mic": {
      1: "Dormitor cu pat dublu și ușă spre balcon cu vedere la munte, apartament A13 Silver Mountain",
      2: "Al doilea dormitor cu pat matrimonial și prosoape pregătite, apartament A13 Travel Concept",
      3: "Dormitor mic cu pat dublu și TV, cazare în regim hotelier Poiana Brașov",
      4: "Dormitor cu baie privată cu duș, apartament A13 Travel Concept, Silver Mountain"
    },
    "baie-mic": {
      1: "Baie privată cu cabină de duș, dormitorul mic, apartament A13 Poiana Brașov",
      2: "Baie modernă cu duș și lavoar, apartament A13 Travel Concept, Silver Mountain"
    },
    "terasa-living": {
      1: "Terasă cu mobilier de exterior și vedere spre pădurea de brazi, apartament A13 Poiana Brașov",
      2: "Terasa livingului cu masă, fotolii și umbrelă, complex Silver Mountain Poiana Brașov"
    },
    "terasa-dormitoare": {
      1: "Balcon închis cu vedere spre pădure, lângă dormitoare, apartament A13 Travel Concept"
    }
  };
  function galAlt(cat, index){
    var byCat = GALLERY_ALTS[cat.key];
    return (byCat && byCat[index]) ||
      (cat.label + " – apartament A13 Travel Concept, Silver Mountain, Poiana Brașov (foto " + index + ")");
  }

  function galIndex(src){ return parseInt(src.split("/").pop(), 10) || 0; }

  function addThumb(cat, index){
    var catKey = cat.key;
    var thumb = document.createElement("div");
    thumb.className = "gal-thumb";
    var img = document.createElement("img");
    var usedWebp = true;
    img.alt = galAlt(cat, index);
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 600; img.height = 400;
    img.sizes = index === 1 ? FIRST_SIZES : THUMB_SIZES;
    img.srcset = imgWebp(catKey, index, "-600") + " 600w, " + imgWebp(catKey, index) + " 1024w";
    img.src = imgWebp(catKey, index, "-600");
    img.onload = function(){
      var full = usedWebp ? imgWebp(catKey, index) : imgSrc(catKey, index);
      galFound[catKey].push(full);
      galFound[catKey].sort(function(x, y){ return galIndex(x) - galIndex(y); });
      thumb.addEventListener("click", function(){
        openLightbox(catKey, galFound[catKey].indexOf(full));
      });
    };
    img.onerror = function(){
      if(usedWebp){
        /* fallback: WebP lipsă (încă negenerat) -> JPG original */
        usedWebp = false;
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.src = imgSrc(catKey, index);
        return;
      }
      thumb.remove(); checkEmpty(catKey);
    };
    thumb.appendChild(img);
    document.getElementById("gal-panel-" + catKey).appendChild(thumb);
  }

  /* manifest = { "living":[1,2,3], ... } generat de optimize-images.cjs; null -> sondare 1..max */
  function buildGallery(manifest){
    GALLERY.forEach(function(cat){
      galFound[cat.key] = [];

      var tab = document.createElement("button");
      tab.type = "button"; tab.className = "gal-tab" + (cat.key === activeCat ? " active" : "");
      tab.textContent = cat.label;
      tab.addEventListener("click", function(){ setActiveCat(cat.key); });
      galTabsEl.appendChild(tab);

      var panel = document.createElement("div");
      panel.className = "gal-panel" + (cat.key === activeCat ? " active" : "");
      panel.id = "gal-panel-" + cat.key;
      galGridEl.appendChild(panel);

      var list = [];
      if(manifest && Array.isArray(manifest[cat.key])){
        list = manifest[cat.key].filter(function(n){ return typeof n === "number" && n > 0; });
      } else {
        for(var i=1;i<=cat.max;i++) list.push(i);
      }
      list.forEach(function(index){ addThumb(cat, index); });
      if(list.length === 0) checkEmpty(cat.key);
    });
  }

  if(galTabsEl && galGridEl){
    fetch("images/gallery.json", {cache:"no-cache"})
      .then(function(r){ if(!r.ok) throw new Error("gallery.json " + r.status); return r.json(); })
      .then(function(m){ buildGallery(m); })
      .catch(function(){ buildGallery(null); });
  }

  function checkEmpty(key){
    var panel = document.getElementById("gal-panel-" + key);
    if(panel.children.length === 0){
      var empty = document.createElement("div");
      empty.className = "gal-empty";
      empty.innerHTML = "Adaugă poze în <code>images/" + key + "/1.jpg</code>, <code>2.jpg</code>… (până la " +
        (GALLERY.find(function(c){return c.key===key;}).max) + ")";
      panel.appendChild(empty);
    }
  }

  function setActiveCat(key){
    activeCat = key;
    galTabsEl.querySelectorAll(".gal-tab").forEach(function(t,idx){
      t.classList.toggle("active", GALLERY[idx].key === key);
    });
    galGridEl.querySelectorAll(".gal-panel").forEach(function(p){
      p.classList.toggle("active", p.id === "gal-panel-" + key);
    });
  }

  document.getElementById("openGalleryBtn").addEventListener("click", function(){
    document.getElementById("galerie").scrollIntoView({behavior:"smooth", block:"start"});
  });

  /* Hero preview: prima poza gasita din prima categorie disponibila */
  var heroImg = document.querySelector("#galleryHero img");
  heroImg.addEventListener("load", function(){}, {once:true});

  /* LIGHTBOX */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxTitle = document.getElementById("lightboxTitle");
  var lightboxCounter = document.getElementById("lightboxCounter");
  var lbCat = null, lbIndex = 0;

  function openLightbox(key, index){
    lbCat = key; lbIndex = index;
    renderLightbox();
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function renderLightbox(){
    var list = galFound[lbCat];
    var src = list[lbIndex];
    lightboxImg.onerror = function(){
      lightboxImg.onerror = null;
      if(/\.webp$/.test(src)) lightboxImg.src = src.replace(/\.webp$/, ".jpg");
    };
    var lbCatObj = GALLERY.find(function(c){return c.key===lbCat;});
    lightboxImg.alt = galAlt(lbCatObj, galIndex(src));
    lightboxImg.src = src;
    lightboxTitle.textContent = GALLERY.find(function(c){return c.key===lbCat;}).label;
    lightboxCounter.textContent = (lbIndex+1) + " / " + list.length;
  }
  document.getElementById("lightboxClose").addEventListener("click", function(){
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
  });
  lightbox.addEventListener("click", function(e){
    if(e.target === lightbox){
      lightbox.classList.remove("open");
      document.body.style.overflow = "";
    }
  });
  document.getElementById("lightboxPrev").addEventListener("click", function(){
    var list = galFound[lbCat];
    lbIndex = (lbIndex - 1 + list.length) % list.length;
    renderLightbox();
  });
  document.getElementById("lightboxNext").addEventListener("click", function(){
    var list = galFound[lbCat];
    lbIndex = (lbIndex + 1) % list.length;
    renderLightbox();
  });

  /* ---------- RECENZII (Google / Booking.com / Airbnb) ---------- */
  var REVIEWS_JSON = "reviews.json"; // regenerat periodic (Google auto, Booking/Airbnb manual)
  var reviewsData = null;
  var reviewsFilter = "all";
  var reviewsActiveDot = 0;

  var PLATFORM_META = {
    google:  { label:"Google",       badge:"G", cls:"rp-google",  scale:5  },
    booking: { label:"Booking.com",  badge:"B", cls:"rp-booking", scale:10 },
    airbnb:  { label:"Airbnb",       badge:"A", cls:"rp-airbnb",  scale:5  }
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
    try{
      return new Date(iso).toLocaleDateString("ro-RO", { day:"2-digit", month:"short", year:"numeric" });
    } catch(e){ return iso || ""; }
  }

  function renderReviewsSummary(){
    var platforms = (reviewsData && reviewsData.platforms) || {};
    var html = "";
    Object.keys(PLATFORM_META).forEach(function(key){
      var p = platforms[key];
      if(!p || !p.totalReviews) return;
      var meta = PLATFORM_META[key];
      var scale = p.scaleMax || meta.scale;
      var inner =
        '<span class="rp-badge ' + meta.cls + '">' + meta.badge + '</span>' +
        '<span class="rp-score">' + p.rating + '/' + scale + '</span>' +
        '<span class="rp-count">(' + p.totalReviews + ' recenzii)</span>';
      html += p.url
        ? '<a class="review-platform-pill" href="' + p.url + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<span class="review-platform-pill">' + inner + '</span>';
    });
    reviewsSummaryEl.innerHTML = html || '<span style="color:var(--gray);font-size:.85rem;">Recenziile apar aici după prima sincronizare.</span>';
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
      btn.addEventListener("click", function(){
        reviewsFilter = tab.key;
        reviewsTabsEl.querySelectorAll(".reviews-tab").forEach(function(b){ b.classList.remove("active"); });
        btn.classList.add("active");
        renderReviewsTrack();
      });
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
      var meta = PLATFORM_META[r.platform] || { badge:"?", cls:"" };
      var platformInfo = (reviewsData && reviewsData.platforms && reviewsData.platforms[r.platform]) || {};
      var scale = platformInfo.scaleMax || meta.scale || 5;
      var scoreLabel = scale === 10 ? (r.rating + "/10") : starString(r.rating, scale);
      return (
        '<article class="review-card">' +
          '<div class="review-card-top">' +
            '<span class="rp-badge ' + meta.cls + '">' + meta.badge + '</span>' +
            '<span class="review-stars">' + scoreLabel + '</span>' +
          '</div>' +
          '<p class="review-text">' + escapeHtml(r.text || "") + '</p>' +
          '<div class="review-card-bottom">' +
            '<span class="review-author">' + escapeHtml(r.author || "Oaspete") + '</span>' +
            '<span>' + fmtReviewDate(r.date) + '</span>' +
          '</div>' +
        '</article>'
      );
    }).join("");

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

  function initReviewsUI(){
    renderReviewsSummary();
    renderReviewsTabs();
    renderReviewsTrack();
  }

  /* ---------- FOOTER: e-mail ascuns, deschis doar la click ---------- */
  var footMail = document.getElementById("footMail");
  if (footMail) {
    footMail.addEventListener("click", function(e){
      e.preventDefault();
      window.location.href = "mailto:" + CONTACT_EMAIL + "?subject=" + encodeURIComponent("Întrebare A13 Travel Concept");
    });
  }

  /* ---------- INIT ---------- */
  loadPricing();
  loadCalendar();
  loadReviews();
})();
