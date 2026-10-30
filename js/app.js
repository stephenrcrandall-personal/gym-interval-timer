// Gym Interval Timer — the screens. One state object, render() rebuilds the current screen, and a
// delegated click handler acts on data-act. While a workout runs, only the countdown, the progress
// bar and the times are updated each frame.

import { clock, shown, parseTime } from './schedule.js';
import * as store from './store.js';
import { createSpotify } from './spotify.js';
import { createMusic } from './music.js';
import { createCues } from './cues.js';
import { createRun } from './run.js';

const C = window.GIT_CONFIG || {};
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const I = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  none: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  cont: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h11M12 7l5 5-5 5"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l9-7zM18 5v14"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l9-7zM13 5v14l9-7z"/></svg>',
  skipSong: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l10-7zM16 5h3v14h-3z"/></svg>',
  tri: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l5 9H1z" fill="currentColor"/></svg>',
  bars: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" fill="currentColor"/><rect x="7.4" y="1.5" width="2.6" height="9" fill="currentColor"/></svg>',
  timer: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'
};

// ---------- state ----------
const settings = store.loadSettings();
const spotify = createSpotify({ clientId: C.spotifyClientId, redirect: C.spotifyRedirect || (location.origin + location.pathname) });
const cues = createCues();
const music = createMusic(spotify, settings, store.saveSettings);
const S = {
  presets: store.loadPresets(),
  view: 'home', draft: null, isNew: false, sheet: null, run: null, runKey: '', loadErr: null,
  voiceReady: false, toast: ''
};
music.onChange = () => { if (S.view === 'run') drawRun(true); };

const savePresets = () => store.savePresets(S.presets);
let toastT = null;
function toast(msg) { S.toast = msg; drawToast(); clearTimeout(toastT); toastT = setTimeout(() => { S.toast = ''; drawToast(); }, 2600); }
function drawToast() {
  let el = $('#toast');
  if (!S.toast) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = S.toast;
}

// ---------- helpers ----------
const slotLine = m => {
  if (!m || m.source === 'none' || !m.playlistId) return 'No music';
  return `<span class="src">${m.source === 'apple' ? 'APPLE MUSIC' : 'SPOTIFY'}</span>${esc(m.playlistName)}`;
};
const modeWord = m => (m.mode === 'resume' ? 'Continue' : 'Next track') + (m.shuffle ? ' · Shuffle' : '');
function whyText(m) {
  if (!m.owned) return 'Spotify only shares the song list of playlists you made or collaborate on, so this one can only Continue. To use Next track or Shuffle, save a copy to your own playlists.';
  return {
    'resume0': 'Continue: picks the same song back up where it stopped.',
    'resume1': 'Continue + Shuffle: the same song picks back up; the one after it is random.',
    'next0': 'Next track: a new song from the start each interval, in playlist order.',
    'next1': 'Next track + Shuffle: a random new song from the start each interval.'
  }[m.mode + (m.shuffle ? 1 : 0)];
}

