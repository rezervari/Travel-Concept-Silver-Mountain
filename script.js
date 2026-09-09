(function(){
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ---------- CONFIG ---------- */
  var CONTACT_EMAIL = "mircea.george.vulcanescu@gmail.com";
  var BOOKED_JSON = "booked-dates.json"; // generat periodic de update-calendar.js
  var PRICING_JSON = "pricing.json"; // editezi doar acest fisier pentru schimbari de pret/sezon

  var bookedRanges = []; // [{start:Date, end:Date}] end este exclusiv (ca in ICS)
  var calStatusEl = document.getElementById("calStatus");

  /* fallback folosit doar daca pricing.json lipseste sau esueaza la incarcare */
  var pricingData = {
    currency: "RON",
    defaultPrice: 800,
    globalMinNights: 2,
    defaultDiscountTiers: [{ minNights: 2, discount: 0 }],
    seasons: []
  };

  function loadPricing(){
    return fetch(PRICING_JSON, {cache:"no-store"})
      .then(function(res){
        if(!res.ok) throw new Error("missing");
        return res.json();
      })
      .then(function(data){
        pricingData = data;
      })
      .catch(function(){
        console.warn("Nu am putut incarca pricing.json, folosesc tariful implicit.");
      });
  }

  function toISO(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

  function findSeasonForDate(date){
    var iso = toISO(date);
    for(var i=0;i<(pricingData.seasons||[]).length;i++){
      var s = pricingData.seasons[i];
      if(iso >= s.start && iso <= s.end) return s;
    }
    return null;
  }

  function getPricingContext(checkInDate){
    var season = findSeasonForDate(checkInDate);
    return {
      basePrice: season ? season.price : pricingData.defaultPrice,
      tiers: (season && season.discountTiers) ? season.discountTiers : pricingData.defaultDiscountTiers,
      minNights: (season && season.minNights) ? season.minNights : (pricingData.globalMinNights || 1),
      label: season ? season.label : null
    };
  }

  function getDiscountForNights(nights, tiers){
    var sorted = tiers.slice().sort(function(a,b){ return a.minNights - b.minNights; });
    var applicable = 0;
    for(var i=0;i<sorted.length;i++){
      if(nights >= sorted[i].minNights) applicable = sorted[i].discount;
    }
    return applicable;
  }

  function calculateStayPrice(checkInDate, checkOutDate){
    var nights = Math.round((checkOutDate - checkInDate) / 86400000);
    if(nights <= 0) return { error: "Interval invalid", nights: nights };

    var ctx = getPricingContext(checkInDate);

    if(nights < ctx.minNights){
      return {
        error: "Sejur minim " + ctx.minNights + " nopti" + (ctx.label ? " in " + ctx.label : "") + ".",
        nights: nights,
        minNights: ctx.minNights
      };
    }

    var discountPercent = getDiscountForNights(nights, ctx.tiers);
    var pricePerNight = Math.round(ctx.basePrice * (1 - discountPercent/100));
    var total = pricePerNight * nights;

    return {
      nights: nights,
      basePrice: ctx.basePrice,
      discountPercent: discountPercent,
      pricePerNight: pricePerNight,
      total: total,
      label: ctx.label
    };
  }

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
      summaryBody.innerHTML = '<p class="summary-empty">Alege datele de check-in și check-out pentru a vedea prețul total.</p>';
      rangeHint.innerHTML = 'Alege datele direct din <a href="#disponibilitate" class="hint-link">calendarul de disponibilitate</a> de mai sus — zilele ocupate sunt blocate automat.';
      rangeHint.style.color = "";
      return;
    }

    var nights = Math.round((co - ci) / 86400000);
    var conflict = hasBookedBetween(ci, co);
    var pricing = calculateStayPrice(ci, co);

    if(conflict){
      summaryBody.innerHTML =
        '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
        '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>';
      rangeHint.textContent = "Atenție: intervalul selectat include zile deja ocupate. Alege alte date.";
      rangeHint.style.color = "var(--red)";
      return;
    }

    if(pricing.error){
      summaryBody.innerHTML =
        '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
        '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>';
      rangeHint.textContent = pricing.error;
      rangeHint.style.color = "var(--red)";
      return;
    }

    var grossTotal = pricing.basePrice * pricing.nights;
    var rows =
      '<div class="summary-row"><span>Check-in</span><span>' + fmtDate(ci) + '</span></div>' +
      '<div class="summary-row"><span>Check-out</span><span>' + fmtDate(co) + '</span></div>' +
      '<div class="summary-row"><span>' + pricing.nights + ' nopți × ' + pricing.basePrice + ' RON</span><span>' + grossTotal + ' RON</span></div>';

    if(pricing.discountPercent > 0){
      rows += '<div class="summary-row"><span>Discount sejur (' + pricing.discountPercent + '%)</span><span>−' + (grossTotal - pricing.total) + ' RON</span></div>';
    }

    rows += '<div class="summary-row total"><span>Total</span><span>' + pricing.total + ' RON</span></div>';
    summaryBody.innerHTML = rows;

    rangeHint.textContent = nights + " nopți selectate — total " + pricing.total + " RON.";
    rangeHint.style.color = "var(--green)";
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

    var pricing = calculateStayPrice(ciDate, coDate);
    if(pricing.error){
      msgEl.textContent = pricing.error;
      msgEl.className = "form-msg show warn";
      return;
    }

    var ci = toInputValue(ciDate), co = toInputValue(coDate);
    var nights = pricing.nights;

    var subject = "Solicitare rezervare A13 Travel Concept — " + ci + " → " + co;
    var body =
      "Solicitare nouă de rezervare — A13 Travel Concept (Silver Mountain, Poiana Brașov)\n\n" +
      "Nume: " + name + "\n" +
      "Telefon: " + phone + "\n" +
      "Email: " + email + "\n\n" +
      "Check-in: " + ci + "\n" +
      "Check-out: " + co + "\n" +
      "Nopți: " + nights + "\n" +
      "Tarif de bază/noapte: " + pricing.basePrice + " RON\n" +
      (pricing.discountPercent > 0 ? "Discount sejur: " + pricing.discountPercent + "%\n" : "") +
      "Preț/noapte după discount: " + pricing.pricePerNight + " RON\n" +
      "Total: " + pricing.total + " RON\n";

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

  /* ---------- INIT ---------- */
  loadCalendar();
  loadPricing().then(function(){ updateSummary(); });
})();
