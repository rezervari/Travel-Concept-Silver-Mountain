(function(){
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- CONFIG ---------- */
  var CONTACT_EMAIL = "mircea.george.vulcanescu@gmail.com";
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

  function setStatus(msg, isError){
    calStatusEl.innerHTML = '<span class="dot"></span> ' + msg;
    calStatusEl.className = "cal-status" + (isError ? " error" : "");
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

  function getMinBasePrice(){
    var data = pricingData || FALLBACK_PRICING;
    var prices = [data.defaultPrice];
    (data.seasons || []).forEach(function(s){ prices.push(s.price); });
    return Math.min.apply(null, prices.filter(function(p){ return typeof p === "number"; }));
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
    var h4 = document.createElement("h4");
    h4.textContent = MONTH_NAMES[month] + " " + year;
    wrap.appendChild(h4);

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

      if(past){
        cell.classList.add("past");
      } else if(booked){
        cell.classList.add("booked");
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

  function renderCalendar(){
    var host = document.getElementById("calMonths");
    host.innerHTML = "";
    host.appendChild(buildMonthEl(viewYear, viewMonth));
    var nextM = viewMonth+1, nextY = viewYear;
    if(nextM > 11){ nextM = 0; nextY++; }
    host.appendChild(buildMonthEl(nextY, nextM));
  }

  function hasBookedBetween(a,b){
    var d = new Date(a);
    while(d < b){
      if(isDateBooked(d)) return true;
      d.setDate(d.getDate()+1);
    }
    return false;
  }

  function handleDayClick(date){
    if(!selection.checkin || (selection.checkin && selection.checkout)){
      selection.checkin = date; selection.checkout = null;
    } else {
      if(date <= selection.checkin){
        selection.checkin = date; selection.checkout = null;
      } else if(hasBookedBetween(selection.checkin, date)){
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

  document.getElementById("calPrev").addEventListener("click", function(){
    viewMonth--; if(viewMonth<0){ viewMonth=11; viewYear--; }
    renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", function(){
    viewMonth++; if(viewMonth>11){ viewMonth=0; viewYear++; }
    renderCalendar();
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
  var openCalBtn = document.getElementById("openCalBtn");

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
  openCalBtn.addEventListener("click", openPopup);
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

  function updateSummary(){
    var ci = selection.checkin, co = selection.checkout;

    if(!ci || !co || co <= ci){
      var minPrice = getMinBasePrice();
      summaryBody.innerHTML =
        '<p class="summary-empty">Prețul pornește de la <b>' + minPrice + ' RON/noapte</b>. ' +
        'Alege datele de check-in și check-out pentru a vedea prețul exact al sejurului, cu reducerea aplicată automat.</p>';
      rangeHint.innerHTML = 'Alege datele direct din <a href="#disponibilitate" class="hint-link">calendarul de disponibilitate</a> de mai sus — zilele ocupate sunt blocate automat.';
      rangeHint.style.color = "";
      return;
    }

    var conflict = hasBookedBetween(ci, co);
    var stay = computeStay(ci, co);
    var minNights = getGlobalMinNights();

    if(stay.nights < minNights){
      summaryBody.innerHTML =
        '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
        '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>' +
        '<p class="summary-empty" style="color:var(--red);margin-top:10px;">Sejur minim ' + minNights + ' nopți.</p>';
      rangeHint.textContent = "Sejurul minim acceptat este de " + minNights + " nopți. Alege un interval mai lung.";
      rangeHint.style.color = "var(--red)";
      return;
    }

    var rows =
      '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
      '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>';

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

    summaryBody.innerHTML = rows;

    if(conflict){
      rangeHint.textContent = "Atenție: intervalul selectat include zile deja ocupate. Alege alte date.";
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
    if(hasBookedBetween(ciDate, coDate)){
      msgEl.textContent = "Intervalul selectat include zile deja ocupate. Te rugăm alege alte date.";
      msgEl.className = "form-msg show warn";
      return;
    }
    var minNights = getGlobalMinNights();
    var checkNights = Math.round((coDate - ciDate) / 86400000);
    if(checkNights < minNights){
      msgEl.textContent = "Sejurul minim acceptat este de " + minNights + " nopți.";
      msgEl.className = "form-msg show warn";
      return;
    }

    var ci = toInputValue(ciDate), co = toInputValue(coDate);
    var stay = computeStay(ciDate, coDate);

    var subject = "Solicitare rezervare A13 Travel Concept — " + ci + " → " + co;
    var body =
      "Solicitare nouă de rezervare — A13 Travel Concept (Silver Mountain, Poiana Brașov)\n\n" +
      "Nume: " + name + "\n" +
      "Telefon: " + phone + "\n" +
      "Email: " + email + "\n\n" +
      "Check-in: " + ci + "\n" +
      "Check-out: " + co + "\n" +
      "Nopți: " + stay.nights + "\n" +
      "Preț de bază: " + stay.rawTotal + " RON\n" +
      (stay.discountPct > 0 ? "Reducere aplicată: -" + stay.discountPct + "%\n" : "") +
      "Total: " + stay.total + " RON\n";

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
        if(id === "disponibilitate"){
          openPopup();
          return;
        }
        target.scrollIntoView({behavior:"smooth", block:"start"});
      }
    }, true);
  });

  /* ---------- RECENZII (Google / Booking / Airbnb) ---------- */
  var REVIEWS_JSON = "reviews.json";
  var reviewsData = null;
  var reviewsFiltered = [];
  var reviewsIndex = 0;
  var reviewsAutoplayTimer = null;

  var reviewsSummaryEl = document.getElementById("reviewsSummary");
  var reviewsTabsEl = document.getElementById("reviewsTabs");
  var reviewsTrackEl = document.getElementById("reviewsTrack");
  var reviewsDotsEl = document.getElementById("reviewsDots");
  var reviewsPrevBtn = document.getElementById("reviewsPrev");
  var reviewsNextBtn = document.getElementById("reviewsNext");

  var PLATFORM_ICON = { google:"G", booking:"B.com", airbnb:"🅰️" };

  function escapeHtml(str){
    return String(str == null ? "" : str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  function loadReviews(){
    if(!reviewsTrackEl) return; // sectiunea nu exista in pagina
    fetch(REVIEWS_JSON, {cache:"no-store"})
      .then(function(res){ if(!res.ok) throw new Error("missing"); return res.json(); })
      .then(function(data){
        reviewsData = data;
        renderReviewsSummary();
        renderReviewsTabs("all");
      })
      .catch(function(){
        reviewsTrackEl.innerHTML = '<p class="summary-empty">Recenziile nu au putut fi încărcate momentan.</p>';
      });
  }

  function starString(rating, scaleMax){
    var r5 = scaleMax === 10 ? rating / 2 : rating;
    var full = Math.round(r5);
    var s = "";
    for(var i=0;i<5;i++){ s += (i < full ? "★" : "☆"); }
    return s;
  }

  function renderReviewsSummary(){
    if(!reviewsData || !reviewsSummaryEl) return;
    var html = "";
    Object.keys(reviewsData.platforms).forEach(function(key){
      var p = reviewsData.platforms[key];
      html += '<a class="review-platform-pill" href="' + (p.url || "#") + '" target="_blank" rel="noopener">' +
        '<span class="rp-badge rp-' + key + '">' + PLATFORM_ICON[key] + '</span>' +
        '<span class="rp-score">' + p.rating + (p.scaleMax === 10 ? "/10" : "/5") + '</span>' +
        '<span class="rp-count">' + p.totalReviews + ' recenzii</span>' +
        '</a>';
    });
    reviewsSummaryEl.innerHTML = html;
  }

  function renderReviewsTabs(activeKey){
    if(!reviewsData || !reviewsTabsEl) return;
    var keys = ["all"].concat(Object.keys(reviewsData.platforms));
    reviewsTabsEl.innerHTML = "";
    keys.forEach(function(key){
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reviews-tab" + (key === activeKey ? " active" : "");
      btn.textContent = key === "all" ? "Toate" : reviewsData.platforms[key].label;
      btn.setAttribute("role","tab");
      btn.addEventListener("click", function(){
        renderReviewsTabs(key);
        setReviewsFilter(key);
      });
      reviewsTabsEl.appendChild(btn);
    });
    if(!reviewsFiltered.length || activeKey !== undefined) setReviewsFilter(activeKey);
  }

  function setReviewsFilter(key){
    if(!reviewsData) return;
    reviewsFiltered = key === "all" ? reviewsData.reviews.slice() :
      reviewsData.reviews.filter(function(r){ return r.platform === key; });
    reviewsFiltered.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
    reviewsIndex = 0;
    renderReviewsTrack();
  }

  function fmtReviewDate(iso){
    var d = new Date(iso);
    return d.toLocaleDateString("ro-RO", { day:"2-digit", month:"short", year:"numeric" });
  }

  function renderReviewsTrack(){
    if(!reviewsTrackEl) return;
    if(!reviewsFiltered.length){
      reviewsTrackEl.innerHTML = '<p class="summary-empty">Nu există recenzii pentru această platformă încă.</p>';
      reviewsDotsEl.innerHTML = "";
      return;
    }
    reviewsTrackEl.innerHTML = reviewsFiltered.map(function(r){
      var p = reviewsData.platforms[r.platform];
      return '<div class="review-card">' +
        '<div class="review-card-top">' +
          '<span class="rp-badge rp-' + r.platform + '">' + PLATFORM_ICON[r.platform] + '</span>' +
          '<span class="review-stars">' + starString(r.rating, p.scaleMax) + '</span>' +
        '</div>' +
        '<p class="review-text">' + escapeHtml(r.text) + '</p>' +
        '<div class="review-card-bottom">' +
          '<span class="review-author">' + escapeHtml(r.author) + '</span>' +
          '<span class="review-date">' + fmtReviewDate(r.date) + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    reviewsDotsEl.innerHTML = reviewsFiltered.map(function(_, i){
      return '<button type="button" class="review-dot' + (i===0 ? " active" : "") + '" aria-label="Recenzia ' + (i+1) + '"></button>';
    }).join("");
    Array.prototype.forEach.call(reviewsDotsEl.querySelectorAll(".review-dot"), function(dot, i){
      dot.addEventListener("click", function(){ goToReview(i); });
    });

    goToReview(0);
  }

  function goToReview(i){
    if(!reviewsFiltered.length) return;
    reviewsIndex = (i + reviewsFiltered.length) % reviewsFiltered.length;
    var card = reviewsTrackEl.children[reviewsIndex];
    if(card){
      reviewsTrackEl.scrollTo({ left: card.offsetLeft - reviewsTrackEl.offsetLeft, behavior:"smooth" });
    }
    Array.prototype.forEach.call(reviewsDotsEl.querySelectorAll(".review-dot"), function(dot, idx){
      dot.classList.toggle("active", idx === reviewsIndex);
    });
  }

  if(reviewsPrevBtn) reviewsPrevBtn.addEventListener("click", function(){ goToReview(reviewsIndex - 1); });
  if(reviewsNextBtn) reviewsNextBtn.addEventListener("click", function(){ goToReview(reviewsIndex + 1); });

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

    for(var i=1;i<=cat.max;i++){
      (function(catKey, index){
        var thumb = document.createElement("div");
        thumb.className = "gal-thumb";
        var img = document.createElement("img");
        img.src = imgSrc(catKey, index);
        img.alt = cat.label + " " + index;
        img.loading = "lazy";
        img.onload = function(){
          galFound[catKey].push(img.src);
          thumb.addEventListener("click", function(){
            openLightbox(catKey, galFound[catKey].indexOf(img.src));
          });
        };
        img.onerror = function(){ thumb.remove(); checkEmpty(catKey); };
        thumb.appendChild(img);
        document.getElementById("gal-panel-" + catKey).appendChild(thumb);
      })(cat.key, i);
    }
  });

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
    lightboxImg.src = list[lbIndex];
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

  /* ---------- INIT ---------- */
  loadPricing();
  loadCalendar();
  loadReviews();
  loadReviews();
})();