// ---------- screens ----------
function vHome() {
  const sp = spotify.connected;
  let h = `<div class="wrap"><header class="top"><div><small>Gym Interval Timer</small><h1>Interval timer</h1></div>
    <button class="ib" data-act="settings" aria-label="Sound and music settings">${I.gear}</button></header>`;
  h += `<div class="home"><div class="col"><p class="lab">Presets</p>`;
  if (!S.presets.length) h += `<p class="muted">No presets yet. Add one for the workout you’re about to do.</p>`;
  S.presets.forEach(p => {
    h += `<div class="pre"><div class="t"><h2>${esc(p.name || 'Untitled')}</h2>
      <div class="nums">${clock(p.work)} <em>work</em> · ${clock(p.rest)} <em>rest</em> · ${p.cycles} <em>cycles</em> · <b>${clock(store.total(p))}</b></div>
      <div class="mus">${slotLine(p.workMusic)}<span>·</span>${slotLine(p.restMusic)}</div></div>
      <button class="ib" style="border:0;background:none" data-act="edit" data-id="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">${I.pen}</button>
      <button class="go" data-act="start" data-id="${esc(p.id)}" aria-label="Start ${esc(p.name)}">${I.play}</button></div>`;
  });
  h += `<div class="addrow"><button class="add" data-act="new">+ New preset</button>${S.presets.length ? `<button class="btn" data-act="share" style="min-height:54px">${I.share}Send presets to another device</button>` : ''}</div></div>`;
  h += `<div class="col"><p class="lab">Music</p><div class="card rows">
    <div class="rowi"><i class="art">${I.note}</i><div class="t"><b>Spotify</b><em>${sp ? esc(spotify.name || 'Connected') + ' · plays in the Spotify app' : 'Premium account, added to the app'}</em></div>
      ${sp ? '<span class="ok">✓ Connected</span>' : '<button class="btn primary" data-act="sp-in">Connect</button>'}</div>
    <div class="rowi"><i class="art">${I.note}</i><div class="t"><b>Apple Music</b><em>Coming next, once Spotify works at the gym</em></div><span class="muted">Soon</span></div>
  </div>
  <p class="lab">Before you start</p><div class="card"><p class="muted" style="color:var(--soft)">Connect the speaker, turn off Silent mode, and open the Spotify app once so it’s ready. Keep this screen open during the workout; it stays on by itself.</p></div>
  </div></div></div>`;
  return h;
}

function musicCard(which) {
  const m = S.draft[which === 'work' ? 'workMusic' : 'restMusic'], work = which === 'work';
  const on = m.source === 'spotify';
  let h = `<section class="card"><div class="ph"><span class="badge ${work ? 'bw' : 'br'}">${work ? I.tri + 'WORK' : I.bars + 'REST'}</span><p class="lab" style="margin:0">Music</p></div>
    <div class="seg" role="radiogroup" aria-label="${work ? 'Work' : 'Rest'} music service">
      <button class="${on ? 'on' : ''}" role="radio" aria-checked="${on}" data-act="src" data-w="${which}" data-v="spotify">Spotify</button>
      <button disabled role="radio" aria-checked="false" title="Coming next">Apple Music</button>
      <button class="${on ? '' : 'on'}" role="radio" aria-checked="${!on}" data-act="src" data-w="${which}" data-v="none">None</button></div>`;
  if (on) {
    h += `<button class="pick" data-act="pick" data-w="${which}"><i class="art">${I.note}</i><span class="t"><b>${m.playlistId ? esc(m.playlistName) : 'Choose a playlist'}</b><em>${m.playlistId ? (m.owned ? 'Your playlist' : 'Followed playlist · Continue only') : 'From your Spotify library'}</em></span><i class="ch">›</i></button>`;
    if (m.playlistId) {
      h += `<div class="seg" role="radiogroup" aria-label="Each ${which} interval">
        <button class="${m.mode === 'resume' ? 'on' : ''}" role="radio" aria-checked="${m.mode === 'resume'}" data-act="mode" data-w="${which}" data-v="resume">${I.cont}Continue</button>
        <button class="${m.mode === 'next' ? 'on' : ''}" role="radio" aria-checked="${m.mode === 'next'}" data-act="mode" data-w="${which}" data-v="next"${m.owned ? '' : ' disabled'}>${I.next}Next track</button></div>
        <div class="sw"><span class="t">Shuffle<em>${m.shuffle ? 'On: random order, no repeats until all have played' : 'Off: playlist order'}</em></span>
        <button class="tg" role="switch" aria-checked="${!!m.shuffle}" data-act="shuf" data-w="${which}"${m.owned ? '' : ' disabled'} aria-label="Shuffle ${which} music"><b>${m.shuffle ? 'On' : 'Off'}</b><i></i></button></div>
        <p class="why">${esc(whyText(m))}</p>`;
    }
  } else h += `<p class="why">Beeps and voice only.</p>`;
  return h + `</section>`;
}

