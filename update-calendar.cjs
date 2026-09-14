#!/usr/bin/env node
// Regenereaza booked-dates.json din calendarul Google (rulat periodic via cron).
// Utilizare: node update-calendar.cjs

const https = require("https");
const fs = require("fs");
const path = require("path");

const CALENDAR_ID = "ch4cifvuu7agfajplgrccculheveu7g6@import.calendar.google.com";
const ICS_URL = "https://calendar.google.com/calendar/ical/" + encodeURIComponent(CALENDAR_ID) + "/public/basic.ics";
const OUT_FILE = path.join(__dirname, "booked-dates.json");

function parseICSDate(raw) {
  raw = raw.trim();
  if (/^\d{8}$/.test(raw)) {
    return new Date(Date.UTC(+raw.slice(0,4), +raw.slice(4,6)-1, +raw.slice(6,8))).toISOString();
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  }
  return null;
}

function parseICS(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const unfolded = [];
  for (const line of lines) {
    if (line.charAt(0) === " " && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  const ranges = [];
  let cur = null;
  for (const line of unfolded) {
    if (line.indexOf("BEGIN:VEVENT") === 0) { cur = {}; continue; }
    if (line.indexOf("END:VEVENT") === 0) {
      if (cur && cur.start && cur.end) ranges.push({ start: cur.start, end: cur.end });
      cur = null; continue;
    }
    if (!cur) continue;
    if (line.indexOf("DTSTART") === 0) cur.start = parseICSDate(line.split(":").pop());
    else if (line.indexOf("DTEND") === 0) cur.end = parseICSDate(line.split(":").pop());
  }
  return ranges;
}

https.get(ICS_URL, (res) => {
  if (res.statusCode !== 200) {
    console.error("Eroare la descarcarea calendarului: HTTP " + res.statusCode);
    process.exit(1);
  }
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    const ranges = parseICS(body);
    const out = { updatedAt: new Date().toISOString(), ranges };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
    console.log("OK — " + ranges.length + " intervale scrise in " + OUT_FILE);
  });
}).on("error", (err) => {
  console.error("Eroare retea: " + err.message);
  process.exit(1);
});
