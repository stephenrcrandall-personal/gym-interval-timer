// One run of a preset. The run only stores how long it has been running (pauses excluded) on
// performance.now(), a steady clock that never jumps. Phase, cycle and seconds left are always
// worked out from that by the schedule, so nothing can drift.
//
// Everything that happens at a moment — beeps, voice, music switches — is a planned event. A loop
// looks a little ahead and hands sounds to the audio clock (so they land exactly), and fires music
// switches `lead` seconds early to cover Spotify's delay.

import { makeSchedule, shown } from './schedule.js';

// Sounds are handed to the audio clock this far ahead. The audio clock keeps exact time even when
// the browser slows the page's own timers (Chrome does that to a window hidden behind another app,
// down to once a second, later once a minute), so lining sounds up well ahead means none are missed.
const lookAhead = () => (typeof document !== 'undefined' && document.hidden) ? 75 : 1.5;

export function createRun(preset, { cues, music, onPhase, onEnd }) {
  const s = makeSchedule(preset);
  let anchor = 0, pausedAt = 0, paused = false, started = false, finished = false, endedEarly = false;
  let loop = null, last = null;
  const done = new Set();          // events already played or passed

  // ---- the plan ----
  const events = [];
  const bounds = s.boundaries();
  let saidHalf = false;
  for (let k = 0; k < bounds.length; k++) {
    const b = bounds[k], prev = bounds[k - 1];
    if (b.phase === 'ready') { if (preset.voice) events.push({ id: 'v0', t: 0.05, kind: 'sound', what: 'get-ready' }); continue; }
    if (preset.beeps && prev) {
      for (const n of [3, 2, 1]) if (b.t - n >= prev.t + 0.5) events.push({ id: `b${k}-${n}`, t: b.t - n, kind: 'sound', what: 'short' });
    }
    if (preset.beeps) events.push({ id: `b${k}-0`, t: b.t, kind: 'sound', what: 'long' });
    if (b.phase === 'done') { events.push({ id: 'end', t: b.t, kind: 'end' }); continue; }
    events.push({ id: `m${k}`, t: b.t, kind: 'music', slot: b.phase === 'work' ? preset.workMusic : preset.restMusic });
    if (preset.voice) {
      let at = b.t + (preset.beeps ? 0.55 : 0);
      if (!saidHalf && s.cycles >= 2 && b.t - s.getReady >= s.total / 2 - 0.01) {
        saidHalf = true; events.push({ id: `h${k}`, t: at, kind: 'sound', what: 'halfway' }); at += 0.9;
      }
      const word = b.phase === 'rest' ? 'rest' : (b.cycle === s.cycles && s.cycles > 1 ? 'last-one' : 'work');
      events.push({ id: `v${k}`, t: at, kind: 'sound', what: word });
    }
  }

  const elapsed = () => paused ? pausedAt : (performance.now() - anchor) / 1000;
  const perfAt = t => anchor + t * 1000;

  function tick() {
    if (!started || finished) return;
    const t = elapsed();
    const p = s.at(t);
    if (!last || p.phase !== last.phase || p.cycle !== last.cycle) { last = p; onPhase && onPhase(); }
    if (paused) return;
    if (t >= s.length) {
      for (const e of events) if (e.kind === 'sound' && !done.has(e.id) && e.t >= t - 0.25) { done.add(e.id); cues.at(perfAt(e.t), e.what); }
      finish(); return;
    }
    const lead = music ? music.lead : 0;
    // Music: only the most recent due switch fires (after a hold-up, older ones are skipped).
    const dueMusic = events.filter(e => e.kind === 'music' && !done.has(e.id) && t >= e.t - lead);
    if (dueMusic.length) {
      dueMusic.forEach(e => done.add(e.id));
      const e = dueMusic[dueMusic.length - 1];
      if (music) music.switchTo(e.slot);
    }
    for (const e of events) {
      if (done.has(e.id) || e.kind === 'music') continue;
      if (e.kind === 'end') continue;
      if (e.t <= t + lookAhead()) {
        done.add(e.id);
        if (e.t >= t - 0.25) cues.at(perfAt(e.t), e.what);    // a sound more than ¼ s late is skipped
      }
    }
  }

  function finish() {
    finished = true;
    clearInterval(loop); loop = null;
    if (music) music.finish();
    onEnd && onEnd();
  }

  // Marks everything before `t` as passed, so nothing old plays after a pause, skip or hold-up.
  function passBefore(t) { for (const e of events) if (e.t < t - 1e-6) done.add(e.id); }

  return {
    preset, schedule: s,
    get paused() { return paused; },
    get finished() { return finished; },
    get endedEarly() { return endedEarly; },
    elapsed,
    now() { return s.at(elapsed()); },
    shown() { return shown(this.now().left); },
    totalLeft() { const p = this.now(); return p.phase === 'ready' ? s.total : Math.max(0, Math.ceil(s.total - p.workout - 1e-9)); },

    start() {
      anchor = performance.now(); started = true;
      tick();
      loop = setInterval(tick, 40);
    },
    togglePause() {
      if (finished) return;
      if (paused) {
        anchor = performance.now() - pausedAt * 1000;
        paused = false;
        if (music && s.at(pausedAt).phase !== 'ready') music.resume();
      } else {
        pausedAt = elapsed(); paused = true;
        cues.cancel();
        // Sounds not yet played are planned again on resume.
        for (const e of events) if (e.kind === 'sound' && e.t > pausedAt) done.delete(e.id);
        if (music) music.pause();
      }
      onPhase && onPhase();
    },
    // Jumps to the start of the next phase: its beep, voice and music happen at once.
    skip() {
      if (finished) return;
      const p = this.now();
      const target = elapsed() + p.left;
      cues.cancel();
      if (paused) { paused = false; pausedAt = 0; }
      anchor = performance.now() - target * 1000;
      for (const e of events) if (e.t >= target - 1e-6) done.delete(e.id);
      passBefore(target);
      tick();
    },
    end() { if (finished) return; endedEarly = true; cues.cancel(); finish(); },
    // After the page was in the background (timers stop there), catch up quietly.
    // Music isn't skipped: the most recent switch due still fires, so the right playlist plays.
    catchUp() {
      if (finished || paused) return;
      const t = elapsed() - 0.25;
      for (const e of events) if (e.kind !== 'music' && e.t < t) done.add(e.id);
      tick();
    },
    // Lines up the next stretch of sounds at once (when the page is about to be slowed down).
    poke() { tick(); },
    stop() { clearInterval(loop); loop = null; cues.cancel(); }
  };
}