function vEdit() {
  const d = S.draft;
  const w = parseTime(d.workText), r = parseTime(d.restText);
  const tot = (w > 0 && r >= 0) ? d.cycles * (w + r) : null;
  let h = `<div class="wrap"><header class="ehead"><button class="btn ghost" data-act="cancel" style="justify-content:flex-start">Cancel</button><h1>${S.isNew ? 'New preset' : 'Edit preset'}</h1><button class="btn ghost" data-act="save" style="justify-content:flex-end">Save</button></header>
  <div class="edit"><section class="card">
    <input class="name" id="e-name" value="${esc(d.name)}" placeholder="Preset name" aria-label="Preset name" autocomplete="off">
    <div class="f"><label for="e-work">Work</label><input id="e-work" class="w${w > 0 ? '' : ' bad'}" value="${esc(d.workText)}" inputmode="numeric" autocomplete="off" aria-describedby="e-fmt"></div>
    <div class="f"><label for="e-rest">Rest</label><input id="e-rest" class="r${r >= 0 && r !== null ? '' : ' bad'}" value="${esc(d.restText)}" inputmode="numeric" autocomplete="off" aria-describedby="e-fmt"></div>
    <p class="why" id="e-fmt">Type 2:00, 0:30 or seconds (20).</p>
    <div class="f"><span class="l">Cycles</span><div class="step"><button data-act="cyc" data-d="-1" aria-label="Fewer cycles">−</button><b aria-live="polite">${d.cycles}</b><button data-act="cyc" data-d="1" aria-label="More cycles">+</button></div></div>
    <div class="f"><span class="l">Get ready</span><div class="step"><button data-act="gr" data-d="-1" aria-label="Shorter get ready">−</button><b aria-live="polite">${d.getReady ? d.getReady + ' s' : 'Off'}</b><button data-act="gr" data-d="1" aria-label="Longer get ready">+</button></div></div>
    <div class="tot"><span>${tot === null ? 'Check the times' : `${d.cycles} × (${clock(w)} + ${clock(r)})`}</span><b>${tot === null ? '—' : clock(tot)}</b></div>
    <p class="lab">Cues</p>
    <div class="sw"><span class="t">Beeps<em>3-2-1 before each switch</em></span><button class="tg" role="switch" aria-checked="${d.beeps}" data-act="tog" data-k="beeps" aria-label="Beeps"><b>${d.beeps ? 'On' : 'Off'}</b><i></i></button></div>
    <div class="sw"><span class="t">Voice<em>${S.voiceReady ? '“Work”, “Rest”, “Halfway”, “Last one”' : 'Voice clips not added yet; beeps only for now'}</em></span><button class="tg" role="switch" aria-checked="${d.voice}" data-act="tog" data-k="voice" aria-label="Voice"><b>${d.voice ? 'On' : 'Off'}</b><i></i></button></div>
    ${S.isNew ? '' : '<button class="btn danger" data-act="del" style="margin-top:6px">Delete preset</button>'}
  </section>
  ${musicCard('work')}
  <div class="col">${musicCard('rest')}<button class="start" data-act="save-start">${I.play}Start${tot === null ? '' : ' · ' + clock(tot)}</button></div>
  </div></div>`;
  return h;
}

function vDone() {
  const r = S.run, p = r.preset, s = r.schedule;
  const cyc = r.endedEarly ? r.now().cycle : s.cycles;
  let picks = '';
  for (const [label, m] of [['Work', p.workMusic], ['Rest', p.restMusic]]) {
    const u = m.source === 'spotify' && music.picksUp(m);
    if (u) picks += `<p class="muted" style="color:var(--soft)">${label} · ${esc(m.playlistName)}, ${m.mode === 'resume' ? `song ${u.index}${u.pos > 1000 ? ' at ' + clock(u.pos / 1000) : ''}` : `next up song ${u.count && u.index + 1 > u.count ? 1 : u.index + 1}`}</p>`;
  }
  return `<div class="wrap"><div class="done"><span class="ok2">${I.check}</span>
    <h1>${r.endedEarly ? 'Ended' : 'Done'} · ${esc(p.name)}</h1>
    <p class="muted">${r.endedEarly ? `Stopped during cycle ${cyc} of ${s.cycles}.` : 'Music stopped. Nice work.'}</p>
    <div class="card stats"><div><b>${cyc}</b><span>cycles</span></div><div><b>${clock(s.cycles * s.work)}</b><span>work planned</span></div><div><b>${clock(s.total)}</b><span>total planned</span></div></div>
    ${picks ? `<div class="card" style="text-align:left;gap:4px"><p class="lab" style="margin:0">Where the music picks up next time</p>${picks}</div>` : ''}
    <button class="start" data-act="home">Done</button>
    <button class="btn" data-act="again">Run it again</button></div></div>`;
}

