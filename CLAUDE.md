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
- Apple Music: MusicKit JS plays inside the page (needs a MusicKit developer token from the owner's paid Apple Developer account; don't commit it — entered once in the app's settings).
- Timing: one steady clock (`performance.now()`), everything derived from time since start (pauses excluded), like Hybrid Log's `TimerSchedule`.
- Mockups: canvas "Gym Interval Timer" (https://claude.ai/artifact/XZ1d1ggV94qWw4TywsHHRS) — iPad Home, Edit preset, Work, Rest; approved Oct 30. Phone layouts (Phone · home, Phone · work) added Oct 30, approved Oct 30. Presets live on each device; "Send presets to another device" makes a link that copies them (no server, account or sync — the owner wants it kept simple).
- Colors as in Hybrid Log: work = mint filled screen with ▲ WORK, rest = black with a blue frame and ❚❚ REST, get ready = yellow. Every phase has a word and icon, not just a color (the owner is slightly red-green colorblind).

## Step 1: sound check (`soundcheck/`)
Beeps (Web Audio) and voice (speechSynthesis) come from Safari while Spotify plays from its own app. iOS mixing of web audio with other apps depends on `navigator.audioSession.type` (Safari 17+; "ambient" mixes, "transient" mixes and may duck; WebKit reports are mixed, and these modes are silenced by Silent mode). The page tests Standard / Mix / Mix + dip × beeps / voice / both and records what the music did. Run it on the friend's iPad and the phone with Spotify playing on the speaker before building the timer; the result decides how cues are played.

## How to work on it
- Mock up UI changes on the canvas first, get approval, then build.
- After each change: test in a browser (Playwright), commit with a plain-English message, push to `main`. GitHub Pages republishes automatically.
- No zip files.
