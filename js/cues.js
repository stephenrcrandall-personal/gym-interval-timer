// Beeps and spoken cues, all played through Web Audio. The sound check showed Web Audio plays over
// Spotify on iOS without stopping it, while Safari's built-in speaking voice stops other apps' music,
// so the voice cues are short recorded clips (voice/*.wav) played the same way as the beeps.
// Cues are scheduled on the audio clock a little ahead of time, so they land exactly on the second.

export const VOICE = ['get-ready', 'work', 'rest', 'halfway', 'last-one'];

export function createCues(base = '') {
  let ctx = null;
  let short = null, long = null;
  const clips = {};
  let loading = null;
  const pending = new Set();   // scheduled sources not yet played (stopped on pause or skip)

  function tone(hz, seconds) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    const fade = Math.floor(ctx.sampleRate * 0.01);
    for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * hz * i / ctx.sampleRate) * 0.8 * Math.min(1, Math.min(i, n - 1 - i) / fade);
    return b;
  }

  async function loadClips() {
    await Promise.all(VOICE.map(async name => {
      try {
        const r = await fetch(`${base}voice/${name}.wav`, { cache: 'force-cache' });
        if (!r.ok) return;
        clips[name] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { /* no clip: that cue is just quiet */ }
    }));
  }

  return {
    // Must be called from a tap (iOS only lets sound start from a user action).
    // The clips are loaded before the first run starts, so "Get ready" isn't missed.
    async start() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        short = tone(880, 0.16); long = tone(1320, 0.5);
      }
      const resumed = ctx.state !== 'running' ? ctx.resume().catch(() => {}) : null;   // called inside the tap
      if (!loading) loading = loadClips();
      await resumed;
      await loading;
    },
    get ready() { return !!ctx && ctx.state === 'running'; },
    hasVoice(name) { return !!clips[name]; },
    // Plays a beep or clip at a moment given in performance.now() milliseconds.
    at(perfMs, what) {
      if (!ctx) return;
      const buf = what === 'short' ? short : what === 'long' ? long : clips[what];
      if (!buf) return;
      // Turn a page-clock moment into an audio-clock moment. getOutputTimestamp pairs the two clocks
      // exactly (including the speaker's delay), so sounds lined up seconds ahead still land on time.
      let base = ctx.currentTime, perfBase = performance.now();
      try {
        const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
        if (ts && ts.performanceTime > 0 && Math.abs(ts.performanceTime - perfBase) < 1000) { base = ts.contextTime; perfBase = ts.performanceTime; }
      } catch (e) {}
      const when = Math.max(ctx.currentTime, base + (perfMs - perfBase) / 1000);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination);
      src.onended = () => pending.delete(src);
      pending.add(src);
      src.start(when);
    },
    cancel() {
      for (const s of pending) { try { s.stop(); } catch (e) {} }
      pending.clear();
    },
    async resume() { if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} } }
  };
}