// ---------- sheets ----------
function vSheet() {
  const sh = S.sheet;
  if (!sh) return '';
  let title = '', body = '';
  if (sh.kind === 'pick') {
    title = sh.which === 'work' ? 'Work music' : 'Rest music';
    const q = (sh.q || '').toLowerCase();
    const list = (sh.lists || []).filter(p => !q || p.name.toLowerCase().includes(q));
    const cur = S.draft[sh.which === 'work' ? 'workMusic' : 'restMusic'];
    body = `<input class="search" id="pick-q" placeholder="Search your playlists" value="${esc(sh.q || '')}" aria-label="Search your playlists" autocomplete="off">`;
    if (sh.loading) body += `<p class="muted">Loading your playlists…</p>`;
    if (sh.error) body += `<p class="muted" style="color:var(--yellow)">${esc(sh.error)}</p>`;
    body += `<div>` + list.map(p => `<button class="it${cur.playlistId === p.id ? ' on' : ''}" data-act="pick-one" data-id="${esc(p.id)}"><i class="art">${I.note}</i><span class="t"><b>${esc(p.name)}</b><em>${p.count != null ? p.count + ' songs · ' : ''}${p.owned ? 'Yours' : 'By ' + esc(p.owner || 'someone else') + ' · Continue only'}</em></span>${cur.playlistId === p.id ? '<span class="sel">✓ Picked</span>' : ''}</button>`).join('') + `</div>`;
    if (!sh.loading && !sh.error && !list.length) body += `<p class="muted">${q ? 'No playlists match.' : 'No playlists in your Spotify library yet.'}</p>`;
  } else if (sh.kind === 'share') {
    title = 'Send presets';
    body = `<p class="muted" style="color:var(--soft)">Open this link on the other phone or iPad. It adds these ${S.presets.length} preset${S.presets.length > 1 ? 's' : ''} there (music choices included). Playlist places stay on each device.</p>
      <input class="link" id="share-link" readonly value="${esc(sh.link)}" aria-label="Share link">
      <div class="addrow">${navigator.share ? '<button class="btn primary" data-act="share-send">Send…</button>' : ''}<button class="btn" data-act="share-copy">Copy link</button></div>`;
  } else if (sh.kind === 'import') {
    title = 'Add presets';
    body = `<p class="muted" style="color:var(--soft)">This link has ${sh.presets.length} preset${sh.presets.length > 1 ? 's' : ''}: ${sh.presets.map(p => '<b>' + esc(p.name) + '</b>').join(', ')}. Presets with the same name already on this device are updated; the rest are added.</p>
      <div class="addrow"><button class="btn primary" data-act="import-yes">Add presets</button><button class="btn" data-act="close">Not now</button></div>`;
  } else if (sh.kind === 'settings') {
    title = 'Sound and music';
    body = `<div class="card rows">
      <div class="rowi"><div class="t"><b>Start music early</b><em>Covers Spotify’s delay so songs land on the beep. ${settings.leadAuto ? 'Tuned automatically.' : 'Set by hand.'}</em></div>
        <div class="step"><button data-act="lead" data-d="-0.1" aria-label="Earlier less">−</button><b>${settings.lead.toFixed(1)} s</b><button data-act="lead" data-d="0.1" aria-label="Earlier more">+</button></div></div>
      <div class="rowi"><div class="t"><b>Tune automatically</b><em>Measures the delay on the first switches of each workout</em></div><button class="tg" role="switch" aria-checked="${settings.leadAuto}" data-act="lead-auto" aria-label="Tune automatically"><b>${settings.leadAuto ? 'On' : 'Off'}</b><i></i></button></div>
      <div class="rowi"><div class="t"><b>Spotify</b><em>${spotify.connected ? esc(spotify.name || 'Connected') + (settings.deviceName ? ' · plays on ' + esc(settings.deviceName) : '') : 'Not connected'}</em></div>${spotify.connected ? '<button class="btn" data-act="sp-out">Disconnect</button>' : '<button class="btn primary" data-act="sp-in">Connect</button>'}</div>
      <div class="rowi"><div class="t"><b>Playlist places</b><em>Every playlist picks up where it left off</em></div><button class="btn" data-act="reset-places">Start from the top</button></div>
      <div class="rowi"><div class="t"><b>Sound check</b><em>Checks beeps and voice over Spotify</em></div><a class="btn" href="soundcheck/">Open</a></div>
    </div>`;
  }
  return `<div class="sheet" data-act="sheet-bg"><div class="box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hd"><button class="btn ghost" data-act="close" style="min-width:72px;justify-content:flex-start">${sh.kind === 'pick' ? 'Cancel' : 'Close'}</button><h2>${esc(title)}</h2><span style="min-width:72px"></span></div><div class="bd">${body}</div></div></div>`;
}

