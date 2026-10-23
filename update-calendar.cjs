#!/usr/bin/env node
// Regenereaza booked-dates.json din calendarele iCal ale platformelor (rulat periodic via GitHub Actions).
// Utilizare: node update-calendar.cjs
//
// Surse (linkurile iCal sunt SECRETE — se pun in GitHub > Settings > Secrets, nu in cod):
//   ICS_BOOKING, ICS_AIRBNB, ICS_TRAVELMINIT
// Daca niciun secret nu e setat, se foloseste calendarul Google public (sursa veche, mai lenta).
// Daca o sursa configurata nu raspunde, fisierul NU se modifica (mai bine date vechi decat zile ocupate afisate libere).
// Daca o sursa care avea evenimente viitoare trimite brusc un calendar GOL (raspuns valid, 0 evenimente — s-a
// intamplat cu Booking pe 23.10.2026), nu se sterge nimic: intervalele vechi raman, cele noi se adauga, iar rularea
// iese cu eroare pe GitHub (prin pasul final din workflow). Golirea reala (ex. toate rezervarile anulate) se accepta
// ruland manual workflow-ul cu allow_empty = numele sursei (ex. Booking) sau local cu CALENDAR_ALLOW_EMPTY=Booking.
// In booked-dates.json, "sources" = pentru fiecare sursa: cate evenimente viitoare a avut la ultima rulare si pana
// cand tine ultimul ("until"). Calendarul gol e suspect doar daca "until" e inca in viitor (o rezervare care s-a
// terminat normal nu declanseaza alarma).
// Fisierul se rescrie doar cand se schimba intervalele ocupate sau aceste date (fara commit-uri inutile).
//
// ICS_DIRECT = calendarul nostru „A13 Direct” (apps-script/calendar.gs): perioadele inchise din panou, rezervarile
// confirmate de pe site si platile asteptate. Pentru el un calendar gol e normal (nicio blocare), iar daca nu raspunde
// nu oprim restul: pastram intervalele viitoare existente si rularea apare ca esuata (notificare).

const fs = require("fs");
const path = require("path");

const GOOGLE_CALENDAR_ID = "ch4cifvuu7agfajplgrccculheveu7g6@import.calendar.google.com";
const GOOGLE_ICS_URL = "https://calendar.google.com/calendar/ical/" + encodeURIComponent(GOOGLE_CALENDAR_ID) + "/public/basic.ics";
const OUT_FILE = path.join(__dirname, "booked-dates.json");
const RETRY_DELAY_MS = Number(process.env.CALENDAR_RETRY_DELAY_MS || 5000);

const PLATFORM_SOURCES = [
  { name: "Booking", env: "ICS_BOOKING" },
  { name: "Airbnb", env: "ICS_AIRBNB" },
  { name: "Travelminit", env: "ICS_TRAVELMINIT" }
];
const OWN_SOURCE = { name: "Direct", env: "ICS_DIRECT", own: true };

