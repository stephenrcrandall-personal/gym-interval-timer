// Everything is saved on this device only (localStorage). Presets move between devices with a link.

const K = { presets: 'git-presets', places: 'git-places', settings: 'git-settings' };

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
}
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function blankMusic(mode = 'resume') {
  return { source: 'none', playlistId: null, playlistName: '', owned: true, mode, shuffle: false };
}

export function tabata() {
  return { id: uid(), name: 'Tabata', work: 20, rest: 10, cycles: 8, getReady: 10,
           workMusic: blankMusic('resume'), restMusic: blankMusic('next'), beeps: true, voice: true };
}

export function newPreset() {
  return { id: uid(), name: '', work: 60, rest: 30, cycles: 10, getReady: 10,
           workMusic: blankMusic('resume'), restMusic: blankMusic('next'), beeps: true, voice: true };
}

export const total = p => p.cycles * (p.work + p.rest);

// ---- presets ----
export function loadPresets() {
  let list = read(K.presets, null);
  if (!Array.isArray(list)) { list = [tabata()]; write(K.presets, list); }   // one starter preset, once
  return list;
}
export function savePresets(list) { write(K.presets, list); }

// ---- each playlist's place (song + position), kept per playlist and per order ----
export const placeKey = m => m.playlistId ? `${m.source}:${m.playlistId}${m.shuffle ? '|shuffle' : ''}` : null;
export function loadPlaces() { return read(K.places, {}); }
export function savePlaces(p) { write(K.places, p); }
export function resetPlaces() { write(K.places, {}); }

// ---- settings ----
export function loadSettings() {
  return Object.assign({ lead: 0.5, leadAuto: true, deviceId: null, deviceName: '' }, read(K.settings, {}));
}
export function saveSettings(s) { write(K.settings, s); }

// ---- share link: presets travel in the link itself, no server ----
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function shareLink(presets, base) {
  const slim = presets.map(p => ({ ...p }));
  return `${base}#presets=${b64url(JSON.stringify({ v: 1, presets: slim }))}`;
}

// Presets from a link in the address bar, or null.
export function presetsFromHash(hash) {
  const m = /[#&]presets=([A-Za-z0-9_-]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const d = JSON.parse(unb64url(m[1]));
    if (!d || !Array.isArray(d.presets)) return null;
    return d.presets.filter(p => p && typeof p.name === 'string' && p.work > 0 && p.cycles > 0)
      .map(p => ({ ...newPreset(), ...p, workMusic: { ...blankMusic('resume'), ...p.workMusic }, restMusic: { ...blankMusic('next'), ...p.restMusic } }));
  } catch (e) { return null; }
}

// Adds presets from a link: one with the same id or name is replaced, the rest are added.
export function mergePresets(list, incoming) {
  const out = list.slice();
  const nm = s => String(s || '').trim().toLowerCase();
  for (const p of incoming) {
    const i = out.findIndex(x => x.id === p.id || nm(x.name) === nm(p.name));
    if (i >= 0) out[i] = p; else out.push(p);
  }
  return out;
}
