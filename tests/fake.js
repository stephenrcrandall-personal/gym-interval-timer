// Test doubles loaded before the app: a fake Spotify (Web API answered in the page, with a playback
// delay like the real one), a fake audio clock that records every scheduled beep and clip, and a
// signed-in Spotify account. Times are page time (performance.now), which the tests fast-forward.
(() => {
  const DELAY = (window.__SPOTIFY_DELAY ?? 700);     // ms from a play request to the music starting
  const songs = n => Array.from({ length: n }, (_, i) => ({ uri: `spotify:track:${n}x${i}`, name: `Song ${i + 1}`, duration_ms: 200000, artists: [{ name: 'Artist' }] }));
  const lists = {
    pw: { id: 'pw', name: 'Work mix', owner: { id: 'me' }, tracks: songs(5) },
    pr: { id: 'pr', name: 'Rest mix', owner: { id: 'me' }, tracks: songs(4) },
    px: { id: 'px', name: 'Beast Mode', owner: { id: 'spotify', display_name: 'Spotify' }, tracks: songs(6) }
  };
  const S = window.__sp = { calls: [], player: null, devices: [{ id: 'ipad', name: 'Test iPad', type: 'Tablet', is_active: true }] };
  const now = () => performance.now();
  const findTrack = uri => { for (const l of Object.values(lists)) { const t = l.tracks.find(x => x.uri === uri); if (t) return t; } return null; };
  function state() {
    const p = S.player; if (!p) return null;
    const t = now();
    if (t < p.at) return { item: p.prev ? p.prev.item : null, progress_ms: p.prev ? p.prev.pos : 0, is_playing: !!(p.prev && p.prev.playing) };
    let pos = p.pos + (p.playing ? t - p.at : 0), queue = p.queue, i = p.i;
    while (pos > findTrack(queue[i]).duration_ms) { pos -= findTrack(queue[i]).duration_ms; i = (i + 1) % queue.length; }
    return { item: findTrack(queue[i]), progress_ms: Math.floor(pos), is_playing: p.playing, i };
  }
  function play(body) {
    const prev = S.player ? state() : null;
    let queue, i = 0;
    if (body.uris) { queue = body.uris; i = body.offset ? body.offset.position || 0 : 0; }
    else { const id = body.context_uri.split(':').pop(); queue = lists[id].tracks.map(t => t.uri); if (body.offset && body.offset.uri) i = queue.indexOf(body.offset.uri); }
    S.player = { queue, i, pos: body.position_ms || 0, at: now() + DELAY, playing: true, prev: prev && prev.item ? { item: prev.item, pos: prev.progress_ms, playing: prev.is_playing } : null };
  }
  const json = (status, d) => new Response(d == null ? null : JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    url = String(url);
    if (!/spotify\.com/.test(url)) return realFetch(url, opt);
    const method = (opt.method || 'GET').toUpperCase();
    const u = new URL(url);
    const body = opt.body && typeof opt.body === 'string' ? JSON.parse(opt.body) : null;
    S.calls.push({ t: now(), method, path: u.pathname, q: u.search, body });
    const p = u.pathname.replace('/v1', '');
    if (p === '/me') return json(200, { id: 'me', display_name: 'Tester' });
    if (p === '/me/playlists') return json(200, { items: Object.values(lists).map(l => ({ id: l.id, name: l.name, owner: l.owner, collaborative: false, items: { total: l.tracks.length } })), next: null });
    let m = p.match(/^\/playlists\/(\w+)\/items$/);
    if (m) { const l = lists[m[1]]; if (l.owner.id !== 'me') return json(200, { next: null }); return json(200, { items: l.tracks.map(t => ({ item: { ...t, is_local: false } })), next: null }); }
    if (p === '/me/player/devices') return json(200, { devices: S.devices });
    if (p === '/me/player' && method === 'GET') { const st = state(); if (!st) return json(204); return json(200, { item: st.item, progress_ms: st.progress_ms, is_playing: st.is_playing }); }
    if (p === '/me/player/play') {
      if (!S.devices.length) return json(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
      if (body) play(body); else if (S.player) { const st = state(); S.player = { ...S.player, queue: S.player.queue, i: st.i ?? S.player.i, pos: st.progress_ms, at: now(), playing: true, prev: null }; }
      return json(204);
    }
    if (p === '/me/player/pause') { if (S.player) { const st = state(); S.player = { ...S.player, i: st.i ?? S.player.i, pos: st.progress_ms, at: now(), playing: false, prev: null }; } return json(204); }
    if (p === '/me/player/next') { if (S.player) { const st = state(); S.player = { ...S.player, i: ((st.i ?? S.player.i) + 1) % S.player.queue.length, pos: 0, at: now(), prev: null }; } return json(204); }
    if (p === '/me/player/shuffle' || p === '/me/player/repeat') return json(204);
    return json(404, { error: { message: 'not faked: ' + p } });
  };
  // Signed in already.
  if (!window.__SIGNED_OUT) localStorage.setItem('git-spotify', JSON.stringify({ access: 'x', refresh: 'y', exp: Date.now() + 864e5 * 365, name: 'Tester', user: 'me' }));

  // Fake audio: records what is scheduled and when (in performance.now() ms).
  const A = window.__audio = [];
  class Buf { constructor(len, rate) { this.length = len; this.sampleRate = rate; this.data = new Float32Array(len); } getChannelData() { return this.data; } }
  class Ctx {
    constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = {}; }
    get currentTime() { return performance.now() / 1000; }
    resume() { return Promise.resolve(); }
    createBuffer(c, len, rate) { return new Buf(len, rate); }
    async decodeAudioData(ab) { const b = new Buf(10, 44100); b.clip = new TextDecoder().decode(new Uint8Array(ab)); return b; }
    createBufferSource() {
      const src = { connect() {}, start(when) { this.when = when; A.push(this); }, stop() { this.stopped = true; } };
      return src;
    }
  }
  window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
  window.__label = s => s.buffer.clip || (s.buffer.length < 10000 ? 'short' : 'long');
})();
