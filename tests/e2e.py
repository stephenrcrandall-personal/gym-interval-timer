# End-to-end checks with a fake Spotify and a fast-forwarded clock.
# Run: python3 tests/e2e.py   (needs: pip install playwright; playwright install chromium)
import os, json, threading, http.server, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FAKE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake.js')
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8821), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:8821/'
CLIPS = ['get-ready', 'work', 'rest', 'halfway', 'last-one']
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label); ok = ok and bool(c)

def route(r):
    u = r.request.url
    if '/voice/' in u:
        name = u.rsplit('/', 1)[-1].replace('.wav', '')
        return r.fulfill(status=200, body=name, content_type='audio/wav') if name in CLIPS else r.fulfill(status=404, body='')
    if u.startswith('http://127.0.0.1'): return r.continue_()
    return r.fulfill(status=200, body='', content_type='text/css')   # fonts etc.

def page_for(b, w=1180, h=820, pre='', voice=True):
    ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=False)
    ctx.route('**/*', route if voice else (lambda r: r.fulfill(status=404, body='') if '/voice/' in r.request.url else route(r)))
    if pre: ctx.add_init_script(pre)
    ctx.add_init_script(path=FAKE)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install()
    pg.goto(URL); pg.wait_for_selector('.pre, .sheet')
    return ctx, pg, errs

def anchor(pg):
    return pg.evaluate('performance.now() - window.GIT.S.run.elapsed() * 1000')

def go(pg, a, rel):
    d = a + rel * 1000 - pg.evaluate('performance.now()')
    if d > 0: pg.clock.run_for(int(round(d)))

def plays(pg, a):
    return [dict(c, rel=(c['t'] - a) / 1000) for c in pg.evaluate('__sp.calls') if c['path'].endswith('/play') and c['body']]

def make_preset(pg, name, work, rest, cycles, ready, wmusic=None, rmusic=None):
    pg.click('[data-act="new"]')
    pg.fill('#e-name', name); pg.fill('#e-work', work); pg.press('#e-work', 'Tab'); pg.fill('#e-rest', rest); pg.press('#e-rest', 'Tab')
    for _ in range(10 - cycles): pg.click('[data-act="cyc"][data-d="-1"]')
    for _ in range(max(0, cycles - 10)): pg.click('[data-act="cyc"][data-d="1"]')
    for _ in range(10 - ready): pg.click('[data-act="gr"][data-d="-1"]')
    for which, m in (('work', wmusic), ('rest', rmusic)):
        if not m: continue
        pg.click(f'[data-act="src"][data-w="{which}"][data-v="spotify"]')
        pg.wait_for_selector(f'[data-act="pick-one"][data-id="{m["id"]}"]'); pg.click(f'[data-act="pick-one"][data-id="{m["id"]}"]')
        if m.get('mode'): pg.click(f'[data-act="mode"][data-w="{which}"][data-v="{m["mode"]}"]')
        if m.get('shuffle'): pg.click(f'[data-act="shuf"][data-w="{which}"]')

