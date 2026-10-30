// Spotify: sign-in (Authorization Code + PKCE, no client secret) and the few Web API calls the timer uses.
// The music itself plays in the Spotify app on this device; the page tells it what to play.

const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const KEY = 'git-spotify';
const SCOPES = [
  'playlist-read-private', 'playlist-read-collaborative',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'
].join(' ');

export class SpotifyError extends Error {
  constructor(message, status, reason) { super(message); this.status = status; this.reason = reason; }
}

function rnd(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function b64url(bytes) {
  let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createSpotify({ clientId, redirect }) {
  let tok = null;
  try { tok = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const keep = () => { try { tok ? localStorage.setItem(KEY, JSON.stringify(tok)) : localStorage.removeItem(KEY); } catch (e) {} };
  let refreshing = null;

  async function tokenRequest(params) {
    const r = await fetch(`${AUTH}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...params })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new SpotifyError(d.error_description || 'Spotify sign-in failed', r.status, d.error);
    tok = {
      access: d.access_token,
      refresh: d.refresh_token || (tok && tok.refresh),
      exp: Date.now() + (d.expires_in || 3600) * 1000 - 60000,
      name: tok && tok.name
    };
    keep();
  }

  async function access() {
    if (!tok) throw new SpotifyError('Not connected to Spotify', 401, 'signed_out');
    if (Date.now() < tok.exp) return tok.access;
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh })
        .catch(e => { if (e.status === 400) { tok = null; keep(); } throw e; })
        .finally(() => { refreshing = null; });
    }
    await refreshing;
    return tok.access;
  }

  async function call(method, path, body, retried) {
    const a = await access();
    const r = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Authorization: `Bearer ${a}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401 && !retried) { tok.exp = 0; return call(method, path, body, true); }
    if (r.status === 204 || r.status === 202) return null;
    const text = await r.text();
    let d = null; try { d = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) {
      const reason = d && d.error && d.error.reason;
      let msg = (d && d.error && d.error.message) || `Spotify error ${r.status}`;
      if (reason === 'NO_ACTIVE_DEVICE' || r.status === 404 && /device/i.test(msg)) msg = 'Spotify isn’t open on this device. Open the Spotify app, play any song for a second, then come back.';
      if (reason === 'PREMIUM_REQUIRED') msg = 'Spotify Premium is needed to control playback.';
      if (r.status === 429) msg = 'Spotify asked us to slow down for a moment.';
      if (r.status === 403 && !reason) msg = 'This Spotify account isn’t added to the app yet (Spotify dashboard › User Management).';
      throw new SpotifyError(msg, r.status, reason);
    }
    return d;
  }

  const dq = id => id ? `?device_id=${encodeURIComponent(id)}` : '';

  return {
    get connected() { return !!tok; },
    get name() { return tok && tok.name; },

    async signIn() {
      const verifier = b64url(rnd(48));
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      const state = b64url(rnd(12));
      sessionStorage.setItem('git-pkce', JSON.stringify({ verifier, state }));
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirect,
                                      code_challenge_method: 'S256', code_challenge: challenge, state });
      location.assign(`${AUTH}/authorize?${q}`);
    },

    // Finishes sign-in when Spotify sends the page back with ?code=…; returns true if it did.
    async finishSignIn(search) {
      const q = new URLSearchParams(search);
      if (!q.has('code') && !q.has('error')) return false;
      let saved = null; try { saved = JSON.parse(sessionStorage.getItem('git-pkce')); } catch (e) {}
      sessionStorage.removeItem('git-pkce');
      if (q.has('error')) throw new SpotifyError(q.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : 'Spotify sign-in failed.', 400, q.get('error'));
      if (!saved || saved.state !== q.get('state')) throw new SpotifyError('Spotify sign-in expired. Try again.', 400, 'state');
      await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirect, code_verifier: saved.verifier });
      try { const me = await call('GET', '/me'); tok.name = me.display_name || me.id; tok.user = me.id; keep(); } catch (e) {}
      return true;
    },

    signOut() { tok = null; keep(); },
    get userId() { return tok && tok.user; },

    // Your playlists (owned, followed and collaborative), every page.
    async playlists() {
      const out = [];
      let url = '/me/playlists?limit=50';
      while (url) {
        const d = await call('GET', url);
        for (const p of (d && d.items) || []) {
          if (!p) continue;
          const count = (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? null;
          out.push({ id: p.id, name: p.name, count, owner: p.owner && (p.owner.display_name || p.owner.id),
                     owned: !!(p.collaborative || (p.owner && tok.user && p.owner.id === tok.user)) });
        }
        url = d && d.next;
      }
      return out;
    },

    // The playlist's songs in order: [{uri, name, artist, ms}]. Only for playlists you own or collaborate on.
    async songs(id) {
      const out = [];
      let url = `/playlists/${id}/items?limit=50&fields=next,items(item(uri,name,duration_ms,is_local,artists(name)),track(uri,name,duration_ms,is_local,artists(name)))`;
      while (url) {
        const d = await call('GET', url);
        for (const row of (d && d.items) || []) {
          const t = row && (row.item || row.track);
          if (!t || !t.uri || t.is_local || !/^spotify:track:/.test(t.uri)) continue;
          out.push({ uri: t.uri, name: t.name, artist: (t.artists || []).map(a => a.name).join(', '), ms: t.duration_ms });
        }
        url = d && d.next;
      }
      return out;
    },

    async devices() { const d = await call('GET', '/me/player/devices'); return (d && d.devices) || []; },
    async player() { return call('GET', '/me/player?additional_types=track'); },

    play(deviceId, playlistId, offset, positionMs) {
      const body = { context_uri: `spotify:playlist:${playlistId}` };
      if (offset) body.offset = offset;
      if (positionMs > 0) body.position_ms = Math.round(positionMs);
      return call('PUT', `/me/player/play${dq(deviceId)}`, body);
    },
    playUris(deviceId, uris, positionMs) {
      const body = { uris, offset: { position: 0 } };
      if (positionMs > 0) body.position_ms = Math.round(positionMs);
      return call('PUT', `/me/player/play${dq(deviceId)}`, body);
    },
    resume(deviceId) { return call('PUT', `/me/player/play${dq(deviceId)}`); },
    pause(deviceId) { return call('PUT', `/me/player/pause${dq(deviceId)}`); },
    next(deviceId) { return call('POST', `/me/player/next${dq(deviceId)}`); },
    shuffleOff(deviceId) { return call('PUT', `/me/player/shuffle?state=false${deviceId ? '&device_id=' + encodeURIComponent(deviceId) : ''}`); },
    repeatContext(deviceId) { return call('PUT', `/me/player/repeat?state=context${deviceId ? '&device_id=' + encodeURIComponent(deviceId) : ''}`); }
  };
}
