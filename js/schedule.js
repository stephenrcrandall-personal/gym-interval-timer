// Where a run is at a given number of seconds since it started (pauses excluded).
// The single source of truth: the screen, the cues and the music switches all read from it,
// so nothing is counted tick by tick and nothing can drift. Same rules as Hybrid Log's
// TimerSchedule: a cycle is work + rest, including the rest after the last cycle.

export function makeSchedule(p) {
  const getReady = Math.max(0, Math.round(p.getReady || 0));
  const work = Math.max(1, Math.round(p.work));
  const rest = Math.max(0, Math.round(p.rest));
  const cycles = Math.max(1, Math.round(p.cycles));
  const cycleLength = work + rest;
  const total = cycles * cycleLength;
  return {
    getReady, work, rest, cycles, cycleLength, total,
    length: getReady + total,
    at(t) {
      t = Math.max(0, t);
      if (t < getReady) return { phase: 'ready', cycle: 1, left: getReady - t, length: getReady, start: 0, workout: 0 };
      const x = t - getReady;
      if (x >= total) return { phase: 'done', cycle: cycles, left: 0, length: 0, start: getReady + total, workout: total };
      const i = Math.min(cycles - 1, Math.floor(x / cycleLength));
      const inCycle = x - i * cycleLength;
      const cs = getReady + i * cycleLength;
      if (inCycle < work) return { phase: 'work', cycle: i + 1, left: work - inCycle, length: work, start: cs, workout: x };
      return { phase: 'rest', cycle: i + 1, left: cycleLength - inCycle, length: rest, start: cs + work, workout: x };
    },
    // Every phase start, in order (used to plan cues and music switches ahead of time).
    boundaries() {
      const out = [];
      if (getReady) out.push({ t: 0, phase: 'ready', cycle: 1 });
      for (let i = 0; i < cycles; i++) {
        const cs = getReady + i * cycleLength;
        out.push({ t: cs, phase: 'work', cycle: i + 1 });
        if (rest) out.push({ t: cs + work, phase: 'rest', cycle: i + 1 });
      }
      out.push({ t: getReady + total, phase: 'done', cycle: cycles });
      return out;
    }
  };
}

// The whole number on the big countdown: 20, 19 … 1, changing exactly on each second.
export const shown = left => Math.ceil(left - 1e-9);

export function clock(s) {
  s = Math.max(0, Math.round(s));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "2:00", "0:30", ":30" → seconds; a bare number is seconds ("20" = 0:20, "120" = 2:00).
export function parseTime(text) {
  const s = String(text || '').trim().replace(/[.,]/, ':');
  if (!s) return null;
  const m = s.match(/^(\d*):(\d{1,2})$/);
  if (m) return (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}
