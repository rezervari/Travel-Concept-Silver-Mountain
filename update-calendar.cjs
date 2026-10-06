#!/usr/bin/env node
// Regenereaza booked-dates.json din calendarele iCal ale platformelor (rulat periodic via GitHub Actions).
// Utilizare: node update-calendar.cjs
//
// Surse (linkurile iCal sunt SECRETE — se pun in GitHub > Settings > Secrets, nu in cod):
//   ICS_BOOKING, ICS_AIRBNB, ICS_TRAVELMINIT
// Daca niciun secret nu e setat, se foloseste calendarul Google public (sursa veche, mai lenta).
// Daca o sursa configurata nu raspunde, fisierul NU se modifica (mai bine date vechi decat zile ocupate afisate libere).
// Fisierul se rescrie doar cand se schimba intervalele ocupate (fara commit-uri inutile).

const fs = require("fs");
const path = require("path");

const GOOGLE_CALENDAR_ID = "ch4cifvuu7agfajplgrccculheveu7g6@import.calendar.google.com";
const GOOGLE_ICS_URL = "https://calendar.google.com/calendar/ical/" + encodeURIComponent(GOOGLE_CALENDAR_ID) + "/public/basic.ics";
const OUT_FILE = path.join(__dirname, "booked-dates.json");

const PLATFORM_SOURCES = [
  { name: "Booking", env: "ICS_BOOKING" },
  { name: "Airbnb", env: "ICS_AIRBNB" },
  { name: "Travelminit", env: "ICS_TRAVELMINIT" }
];

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

async function fetchICS(url) {
  const res = await fetch(url, { headers: { "User-Agent": "A13-Travel-Concept-calendar-sync" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.indexOf("BEGIN:VCALENDAR") === -1) throw new Error("raspunsul nu este un calendar iCal");
  return text;
}

async function main() {
  let sources = PLATFORM_SOURCES
    .filter(s => process.env[s.env] && process.env[s.env].trim())
    .map(s => ({ name: s.name, url: process.env[s.env].trim() }));
  if (!sources.length) {
    console.log("Niciun secret ICS_* setat — folosesc calendarul Google.");
    sources = [{ name: "Google Calendar", url: GOOGLE_ICS_URL }];
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const all = [];
  for (const s of sources) {
    let events;
    try {
      events = parseICS(await fetchICS(s.url));
    } catch (err) {
      // URL-ul nu se afiseaza niciodata in log (e secret)
      console.error("Eroare la " + s.name + ": " + err.message + " — booked-dates.json ramane neschimbat.");
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
  }

  const ranges = mergeRanges(all);

  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).ranges; } catch (_) {}
  if (previous && JSON.stringify(previous) === JSON.stringify(ranges)) {
    console.log("Fara modificari (" + ranges.length + " intervale) — fisierul nu se rescrie.");
    return;
  }

  const out = { updatedAt: new Date().toISOString(), ranges };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log("OK — " + ranges.length + " intervale scrise in " + OUT_FILE);
}

main().catch(err => {
  console.error("Eroare: " + err.message);
  process.exit(1);
});
