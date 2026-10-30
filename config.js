// Public settings for the web app. Nothing here is secret.
// The Spotify Client ID is meant to be public: sign-in uses Authorization Code + PKCE, with no client secret.
window.GIT_CONFIG = {
  spotifyClientId: 'f6c1ed0776a7401b9945a1cfcc5ea890',
  // Must match a Redirect URI in the Spotify app's settings exactly.
  spotifyRedirect: 'https://stephenrcrandall-personal.github.io/gym-interval-timer/'
};