// ---------- running ----------
function phaseWord(ph) {
  return ph === 'work' ? `${I.tri}WORK` : ph === 'rest' ? `${I.bars}REST` : `${I.timer}GET READY`;
}

function vRun() {
  const r = S.run, p = r.now(), pr = r.preset, s = r.schedule;
  const ph = p.phase === 'done' ? 'rest' : p.phase;
  const slot = ph === 'work' ? pr.workMusic : ph === 'rest' ? pr.restMusic : null;
  const nextSlot = ph === 'work' ? pr.restMusic : pr.workMusic;
  const nextName = ph === 'work' ? 'rest' : 'work';
  let dots = '';
  if (s.cycles <= 40) for (let i = 1; i <= s.cycles; i++) dots += `<i class="${i < p.cycle ? 'd' : i === p.cycle && ph !== 'ready' ? 'c' : ''}"></i>`;
  const lu = music.lineup(nextSlot);
  const nextLabel = ph === 'ready' ? `▲ Work ${clock(s.work)}` : ph === 'work' ? (s.rest ? `❚❚ Rest ${clock(s.rest)}` : (p.cycle < s.cycles ? `▲ Work ${clock(s.work)}` : 'Finish')) : (p.cycle < s.cycles ? `▲ Work ${clock(s.work)} · cycle ${p.cycle + 1}` : 'Finish');
  const playing = slot && slot.source === 'spotify' && slot.playlistId;
  const problem = music.problem;
  return `<div class="run ${ph}" id="run"><div class="grid"><div class="main">
    <div class="rbar"><button class="end" id="end" aria-label="Hold to end the workout"><i></i>Hold to end</button><span class="nm">${esc(pr.name)}</span>
      <span class="cyc" aria-label="Cycle ${p.cycle} of ${s.cycles}">${ph === 'ready' ? '' : `${p.cycle}<em> / ${s.cycles}</em>`}</span></div>
    ${ph === 'ready' ? '' : `<div class="dots" aria-hidden="true">${dots}</div>`}
    <div class="mid"><p class="word">${phaseWord(ph)}</p><p class="big" id="big" aria-live="off">${clock(r.shown())}</p>
      ${ph === 'ready' ? `<p class="under" style="justify-content:center">Beeps at 3 · 2 · 1, then “Work”</p>` : `<div class="prog" aria-hidden="true"><i id="prog"></i></div>
      <div class="under"><span>${r.paused ? 'Paused' : 'Next: ' + nextLabel}</span><span><span id="left">${clock(r.totalLeft())}</span> left</span></div>`}</div>
  </div><div class="side">
    ${problem ? `<div class="rerr" role="alert">${esc(problem)}</div>` : ''}
    ${playing ? `<div class="np"><i class="art">${I.note}</i><span class="t"><b>${esc(music.now.title || 'Starting…')}</b><em>${esc([music.now.artist, slot.playlistName, modeWord(slot)].filter(Boolean).join(' · '))}</em></span><button class="skip" data-act="skip-song" aria-label="Next song">${I.skipSong}</button></div>` : ''}
    ${lu ? `<div class="queued"><span>Lined up for ${nextName}: ${esc(lu.name)}, song ${lu.index + 1}${lu.pos > 1000 ? ' from ' + clock(lu.pos / 1000) : ''}</span><span>✓ Ready</span></div>` : ''}
    <div class="ctl"><button class="p" data-act="pause">${r.paused ? I.play + 'Resume' : I.pause + 'Pause'}</button><button data-act="skip">${I.fwd}${ph === 'ready' ? 'Start now' : ph === 'work' ? (s.rest ? 'Skip to rest' : 'Skip') : (p.cycle < s.cycles ? 'Skip to work' : 'Finish')}</button></div>
  </div></div></div>`;
}

