# Gym Interval Timer — plan

Where things stand: the timer works with Spotify, with voice cues (Siri Voice 6), and it installs as a Home Screen app. Next is a real session at the gym on the iPad and speaker. The to-dos below come after that.

## To do

### 1. Apple Music
Let either phase (work or rest) use an Apple Music playlist, alongside Spotify.

- [ ] **You:** in the Apple Developer account, create a **Media ID** and a **MusicKit key** (a `.p8` file). Keep the key private; don't send it in chat.
- [ ] **You:** run a small script I'll provide on your Mac to turn the key into a **developer token**. A token lasts up to 6 months, then gets renewed the same way.
- [ ] **Claude:** add Apple's MusicKit for the web. Apple Music plays inside the page itself (not in a separate app), so:
  - switches should be close to instant, with no Spotify-style lag;
  - beeps and voice play through the same page as the music.
- [ ] **Claude:** Apple Music sign-in, then a list of library playlists. Continue, Next track and Shuffle work the same as with Spotify, and each playlist keeps its place.
- [ ] **Claude:** mixing services in one preset (for example, Apple Music for work and Spotify for rest): pause one, play the other.
- [ ] **Together:** a sound check with Apple Music on the iPad and speaker before calling it done.
- Your friend needs an Apple Music subscription on his Apple ID.
- Mockup first: the Edit screen's "Apple Music" option and the sign-in.

### 2. More voice options
- [ ] Try more Mac voices: other Siri voices and the "Premium" and "Enhanced" downloads (System Settings › Accessibility › Spoken Content › Manage Voices).
- [ ] Record your own voice, or your friend's. Any phone voice memo works, and Claude trims and levels it.
- [ ] Decide whether to add more phrases, for example "Go", "Switch", "Ten seconds", "Three, two, one", or a spoken countdown instead of beeps.
- [ ] Let each preset (or the whole app) pick a voice pack in Settings. Packs would live in `voice/<pack-name>/`.
- [ ] Paid AI voice services are possible too. Check their terms for using the audio in an app first.

### 3. Theming (low priority, for fun)
- [ ] Color themes for the work and rest screens. Work and rest must still differ by brightness, word and icon, not just color (red-green colorblind rule).
- [ ] Choice of countdown font and size.
- [ ] The gym's name or logo on the home and timer screens.
- [ ] A light theme for daytime or bright rooms.
- Mockups first on the "Gym Interval Timer" canvas.

## How we work
- Mock up screen changes on the canvas, approve, then build.
- Every change is tested, then pushed to `main`, and the site updates by itself.
- Notes for Claude are in `CLAUDE.md`.