def start_and_wait(pg):
    pg.click('[data-act="save-start"]')
    pg.wait_for_function('window.GIT.S.view === "run"')
    return anchor(pg)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- 1. A full run: timing, display, cues, music switches ----------
    ctx, pg, errs = page_for(b)
    check(pg.locator('.pre h2').first.inner_text() == 'Tabata', 'starter preset: Tabata')
    make_preset(pg, 'Test', '0:20', '0:10', 3, 5, {'id': 'pw'}, {'id': 'pr', 'mode': 'next'})
    check('3 × (0:20 + 0:10)' in pg.inner_text('.tot') and '1:30' in pg.inner_text('.tot'), 'edit: total 3 × (0:20 + 0:10) = 1:30')
    a = start_and_wait(pg)
    check(pg.locator('#run.ready').count() == 1 and pg.inner_text('#big') == '0:05', 'get ready shows 0:05 in yellow screen')
    seen = {}
    for rel in [0.99, 1.01, 4.99, 5.01, 5.99, 6.01, 24.99, 25.01, 34.99, 35.01, 94.01]:
        go(pg, a, rel); seen[rel] = (pg.evaluate('document.getElementById("run") && document.getElementById("run").className'), pg.evaluate('document.getElementById("big") && document.getElementById("big").textContent'))
    check(seen[0.99][1] == '0:05' and seen[1.01][1] == '0:04', 'countdown changes exactly on the second (0:05 → 0:04 at 1.00 s)')
    check(seen[4.99] == ('run ready', '0:01') and seen[5.01] == ('run work', '0:20'), 'get ready → WORK at 5.00 s, showing 0:20')
    check(seen[5.99][1] == '0:20' and seen[6.01][1] == '0:19', 'work: 0:20 → 0:19 at 6.00 s')
    print('   seen:', seen)
    check(seen[24.99] == ('run work', '0:01') and seen[25.01] == ('run rest', '0:10'), 'WORK → REST at 25.00 s')
    check(seen[34.99][0] == 'run rest' and seen[35.01] == ('run work', '0:20'), 'REST → WORK (cycle 2) at 35.00 s')
    check(seen[94.01][0] == 'run rest' and seen[94.01][1] == '0:01', 'last rest still counting at 94 s')
    go(pg, a, 95.2)
    check(pg.locator('.done h1').count() == 1 and 'Done · Test' in pg.inner_text('.done h1'), 'finishes at 95 s with the Done screen')
    # sounds
    snd = pg.evaluate('__audio.map(s => [__label(s), s.when])')
    snd = [(l, round(w * 1000 - a) / 1000) for l, w in snd]
    longs = sorted(t for l, t in snd if l == 'long'); shorts = sorted(t for l, t in snd if l == 'short')
    check(all(abs(x - y) < 0.003 for x, y in zip(longs, [5, 25, 35, 55, 65, 85, 95])) and len(longs) == 7, f'long beep exactly at every switch and the end {longs}')
    exp_short = sorted([2, 3, 4] + [b_ - n for b_ in [25, 35, 55, 65, 85, 95] for n in (3, 2, 1)])
    check(len(shorts) == len(exp_short) and all(abs(x - y) < 0.003 for x, y in zip(shorts, exp_short)), '3-2-1 beeps exactly 3, 2 and 1 s before every switch')
    clips = sorted((t, l) for l, t in snd if l in CLIPS)
    want = [(0.05, 'get-ready'), (5.55, 'work'), (25.55, 'rest'), (35.55, 'work'), (55.55, 'halfway'), (56.45, 'rest'), (65.55, 'last-one'), (85.55, 'rest')]
    print('   clips:', clips)
    check(len(clips) == len(want) and all(abs(c[0] - w[0]) < 0.003 and c[1] == w[1] for c, w in zip(clips, want)), f'voice: get ready, work, rest, halfway, last one at the right moments')
    # music
    pl = plays(pg, a)
    bounds = [5, 25, 35, 55, 65, 85]
    check(len(pl) == 6, f'six music switches ({len(pl)})')
    early = [round(b_ - c['rel'], 3) for b_, c in zip(bounds, pl)]
    check(all(0.4 <= e <= 0.85 for e in early), f'each switch sent early to cover the delay: {early}')
    lead = pg.evaluate('window.GIT.settings.lead')
    check(0.55 <= lead <= 0.75, f'start-early time tunes itself toward the real 0.7 s delay ({lead})')
    bd = [c['body'] for c in pl]
    check(bd[0] == {'context_uri': 'spotify:playlist:pw', 'offset': {'uri': 'spotify:track:5x0'}}, 'work 1: work playlist from its first song')
    check(bd[1] == {'context_uri': 'spotify:playlist:pr', 'offset': {'uri': 'spotify:track:4x0'}}, 'rest 1: rest playlist from its first song')
    p2 = bd[2].get('position_ms', 0)
    check(bd[2]['offset']['uri'] == 'spotify:track:5x0' and 18500 <= p2 <= 20500, f'work 2 (Continue): same song, picked up where it stopped ({p2} ms)')
    check(bd[3]['offset']['uri'] == 'spotify:track:4x1' and 'position_ms' not in bd[3], 'rest 2 (Next track): the next song, from the start')
    p3 = bd[4].get('position_ms', 0)
    check(bd[4]['offset']['uri'] == 'spotify:track:5x0' and abs(p3 - p2 - 20000) < 800, f'work 3 (Continue): about 20 s further in ({p3} ms)')
    check(bd[5]['offset']['uri'] == 'spotify:track:4x2', 'rest 3 (Next track): song 3')
    calls = pg.evaluate('__sp.calls.map(c => c.path)')
    check(calls[-1].endswith('/pause') or '/me/player/pause' in calls[-3:] or any(c.endswith('/pause') for c in calls[-4:]), 'music stops at the end')
    picks = pg.inner_text('.done')
    check('Work · Work mix, song 1 at' in picks and 'Rest · Rest mix, next up song 4' in picks, 'Done screen says where each playlist picks up')
    # next workout continues from there
    pg.click('[data-act="again"]'); pg.wait_for_function('window.GIT.S.view === "run"'); a2 = anchor(pg)
    go(pg, a2, 26)
    pl2 = plays(pg, a2)
    pl2 = [c for c in pl2 if c['rel'] > 0]
    check(pl2[0]['body']['offset']['uri'] == 'spotify:track:5x0' and pl2[0]['body'].get('position_ms', 0) > 55000, 'next workout: work playlist picks up where the last one ended')
    check(pl2[1]['body']['offset']['uri'] == 'spotify:track:4x3', 'next workout: rest playlist moves on to the next song')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 2. Pause, resume, skip, hold to end ----------
    ctx, pg, errs = page_for(b)
    make_preset(pg, 'Ctl', '0:20', '0:10', 2, 0, {'id': 'pw'}, {'id': 'pr'})
    a = start_and_wait(pg)
    check(pg.locator('#run.work').count() == 1, 'no get ready: starts straight on WORK')
    go(pg, a, 7.5)
    pg.click('[data-act="pause"]')
    n_audio = pg.evaluate('__audio.length')
    pg.clock.run_for(30000)
    check(pg.inner_text('#big') == '0:13' and 'Paused' in pg.inner_text('.under'), 'paused for 30 s: still 0:13, says Paused')
    check(pg.evaluate('__sp.calls.some(c => c.path.endsWith("/pause"))'), 'pause pauses Spotify')
    stopped = pg.evaluate('__audio.filter(s => s.stopped).length')
    check(stopped >= 1, 'beeps already lined up are cancelled on pause')
    pg.click('[data-act="pause"]')
    check(pg.evaluate('__sp.calls.some(c => c.path.endsWith("/play") && !c.body)'), 'resume resumes Spotify')
    pg.clock.run_for(1000)
    check(pg.inner_text('#big') == '0:12', 'resumes from where it paused')
    pg.click('[data-act="skip"]'); pg.clock.run_for(100)
    check(pg.locator('#run.rest').count() == 1 and pg.inner_text('#big') == '0:10', 'skip: REST starts at once with its full 0:10')
    last = [c for c in pg.evaluate('__sp.calls') if c['path'].endswith('/play') and c['body']][-1]
    check(last['body']['context_uri'] == 'spotify:playlist:pr', 'skip: rest music switches at once')
    pg.dispatch_event('#end', 'pointerdown'); pg.clock.run_for(300); pg.dispatch_event('#end', 'pointerup'); pg.clock.run_for(100)
    check(pg.locator('#run').count() == 1, 'a short tap on Hold to end does nothing (shows a hint)')
    pg.dispatch_event('#end', 'pointerdown'); pg.clock.run_for(900)
    check(pg.locator('.done h1').count() == 1 and 'Ended' in pg.inner_text('.done h1'), 'holding 0.8 s ends the workout')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 3. Shuffle: no repeats until every song has played ----------
    ctx, pg, errs = page_for(b)
    make_preset(pg, 'Shuf', '0:03', '0:03', 8, 0, None, {'id': 'pr', 'mode': 'next', 'shuffle': True})
    a = start_and_wait(pg)
    go(pg, a, 49)
    rp = [c['body'] for c in plays(pg, a)]
    firsts = [bd['uris'][0] for bd in rp]
    check(len(rp) == 8 and all('uris' in bd and bd['offset'] == {'position': 0} for bd in rp), 'shuffle plays our own order as a song list')
    check(len(set(firsts[:4])) == 4 and len(set(firsts[4:])) == 4, f'every song once before any repeats: {[f[-3:] for f in firsts]}')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 4. Someone else's playlist: Continue only ----------
    ctx, pg, errs = page_for(b, 390, 844)
    pg.click('[data-act="new"]'); pg.click('[data-act="src"][data-w="work"][data-v="spotify"]')
    pg.wait_for_selector('[data-act="pick-one"][data-id="px"]')
    check('Continue only' in pg.inner_text('[data-act="pick-one"][data-id="px"]'), 'picker marks a Spotify-made playlist "Continue only"')
    pg.click('[data-act="pick-one"][data-id="px"]')
    check(pg.locator('[data-act="mode"][data-w="work"][data-v="next"]').is_disabled() and pg.locator('[data-act="shuf"][data-w="work"]').is_disabled(), 'Next track and Shuffle are off for it, with a reason')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 5. Spotify not open: clear message, can start without music ----------
    ctx, pg, errs = page_for(b, pre='window.__noDevices = true')
    pg.evaluate('__sp.devices = []')
    make_preset(pg, 'Nodev', '0:20', '0:10', 2, 5, {'id': 'pw'}, None)
    pg.click('[data-act="save-start"]'); pg.wait_for_selector('[data-act="no-music"]')
    check('open the Spotify app' in pg.inner_text('.loading').lower() or 'open the spotify app' in pg.inner_text('.loading').lower(), 'says to open Spotify when it isn’t running')
    pg.click('[data-act="no-music"]'); pg.wait_for_function('window.GIT.S.view === "run"')
    check(pg.locator('#run.ready').count() == 1, '"Start without music" runs the timer')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 6. Send presets to another device ----------
    ctx, pg, errs = page_for(b)
    make_preset(pg, 'Forty-Five Alive', '2:00', '0:30', 18, 10, {'id': 'pw'}, {'id': 'pr', 'mode': 'next', 'shuffle': True})
    pg.click('[data-act="save"]'); pg.click('[data-act="share"]')
    link = pg.input_value('#share-link')
    check(link.startswith(URL + '#presets='), 'share link made')
    ctx.close()
    ctx, pg, errs = page_for(b, 390, 844)
    pg.goto(link.replace('127.0.0.1:8821/', '127.0.0.1:8821/index.html')); pg.wait_for_selector('[data-act="import-yes"]')
    check('Forty-Five Alive' in pg.inner_text('.sheet'), 'other device: asks to add the presets')
    pg.click('[data-act="import-yes"]')
    names = pg.locator('.pre h2').all_inner_texts()
    print('   names:', names, pg.inner_text('.pre >> nth=1') if len(names) > 1 else '')
    check(names == ['Tabata', 'Forty-Five Alive'] and '45:00' in pg.inner_text('.pre >> nth=1'), 'other device: preset added with its times and music')
    check('#' not in pg.url, 'link cleared from the address bar after adding')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 7. Layouts: phone and iPad, nothing wider than the screen ----------
    for (w, h, tag) in [(390, 844, 'phone'), (1180, 820, 'ipad'), (820, 1180, 'ipad-portrait')]:
        ctx, pg, errs = page_for(b, w, h)
        shots = {}
        pg.screenshot(path=f'/tmp/git-{tag}-home.png'); shots['home'] = pg.evaluate('document.documentElement.scrollWidth')
        pg.click('[data-act="new"]'); pg.click('[data-act="src"][data-w="work"][data-v="spotify"]'); pg.wait_for_selector('[data-act="pick-one"]'); pg.click('[data-act="pick-one"][data-id="pw"]')
        pg.screenshot(path=f'/tmp/git-{tag}-edit.png', full_page=True); shots['edit'] = pg.evaluate('document.documentElement.scrollWidth')
        pg.fill('#e-name', 'Forty-Five Alive'); pg.fill('#e-work', '2:00'); pg.press('#e-work', 'Tab'); pg.fill('#e-rest', '0:30'); pg.press('#e-rest', 'Tab')
        for _ in range(8): pg.click('[data-act="cyc"][data-d="1"]')
        pg.click('[data-act="src"][data-w="rest"][data-v="spotify"]'); pg.wait_for_selector('[data-act="pick-one"]'); pg.click('[data-act="pick-one"][data-id="pr"]')
        pg.click('[data-act="save-start"]'); pg.wait_for_function('window.GIT.S.view === "run"'); a = anchor(pg)
        go(pg, a, 10 + 120 * 0 + 18.4); pg.screenshot(path=f'/tmp/git-{tag}-work.png'); shots['work'] = pg.evaluate('document.documentElement.scrollWidth')
        go(pg, a, 10 + 120 + 18); pg.screenshot(path=f'/tmp/git-{tag}-rest.png')
        fits = pg.evaluate('(() => { const r = document.getElementById("run").getBoundingClientRect(); const els = [...document.querySelectorAll("#run *")]; return els.every(e => { const b = e.getBoundingClientRect(); return b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; }); })()')
        check(all(v <= w for v in shots.values()), f'{tag}: no sideways scrolling on home, edit or the timer {shots}')
        check(fits, f'{tag}: the whole timer screen fits without scrolling')
        check(errs == [], f'{tag}: no page errors {errs}')
        ctx.close()

    # ---------- 8. No voice clips yet: beeps still work ----------
    ctx, pg, errs = page_for(b, voice=False)
    make_preset(pg, 'NoVoice', '0:05', '0:05', 1, 3)
    a = start_and_wait(pg)
    go(pg, a, 14)
    labels = pg.evaluate('__audio.map(__label)')
    check('long' in labels and 'short' in labels and not any(l in CLIPS for l in labels), 'without voice clips: beeps only, no errors')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    # ---------- 9. Browser slows the page's timers (window behind another app): no cue is dropped ----------
    SLOW = "(() => { const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, Math.max(ms, 1000), ...a); })()"
    ctx, pg, errs = page_for(b, pre=SLOW)
    make_preset(pg, 'Slow', '0:20', '0:10', 3, 5)
    a = start_and_wait(pg)
    go(pg, a, 96)
    snd = sorted((round(w * 1000 - a) / 1000, l) for l, w in pg.evaluate('__audio.map(s => [__label(s), s.when])'))
    clips = [(t, l) for t, l in snd if l in CLIPS]
    want = [(0.05, 'get-ready'), (5.55, 'work'), (25.55, 'rest'), (35.55, 'work'), (55.55, 'halfway'), (56.45, 'rest'), (65.55, 'last-one'), (85.55, 'rest')]
    check(len(clips) == len(want) and all(abs(c[0] - w[0]) < 0.003 and c[1] == w[1] for c, w in zip(clips, want)), f'timers slowed to once a second: every voice cue still plays on time {clips}')
    check(len([1 for t, l in snd if l == 'long']) == 7 and len([1 for t, l in snd if l == 'short']) == 21, 'timers slowed: every beep still plays')
    check(errs == [], f'no page errors {errs}')
    ctx.close()

    b.close()
    print('ALL PASS' if ok else 'SOME FAILED')