function drawRun(force) {
  const r = S.run; if (!r) return;
  const p = r.now();
  const key = `${p.phase}|${p.cycle}|${r.paused}|${music.problem}|${music.now.title}`;
  if (force || key !== S.runKey) { S.runKey = key; app.innerHTML = vRun(); wireHold(); }
  const big = $('#big'); if (big) { const t = clock(r.shown()); if (big.textContent !== t) big.textContent = t; }
  const left = $('#left'); if (left) { const t = clock(r.totalLeft()); if (left.textContent !== t) left.textContent = t; }
  const prog = $('#prog'); if (prog && p.length) prog.style.width = `${Math.min(100, Math.max(0, (1 - p.left / p.length) * 100))}%`;
}

let raf = null;
function frame() { if (S.view !== 'run') { raf = null; return; } drawRun(false); raf = requestAnimationFrame(frame); }

function wireHold() {
  const b = $('#end'); if (!b) return;
  let t = null;
  const stop = () => { clearTimeout(t); t = null; b.classList.remove('hold'); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('hold'); t = setTimeout(() => { stop(); S.run.end(); }, 800); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { if (t) { stop(); toast('Hold the button to end the workout.'); } }));
  b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.run.end(); } });
  b.addEventListener('contextmenu', e => e.preventDefault());
}

let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {} }
function letSleep() { try { wake && wake.release(); } catch (e) {} wake = null; }

async function startRun(preset, skipMusic) {
  await cues.start();                       // first, while we're still inside the tap
  keepAwake();
  const p = skipMusic ? { ...preset, workMusic: store.blankMusic(), restMusic: store.blankMusic() } : preset;
  S.view = 'loading'; S.loadErr = null; S.preset = preset; render();
  try { await music.begin([p.workMusic, p.restMusic]); }
  catch (e) { S.loadErr = e.message || String(e); render(); return; }
  if (S.run) S.run.stop();
  S.run = createRun(p, { cues, music, onPhase: () => {}, onEnd: () => { S.view = 'done'; letSleep(); render(); } });
  S.view = 'run'; S.runKey = '';
  S.run.start();
  drawRun(true);
  if (!raf) raf = requestAnimationFrame(frame);
}

function vLoading() {
  if (!S.loadErr) return `<div class="loading"><div class="box"><p class="word" style="font-size:40px;color:var(--yellow)">${I.timer}GET READY</p><p class="muted">Getting the music ready…</p></div></div>`;
  return `<div class="loading"><div class="box"><p class="word" style="font-size:36px;color:var(--yellow)">Music isn’t ready</p><p style="color:var(--soft);margin:0">${esc(S.loadErr)}</p>
    <div class="addrow" style="justify-content:center"><button class="btn primary" data-act="retry">Try again</button><button class="btn" data-act="no-music">Start without music</button><button class="btn" data-act="home">Back</button></div></div></div>`;
}