// Data calendaristica (fara ora) -> miezul noptii UTC. Orele de check-in/out nu conteaza pentru calendar.
function parseICSDate(raw) {
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function parseICS(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const unfolded = [];
  for (const line of lines) {
    if ((line.charAt(0) === " " || line.charAt(0) === "\t") && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  const events = [];
  let cur = null;
  for (const line of unfolded) {
    if (line.indexOf("BEGIN:VEVENT") === 0) { cur = {}; continue; }
    if (line.indexOf("END:VEVENT") === 0) {
      if (cur && cur.start && !cur.cancelled) {
        // Fara DTEND (eveniment de o zi) -> o noapte
        const end = cur.end && cur.end > cur.start ? cur.end : new Date(cur.start.getTime() + 86400000);
        events.push({ start: cur.start, end, summary: cur.summary || "" });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    if (line.indexOf("DTSTART") === 0) cur.start = parseICSDate(line.split(":").pop());
    else if (line.indexOf("DTEND") === 0) cur.end = parseICSDate(line.split(":").pop());
    else if (line.indexOf("SUMMARY") === 0) cur.summary = line.slice(line.indexOf(":") + 1);
    else if (line.indexOf("STATUS:CANCELLED") === 0) cur.cancelled = true;
  }
  return events;
}

// Uneste intervalele suprapuse sau lipite (end exclusiv).
function mergeRanges(events) {
  const sorted = events.slice().sort((a, b) => a.start - b.start);
  const out = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.start <= last.end) {
      if (e.end > last.end) last.end = e.end;
    } else {
      out.push({ start: e.start, end: e.end });
    }
  }
  return out.map(r => ({ start: r.start.toISOString(), end: r.end.toISOString() }));
}

async function fetchICSOnce(url) {
  const res = await fetch(url, { headers: { "User-Agent": "A13-Travel-Concept-calendar-sync" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.indexOf("BEGIN:VCALENDAR") === -1) throw new Error("raspunsul nu este un calendar iCal");
  return text;
}

// O singura reincercare: Apps Script („A13 Direct”) a raspuns o data cu un 404 trecator (23.10.2026).
async function fetchICS(url, name) {
  try {
    return await fetchICSOnce(url);
  } catch (err) {
    console.log(name + ": " + err.message + " — reincerc peste " + RETRY_DELAY_MS / 1000 + " s");
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    return fetchICSOnce(url);
  }
}

async function main() {
  let sources = PLATFORM_SOURCES
    .filter(s => process.env[s.env] && process.env[s.env].trim())
    .map(s => ({ name: s.name, url: process.env[s.env].trim() }));
  if (!sources.length) {
    console.log("::warning::Niciun secret ICS_* setat — folosesc calendarul Google.");
    sources = [{ name: "Google Calendar", url: GOOGLE_ICS_URL }];
  }
  if (process.env[OWN_SOURCE.env] && process.env[OWN_SOURCE.env].trim()) {
    sources.push({ name: OWN_SOURCE.name, url: process.env[OWN_SOURCE.env].trim(), own: true });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let previousFile = null;
  try { previousFile = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); } catch (_) {}
  const previous = previousFile && Array.isArray(previousFile.ranges) ? previousFile.ranges : null;
  const previousFuture = (previous || []).filter(r => new Date(r.end) > today);
  const previousSources = (previousFile && previousFile.sources) || {};
  const allowEmpty = (process.env.CALENDAR_ALLOW_EMPTY || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const todayIso = today.toISOString().slice(0, 10);

  const all = [];
  const state = {};
  const emptied = []; // surse care aveau evenimente inca viitoare si acum trimit un calendar gol
  for (const s of sources) {
    let events;
    try {
      events = parseICS(await fetchICS(s.url, s.name));
    } catch (err) {
      // URL-ul nu se afiseaza niciodata in log (e secret)
      if (s.own) {
        console.error("::error title=Calendar " + s.name + "::" + s.name + " nu raspunde (" + err.message +
          ") — pastrez intervalele viitoare existente; celelalte surse se actualizeaza.");
        emptied.push(s.name);
        if (previousSources[s.name]) state[s.name] = previousSources[s.name];
        continue;
      }
      console.error("::error title=Calendar " + s.name + "::Eroare la " + s.name + ": " + err.message + " — booked-dates.json ramane neschimbat.");
      process.exit(1);
    }
    const future = events.filter(e => e.end > today);
    console.log(s.name + ": " + events.length + " evenimente (" + future.length + " viitoare)");
    for (const e of future) {
      const nights = Math.round((e.end - e.start) / 86400000);
      if (nights > 60) {
        console.log("  ATENTIE: blocare lunga de " + nights + " nopti " +
          e.start.toISOString().slice(0, 10) + " -> " + e.end.toISOString().slice(0, 10) +
          (e.summary ? " (" + e.summary + ")" : ""));
      }
    }
    all.push(...future);
    const lastEnd = future.reduce((m, e) => (!m || e.end > m ? e.end : m), null);
    state[s.name] = { events: future.length, until: lastEnd ? lastEnd.toISOString().slice(0, 10) : null };
    const before = previousSources[s.name] || {};
    if (!s.own && !future.length && before.until && before.until > todayIso && allowEmpty.indexOf(s.name.toLowerCase()) < 0) {
      emptied.push(s.name);
      state[s.name] = before; // protectia ramane activa pana cand sursa trimite iar evenimente
      console.error("::error title=Calendar " + s.name + " gol::" + s.name + " a trimis un calendar fara evenimente (avea " +
        before.events + " viitoare, pana la " + before.until + "). Zilele ocupate se pastreaza. Daca golirea e reala, " +
        "ruleaza workflow-ul manual cu allow_empty=" + s.name + ".");
    }
  }
  // Fisier vechi, fara "sources": toate sursele goale, dar existau zile ocupate viitoare -> tot calendar gol suspect.
  if (!all.length && previousFuture.length && !Object.keys(previousSources).length &&
      !sources.every(s => allowEmpty.indexOf(s.name.toLowerCase()) >= 0)) {
    sources.forEach(s => { if (emptied.indexOf(s.name) < 0) emptied.push(s.name); });
    console.error("::error title=Calendare goale::Toate calendarele au venit fara evenimente, dar existau " +
      previousFuture.length + " intervale ocupate viitoare. Zilele ocupate se pastreaza.");
  }

  if (emptied.length) {
    // Nimic nu se sterge: intervalele viitoare existente + cele primite acum.
    all.push(...previousFuture.map(r => ({ start: new Date(r.start), end: new Date(r.end) })));
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "suspicious=1\n");
  }

  const ranges = mergeRanges(all);
  const sourcesChanged = JSON.stringify(previousSources) !== JSON.stringify(state);
  if (previous && JSON.stringify(previous) === JSON.stringify(ranges) && !sourcesChanged) {
    console.log("Fara modificari (" + ranges.length + " intervale) — fisierul nu se rescrie.");
    return;
  }

  const out = { updatedAt: new Date().toISOString(), ranges, sources: state };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log("OK — " + ranges.length + " intervale scrise in " + OUT_FILE +
    (emptied.length ? " (pastrate cele vechi: calendar gol la " + emptied.join(", ") + ")" : ""));
}

main().catch(err => {
  console.error("::error::Eroare: " + err.message);
  process.exit(1);
});
