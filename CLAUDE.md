# Gym Interval Timer — project notes

Read this first when picking the project back up.

## What it is
A web interval timer for a friend's home gym, run on an iPad (or an iPhone as a backup) connected to a Bluetooth speaker. Same idea as the interval timer in Hybrid Log (stephenrcrandall-personal/training-log, `HybridLog/IntervalTimer/`), rebuilt for the web so it works with Spotify as well as Apple Music: work / rest / cycles / get-ready, a work playlist and a rest playlist that each keep their place (Continue or Next track, optional Shuffle), 3-2-1 beeps and spoken "Work" / "Rest" / "Halfway" / "Last one", presets. Separate from Hybrid Log: no shared code, data or accounts.

## Decisions so far (Oct 30, 2026)
- Plain static web app (HTML/CSS/JS, no build step), hosted on GitHub Pages from `main` (repo is public; nothing secret goes in it). Added to the Home Screen on the iPad and phone.
- The timer is used with the screen on, at the gym (no pocket/locked use), so the page keeps the screen awake.
- Must work and be easy to use on both iPad (landscape) and iPhone (portrait).
- Spotify: the Web API controls the Spotify app on the same device (Spotify Connect): start a playlist at a song and position, read what's playing. Sign-in with Authorization Code + PKCE (no client secret). The Spotify developer app is registered under the owner's Premium account; the friend's Spotify account is added as a user (Development Mode: up to 5 users, owner must keep Premium; playlist items readable only for playlists the user owns or collaborates on).
- Hiding Spotify's switch delay: work out the next playlist/song/position ahead of time, track the current song's position so nothing is fetched at the switch, and send the switch early by a measured lead time (auto-tuned, shown as "Start music early").
- Spotify app registered Oct 30 ("Gym Interval Timer", owner's account, Web API). Client ID and redirect URI (`https://stephenrcrandall-personal.github.io/gym-interval-timer/`) are in `config.js`. The friend's account is added under User Management. Never ask for or commit the Client Secret; PKCE doesn't use it.
- Apple Music: MusicKit JS plays inside the page (needs a MusicKit developer token from the owner's paid Apple Developer account; don't commit it — entered once in the app's settings).
- Timing: one steady clock (`performance.now()`), everything derived from time since start (pauses excluded), like Hybrid Log's `TimerSchedule`.
- Mockups: canvas "Gym Interval Timer" (https://claude.ai/artifact/XZ1d1ggV94qWw4TywsHHRS) — iPad Home, Edit preset, Work, Rest; approved Oct 30. Phone layouts (Phone · home, Phone · work) added Oct 30, approved Oct 30. Presets live on each device; "Send presets to another device" makes a link that copies them (no server, account or sync — the owner wants it kept simple).
- Colors as in Hybrid Log: work = mint filled screen with ▲ WORK, rest = black with a blue frame and ❚❚ REST, get ready = yellow. Every phase has a word and icon, not just a color (the owner is slightly red-green colorblind).

## Sound check (`soundcheck/`) — done Oct 30 on the owner's iPhone
Beeps through Web Audio play over Spotify without stopping it, in every audio-session mode (Standard, Mix, Mix + dip). Safari's speaking voice (speechSynthesis) dips Spotify and then stops it, in every mode. So the voice cues are recorded clips in `voice/` (`get-ready.wav`, `work.wav`, `rest.wav`, `halfway.wav`, `last-one.wav`), played through Web Audio like the beeps; a missing clip is just quiet. Added Oct 30: made by the owner on his Mac with `say` in Siri Voice 6 (set as the System voice), trimmed to start within 20 ms and evened out to the same volume. To redo them, regenerate with `say -o <name>.wav --data-format=LEI16@22050 "<phrase>"` and trim the same way. Re-check on the friend's iPad and speaker.

## How the app is built (Oct 30)
- `index.html` + `app.css` + `config.js` (Spotify Client ID, redirect) + ES modules in `js/`, no build step.
- `js/schedule.js`: seconds since start → phase, cycle, seconds left (port of Hybrid Log's TimerSchedule); `clock()`, `parseTime()` ("2:00", "0:30", bare number = seconds).
- `js/run.js`: one run. Keeps only elapsed time on `performance.now()`. Every beep, clip and music switch is a planned event; a 40 ms loop hands sounds to the audio clock 0.35 s ahead (so they land exactly) and fires music switches `lead` seconds early. Pause cancels lined-up sounds; skip jumps to the next phase start (its beep, voice and music happen at once); after the page was hidden, old sounds are skipped and the latest music switch still fires.
- `js/cues.js`: Web Audio beeps (880 Hz short, 1320 Hz long) and voice clips, scheduled by performance.now() time; clips load before the first run.
- `js/spotify.js`: PKCE sign-in, token refresh, playlists (`/me/playlists`), songs (`/playlists/{id}/items`, `item` or `track`), devices, player, play (playlist + offset uri + position, or a list of song uris), pause, resume, next, shuffle off, repeat context. Friendly messages for no device, Premium, 403 (user not added), 429.
- `js/music.js`: each playlist's place in localStorage `git-places` (key `spotify:<id>` plus `|shuffle`), Continue / Next track / Shuffle (own order played as a song list, reshuffled after every song has played), polling `/me/player` every 3 s to estimate where the song is at the switch, and auto-tuning `lead` from the first 4 switches of each run (measured start − request time, blended 60/40, 0.1–2 s). Playlists that aren't yours (Spotify won't list their songs) are Continue only.
- `js/store.js`: presets (`git-presets`, Tabata 0:20/0:10 × 8 seeded once), settings (`git-settings`: lead, leadAuto, device), share links (`#presets=` base64url JSON; on import, a preset with the same id or name is replaced).
- `js/app.js`: screens (home, edit, playlist picker, settings, run, done), hold-to-end (0.8 s), keep-screen-on (Wake Lock), Spotify sign-in return.
- Tests: `python3 tests/e2e.py` (Playwright with `tests/fake.js`: a fake Spotify answered in the page with a 0.7 s playback delay, a fake audio clock that records every scheduled sound, and a fast-forwarded page clock). Covers timing to the second, beeps and clips at exact times, switch bodies and early sending, lead tuning, Continue/Next/Shuffle, the next workout picking up, pause/resume/skip/hold to end, no device, share links, and layouts at 390×844, 1180×820 and 820×1180.

## Next
- Owner tests at his desk (Chrome + Spotify desktop app work the same way) and at the gym.
- Apple Music (MusicKit JS; developer token from the owner's account, entered in settings, not committed) after Spotify works.

## How to work on it
- Mock up UI changes on the canvas first, get approval, then build.
- After each change: test in a browser (Playwright), commit with a plain-English message, push to `main`. GitHub Pages republishes automatically.
- No zip files.