// ---------- render ----------
function render() {
  if (S.view === 'run') { drawRun(true); return; }
  const v = S.view === 'edit' ? vEdit() : S.view === 'done' ? vDone() : S.view === 'loading' ? vLoading() : vHome();
  app.innerHTML = v + vSheet();
  document.body.style.overflow = S.sheet ? 'hidden' : '';
}

function openEdit(p, isNew) {
  S.draft = JSON.parse(JSON.stringify(p));
  S.draft.workText = clock(p.work); S.draft.restText = clock(p.rest);
  S.isNew = isNew; S.view = 'edit'; S.sheet = null; render(); window.scrollTo(0, 0);
}

// Reads the edit form into a preset, or returns an error message.
function fromDraft() {
  const d = S.draft;
  const w = parseTime(d.workText), r = parseTime(d.restText);
  if (!(w > 0)) return 'Work needs a time, like 0:20 or 2:00.';
  if (r === null || r < 0) return 'Rest needs a time, like 0:10, or 0 for none.';
  const p = { ...d, work: w, rest: r, name: (d.name || '').trim() || `${clock(w)} / ${clock(r)} × ${d.cycles}` };
  delete p.workText; delete p.restText;
  return p;
}

function upsert(p) {
  const i = S.presets.findIndex(x => x.id === p.id);
  if (i >= 0) S.presets[i] = p; else S.presets.push(p);
  savePresets();
}

async function openPicker(which) {
  if (!spotify.connected) { toast('Connect Spotify first (home screen).'); return; }
  S.sheet = { kind: 'pick', which, q: '', loading: true, lists: S.lists || [] };
  render();
  try { S.lists = await spotify.playlists(); if (S.sheet && S.sheet.kind === 'pick') { S.sheet.lists = S.lists; S.sheet.loading = false; render(); } }
  catch (e) { if (S.sheet) { S.sheet.loading = false; S.sheet.error = e.message; render(); } }
}

