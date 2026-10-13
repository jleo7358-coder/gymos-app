// Tiny deterministic offline parser for routine text (port of RoutineParser.swift).
//   Bench Press 3x6-8
//   Bench Press — 3 sets — 6 to 8 reps
//   Bench Press: 3 sets of 8 reps @ 60 kg
//   3x10 Lateral Raise
// Weekday headers ("Tuesday", "Thu - Upper") split a document into days.
// First number = sets, second number = reps. Uncertain lines are flagged, never guessed silently.

import { uuid } from './util.js';

const WEEKDAY_MAP = {
  sun: 1, sunday: 1, mon: 2, monday: 2, tue: 3, tues: 3, tuesday: 3,
  wed: 4, weds: 4, wednesday: 4, thu: 5, thur: 5, thurs: 5, thursday: 5,
  fri: 6, friday: 6, sat: 7, saturday: 7,
};

const DAY_HEADER = /^\s*(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b\s*[:\-–—]?\s*(.*?)\s*$/i;
const GENERIC_HEADER = /^\s*(day\s*\d+|[a-z][a-z /&]{1,30})\s*:\s*$/i;
const PATTERN_A = /^\s*(?<name>[^\d]+?)\s*[-–—:,]*\s*(?<sets>\d{1,2})\s*(?:x|×|\*)\s*(?<rmin>\d{1,3})(?:\s*(?:-|–|—|to|\/)\s*(?<rmax>\d{1,3}))?\s*(?:reps?)?\s*(?<rest>.*?)\s*$/i;
const PATTERN_B = /^\s*(?<name>[^\d]+?)\s*[-–—:,]*\s*(?<sets>\d{1,2})\s*sets?\s*(?:of|x|×|,|-|–|—|:)?\s*(?<rmin>\d{1,3})(?:\s*(?:-|–|—|to|\/)\s*(?<rmax>\d{1,3}))?\s*(?:reps?|repetitions)?\s*(?<rest>.*?)\s*$/i;
const PATTERN_C = /^\s*(?<sets>\d{1,2})\s*(?:x|×|\*)\s*(?<rmin>\d{1,3})(?:\s*(?:-|–|—|to|\/)\s*(?<rmax>\d{1,3}))?\s*(?:reps?)?\s+(?<name>[a-z][^@]*?)\s*(?<rest>(?:@|at)?\s*\d+(?:[.,]\d+)?\s*kg.*)?\s*$/i;
const PATTERN_D = /^\s*(?<sets>\d{1,2})\s*sets?\s*(?:of)?\s+(?<name>[a-z][^\d@]*?)\s*[-–—:,]*\s*(?<rmin>\d{1,3})(?:\s*(?:-|–|—|to|\/)\s*(?<rmax>\d{1,3}))?\s*reps?\s*(?<rest>.*?)\s*$/i;
const WEIGHT = /(?:@|at|with)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?)\b/i;
const BULLET = /^(?:[•\-*]+|\d+[.)])\s+(?=[A-Za-z])/;

export function cleanName(raw) {
  let s = String(raw).trim();
  while (s.length && '-–—:,.'.includes(s[s.length - 1])) s = s.slice(0, -1);
  return s.replace(/\s+/g, ' ').trim();
}

function matchHeader(line) {
  let m = DAY_HEADER.exec(line);
  if (m) {
    const rest = (m[2] || '').trim();
    if (/\d\s*(x|×)\s*\d/i.test(rest)) return null;
    return { weekday: WEEKDAY_MAP[m[1].toLowerCase()] ?? null, title: rest };
  }
  m = GENERIC_HEADER.exec(line);
  if (m) return { weekday: null, title: m[1].trim() };
  return null;
}

export function parseExerciseLine(line) {
  for (const pattern of [PATTERN_A, PATTERN_B, PATTERN_C, PATTERN_D]) {
    const m = pattern.exec(line);
    if (!m) continue;
    const g = m.groups;
    if (g.name == null || g.sets == null || g.rmin == null) continue;
    const sets = parseInt(g.sets, 10), rmin = parseInt(g.rmin, 10);
    if (!Number.isFinite(sets) || !Number.isFinite(rmin)) continue;
    const name = cleanName(g.name);
    if (!name) continue;
    const rmaxParsed = g.rmax != null ? parseInt(g.rmax, 10) : rmin;
    let uncertain = false, note = null;
    if (rmaxParsed < rmin) { note = 'Rep range was reversed'; uncertain = true; }
    const rest = g.rest || '';
    let weight = null;
    const wm = WEIGHT.exec(rest);
    if (wm) weight = Number(wm[1].replace(',', '.'));
    else if (rest.trim()) { uncertain = true; note = `Ignored: "${rest.trim()}"`; }
    if (sets === 0 || sets > 12) { uncertain = true; note = 'Unusual set count'; }
    if (Math.max(rmin, rmaxParsed) > 100 || rmin === 0) { uncertain = true; note = 'Unusual rep count'; }
    return {
      id: uuid(), name, sets, repMin: Math.min(rmin, rmaxParsed), repMax: Math.max(rmin, rmaxParsed),
      weight, raw: line, isUncertain: uncertain, note,
    };
  }
  return null;
}

export function parseRoutineText(text) {
  const days = [];
  let current = { id: uuid(), weekday: null, title: '', exercises: [] };
  const unparsed = [];
  let sawHeader = false;
  for (const rawLine of String(text).split(/\r\n|\r|\n/)) {
    const line = rawLine.trim().replace(BULLET, '');
    if (!line) continue;
    const header = matchHeader(line);
    if (header) {
      if (current.exercises.length || (sawHeader && current.title)) days.push(current);
      current = { id: uuid(), weekday: header.weekday, title: header.title, exercises: [] };
      sawHeader = true;
      continue;
    }
    const ex = parseExerciseLine(line);
    if (ex) current.exercises.push(ex); else unparsed.push(line);
  }
  if (current.exercises.length || sawHeader) days.push(current);
  return { days, unparsedLines: unparsed };
}
