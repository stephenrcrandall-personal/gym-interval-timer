// The music side of a run: which song each playlist is on, switching playlists at each phase change,
// and hiding Spotify's delay.
//
// Each playlist keeps its place (song + position) between intervals and between workouts:
// - Continue: the same song picks up where it stopped.
// - Next track: the song after it, from the start.
// - Shuffle: an order shuffled once and kept, reshuffled only after every song has played
//   (Spotify's own shuffle reshuffles every time a playlist starts, which repeats songs).
//
// Hiding the delay: the run engine calls switchTo() `lead` seconds before the beep. Everything the
// switch needs is known ahead (songs are loaded at the start; the outgoing song's position is
// estimated from the last poll), so the switch is one request. The real delay is measured after the
// first few switches and `lead` is tuned to it.

import { loadPlaces, savePlaces, placeKey } from './store.js';

const POLL_MS = 3000;
const shuffled = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export function createMusic(spotify, settings, saveSettings) {
  const songs = {};            // playlistId → [{uri,name,artist,ms}] (owned playlists)
  let places = loadPlaces();
  let deviceId = null;
  let active = null;           // the slot playing now (null = quiet)
  let last = null;             // last poll: {uri, name, artist, ms, progress, playing, at}
  let poller = null;
  let measured = 0;            // switches measured this run
  let busy = Promise.resolve();
  const api = {
    problem: null,
    now: { title: '', artist: '' },
    onChange: () => {}
  };
  const changed = () => { try { api.onChange(); } catch (e) {} };
  const fail = e => { api.problem = e && e.message ? e.message : String(e); changed(); };
  const keepPlaces = () => savePlaces(places);
  const serial = fn => (busy = busy.then(fn, fn).catch(fail));

  function readPoll(d) {
    if (!d || !d.item) { last = d ? { uri: null, progress: 0, playing: !!d.is_playing, at: performance.now() } : null; return; }
    last = { uri: d.item.uri, name: d.item.name, artist: (d.item.artists || []).map(a => a.name).join(', '),
             ms: d.item.duration_ms, progress: d.progress_ms || 0, playing: !!d.is_playing, at: performance.now() };
    if (api.now.title !== last.name || api.now.artist !== last.artist) { api.now = { title: last.name, artist: last.artist }; changed(); }
  }

  async function poll() {
    try { readPoll(await spotify.player()); } catch (e) { /* a missed poll is fine */ }
  }

  // Where the playing song is right now. A poll only counts if it was taken after the last switch
  // had started playing; otherwise (short intervals, or a poll still on its way) it's worked out from
  // what was sent: that song, from that spot, since it started.
  let sent = null;             // {uri, pos, ms, at}: the last play request; at = when it should be heard (null while paused)
  function estimate() {
    const now = performance.now();
    if (last && last.uri && (!sent || (sent.at !== null && last.at >= sent.at + 300))) {
      return { uri: last.uri, progress: last.progress + (last.playing ? now - last.at : 0), ms: last.ms };
    }
    if (sent && sent.uri) return { uri: sent.uri, progress: sent.pos + (sent.at === null ? 0 : Math.max(0, now - sent.at)), ms: sent.ms };
    return null;
  }

  // Keeps a playlist's saved place when songs are added or removed.
  function reconcile(pl, uris, shuffle) {
    pl = pl || { order: [], index: 0, pos: 0, started: false };
    const same = shuffle ? (pl.order.length === uris.length && uris.every(u => pl.order.includes(u))) : pl.order.join() === uris.join();
    if (same) return pl;
    const cur = pl.order[pl.index];
    let order;
    if (shuffle) { const kept = pl.order.filter(u => uris.includes(u)); order = kept.concat(shuffled(uris.filter(u => !kept.includes(u)))); }
    else order = uris.slice();
    const i = cur ? order.indexOf(cur) : -1;
    return i >= 0 ? { ...pl, order, index: i } : { order, index: 0, pos: 0, started: false };
  }

  // Saves where the playlist that's playing got to.
  function capture() {
    if (!active) return;
    const key = placeKey(active), est = estimate(), pl = places[key];
    if (!pl || !est) return;
    if (pl.order) {
      let i = pl.order.indexOf(est.uri), pos = est.progress;
      if (i < 0) return;                                  // something else is playing; keep the old place
      if (est.ms && pos > est.ms) { i += 1; pos = Math.max(0, pos - est.ms); }   // rolled into the next song
      pl.index = i % pl.order.length; pl.pos = pos;
    } else {
      pl.uri = est.uri; pl.pos = est.progress;
    }
    keepPlaces();
  }

  // Works out what to play for a slot (and moves its saved place on). Returns the play request.
  function plan(slot, commit) {
    const key = placeKey(slot);
    const list = songs[slot.playlistId];
    if (list && list.length) {
      const uris = list.map(s => s.uri);
      const rec = reconcile(places[key], uris, slot.shuffle);
      if (rec !== places[key]) { places[key] = rec; keepPlaces(); }   // keep a new shuffle order, so the preview is stable
      let pl = { ...rec, order: rec.order.slice() };
      let pos = 0;
      if (pl.started) {
        if (slot.mode === 'resume') {
          pos = pl.pos || 0;
          const s = list.find(x => x.uri === pl.order[pl.index]);
          if (s && pos > s.ms - 3000) { pl.index += 1; pos = 0; }
        } else pl.index += 1;
      }
      if (pl.index >= pl.order.length) { pl.index = 0; pos = 0; if (slot.shuffle) pl.order = shuffled(uris); }
      pl.started = true; pl.pos = pos;
      if (commit) { places[key] = pl; keepPlaces(); }
      const uri = pl.order[pl.index], song = list.find(x => x.uri === uri);
      // Shuffle plays our own order as a list of songs; otherwise the playlist itself, from that song.
      const req = slot.shuffle
        ? { uris: pl.order.slice(pl.index).concat(pl.order.slice(0, pl.index)).slice(0, 50), pos }
        : { playlistId: slot.playlistId, offset: { uri }, pos };
      return { req, uri, index: pl.index, count: pl.order.length, song, pos };
    }
    // A playlist Spotify won't list for us (not yours): Continue only, by song and position.
    const pl = places[key] || { started: false };
    const out = { req: { playlistId: slot.playlistId, offset: pl.started && pl.uri ? { uri: pl.uri } : null, pos: pl.started && slot.mode === 'resume' ? pl.pos || 0 : 0, thenNext: pl.started && slot.mode === 'next' }, uri: pl.uri || null, pos: 0 };
    if (commit) { places[key] = { ...pl, started: true }; keepPlaces(); }
    return out;
  }

  async function send(r) {
    if (r.uris) return spotify.playUris(deviceId, r.uris, r.pos);
    await spotify.play(deviceId, r.playlistId, r.offset, r.pos);
    if (r.thenNext) await spotify.next(deviceId);
  }

  // After a switch, watch for the new song to start and learn how long Spotify took.
  async function measure(sentAt, uri, startPos) {
    if (!settings.leadAuto || !uri || measured >= 4) return;
    measured++;
    const until = sentAt + 4000;
    while (performance.now() < until) {
      await new Promise(r => setTimeout(r, 350));
      let d; try { d = await spotify.player(); } catch (e) { return; }
      readPoll(d);
      if (d && d.item && d.item.uri === uri && d.is_playing && (d.progress_ms || 0) >= startPos) {
        const startedAt = last.at - ((d.progress_ms || 0) - startPos);
        const delay = Math.min(2, Math.max(0.1, (startedAt - sentAt) / 1000));
        settings.lead = Math.round((settings.lead * 0.6 + delay * 0.4) * 100) / 100;
        saveSettings(settings);
        changed();
        return;
      }
    }
  }

  // (a getter can't go through Object.assign: it would copy today's value, not the live one)
  Object.defineProperty(api, 'lead', { get: () => settings.lead });
  return Object.assign(api, {

    // Gets the device and both playlists ready before the first switch.
    async begin(slots) {
      api.problem = null; measured = 0; places = loadPlaces();
      const used = slots.filter(s => s.source === 'spotify' && s.playlistId);
      if (!used.length) return;
      if (!spotify.connected) throw new Error('Connect Spotify first (home screen).');
      const devs = await spotify.devices();
      const pick = devs.find(d => d.id === settings.deviceId) || devs.find(d => d.is_active) ||
                   devs.find(d => /tablet|smartphone|computer/i.test(d.type)) || devs[0];
      if (!pick) throw new Error('Spotify isn’t open on this device. Open the Spotify app, play any song for a second, then come back.');
      deviceId = pick.id;
      if (settings.deviceId !== pick.id) { settings.deviceId = pick.id; settings.deviceName = pick.name; saveSettings(settings); }
      for (const s of used) {
        if (s.owned && !songs[s.playlistId]) { try { songs[s.playlistId] = await spotify.songs(s.playlistId); } catch (e) { songs[s.playlistId] = null; } }
      }
      try { await spotify.shuffleOff(deviceId); } catch (e) {}
      try { await spotify.repeatContext(deviceId); } catch (e) {}
      await poll();
      clearInterval(poller);
      poller = setInterval(poll, POLL_MS);
    },

    // What's lined up for a slot, for the screen ("song 4", "song 7 from 1:48").
    lineup(slot) {
      if (!slot || slot.source !== 'spotify' || !slot.playlistId) return null;
      const p = plan(slot, false);
      return { name: slot.playlistName, index: p.index, count: p.count, title: p.song && p.song.name, pos: p.pos };
    },

    // Called `lead` seconds before the phase starts (or at once after a skip).
    switchTo(slot) {
      return serial(async () => {
        capture();
        if (!slot || slot.source !== 'spotify' || !slot.playlistId) {
          if (active) { active = null; await spotify.pause(deviceId); }
          return;
        }
        const p = plan(slot, true);
        const sentAt = performance.now();
        sent = { uri: p.uri, pos: p.pos || 0, ms: p.song ? p.song.ms : null, at: sentAt + settings.lead * 1000 };
        await send(p.req);
        active = slot;
        api.problem = null; changed();
        measure(sentAt, p.uri, p.pos);
      });
    },

    pause() {
      return serial(async () => {
        const e = estimate();
        capture();
        if (e) sent = { uri: e.uri, pos: e.progress, ms: e.ms, at: null };   // held where it stopped
        if (active) await spotify.pause(deviceId);
      });
    },
    resume() {
      return serial(async () => {
        if (sent && sent.at === null) sent.at = performance.now() + settings.lead * 1000;
        if (active) await spotify.resume(deviceId);
        setTimeout(poll, 800);
      });
    },
    skipSong() {
      return serial(async () => {
        if (!active) return;
        await spotify.next(deviceId);
        sent = null;            // a different song now: go by the next poll
        setTimeout(poll, 800);
      });
    },
    finish() {
      clearInterval(poller); poller = null;
      return serial(async () => { capture(); if (active) { active = null; await spotify.pause(deviceId); } });
    },
    // Where each playlist will pick up next time (for the Done screen).
    picksUp(slot) {
      if (!slot || !slot.playlistId) return null;
      const pl = places[placeKey(slot)];
      if (!pl || !pl.started) return null;
      return { index: (pl.index ?? 0) + 1, pos: pl.pos || 0, count: pl.order ? pl.order.length : null };
    }
  });
}