app.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'sheet-bg' && e.target !== b) return;
  const d = S.draft;
  const slot = w => d[w === 'work' ? 'workMusic' : 'restMusic'];
  switch (a) {
    case 'new': openEdit(store.newPreset(), true); break;
    case 'edit': openEdit(S.presets.find(p => p.id === b.dataset.id), false); break;
    case 'start': startRun(S.presets.find(p => p.id === b.dataset.id)); break;
    case 'cancel': S.view = 'home'; S.draft = null; render(); break;
    case 'save': case 'save-start': {
      const p = fromDraft();
      if (typeof p === 'string') { toast(p); break; }
      upsert(p); S.draft = null;
      if (a === 'save-start') startRun(p); else { S.view = 'home'; render(); toast('Saved'); }
      break;
    }
    case 'del':
      if (confirm(`Delete “${d.name || 'this preset'}”?`)) { S.presets = S.presets.filter(p => p.id !== d.id); savePresets(); S.view = 'home'; S.draft = null; render(); }
      break;
    case 'cyc': d.cycles = Math.min(99, Math.max(1, d.cycles + +b.dataset.d)); render(); break;
    case 'gr': d.getReady = Math.min(10, Math.max(0, d.getReady + +b.dataset.d)); render(); break;
    case 'tog': d[b.dataset.k] = !d[b.dataset.k]; render(); break;
    case 'src': { const m = slot(b.dataset.w); m.source = b.dataset.v; if (m.source === 'spotify' && !m.playlistId) { render(); openPicker(b.dataset.w); } else render(); break; }
    case 'pick': openPicker(b.dataset.w); break;
    case 'pick-one': {
      const pl = (S.sheet.lists || []).find(p => p.id === b.dataset.id), m = slot(S.sheet.which);
      Object.assign(m, { source: 'spotify', playlistId: pl.id, playlistName: pl.name, owned: pl.owned });
      if (!pl.owned) { m.mode = 'resume'; m.shuffle = false; }
      S.sheet = null; render(); break;
    }
    case 'mode': slot(b.dataset.w).mode = b.dataset.v; render(); break;
    case 'shuf': { const m = slot(b.dataset.w); m.shuffle = !m.shuffle; render(); break; }
    case 'close': case 'sheet-bg': S.sheet = null; render(); break;
    case 'settings': S.sheet = { kind: 'settings' }; render(); break;
    case 'lead': settings.lead = Math.round(Math.min(2, Math.max(0, settings.lead + +b.dataset.d)) * 10) / 10; settings.leadAuto = false; store.saveSettings(settings); render(); break;
    case 'lead-auto': settings.leadAuto = !settings.leadAuto; store.saveSettings(settings); render(); break;
    case 'reset-places': if (confirm('Start every playlist from its first song next time?')) { store.resetPlaces(); toast('Playlists will start from the top'); } break;
    case 'sp-in': try { await spotify.signIn(); } catch (err) { toast(err.message); } break;
    case 'sp-out': spotify.signOut(); S.lists = null; render(); break;
    case 'share': S.sheet = { kind: 'share', link: store.shareLink(S.presets, location.origin + location.pathname) }; render(); break;
    case 'share-copy': try { await navigator.clipboard.writeText(S.sheet.link); toast('Link copied'); } catch (err) { const i = $('#share-link'); i.select(); toast('Select and copy the link'); } break;
    case 'share-send': try { await navigator.share({ title: 'Interval timer presets', url: S.sheet.link }); } catch (err) {} break;
    case 'import-yes': {
      const n = S.sheet.presets.length;
      S.presets = store.mergePresets(S.presets, S.sheet.presets); savePresets(); S.sheet = null; render();
      toast(`Added ${n} preset${n > 1 ? 's' : ''}`); break;
    }
    case 'retry': startRun(S.preset); break;
    case 'no-music': startRun(S.preset, true); break;
    case 'home': if (S.run) S.run.stop(); S.view = 'home'; S.run = null; letSleep(); render(); break;
    case 'again': startRun(S.preset); break;
    case 'pause': S.run.togglePause(); drawRun(true); break;
    case 'skip': S.run.skip(); drawRun(true); break;
    case 'skip-song': music.skipSong(); break;
  }
});

app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'e-name') S.draft.name = t.value;
  else if (t.id === 'e-work') S.draft.workText = t.value;
  else if (t.id === 'e-rest') S.draft.restText = t.value;
  else if (t.id === 'pick-q') { S.sheet.q = t.value; const pos = t.selectionStart; render(); const q = $('#pick-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
});
// Times are checked when you leave the box, so typing isn't interrupted.
app.addEventListener('change', e => { if (e.target.id === 'e-work' || e.target.id === 'e-rest') render(); });
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && S.view === 'edit') e.target.blur(); });
document.addEventListener('keydown', e => {
  if (S.view !== 'run' || e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); S.run.togglePause(); drawRun(true); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (S.view === 'run' && S.run) S.run.poke(); return; }
  if (S.view === 'run' && S.run) { cues.resume(); S.run.catchUp(); keepAwake(); drawRun(true); }
});

// ---------- start-up ----------
(async () => {
  // Back from Spotify's sign-in page.
  try {
    if (await spotify.finishSignIn(location.search)) toast('Spotify connected');
  } catch (e) { toast(e.message); }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  // A presets link.
  const incoming = store.presetsFromHash(location.hash);
  if (incoming && incoming.length) { S.sheet = { kind: 'import', presets: incoming }; history.replaceState(null, '', location.pathname); }
  render();
  try { const r = await fetch('voice/work.wav', { method: 'HEAD' }); S.voiceReady = r.ok; } catch (e) {}
})();

window.GIT = { S, music, spotify, cues, settings };   // for tests
