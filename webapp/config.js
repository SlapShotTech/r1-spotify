// Configuration file for Spotify Web Player
// IMPORTANT: Replace 'YOUR_SPOTIFY_CLIENT_ID_HERE' with your actual Spotify Client ID

// Get these from your Spotify Developer Dashboard: https://developer.spotify.com/dashboard
const CONFIG = {
  // Your Spotify App Client ID - REPLACE THIS!
  CLIENT_ID: 'PLACEHOLDER_CLIENT_ID',
  
  // Optional: Custom redirect URI (defaults to current origin)
  REDIRECT_URI: (window.location.origin + (window.location.pathname.endsWith('/') ? 'index.html' : window.location.pathname)),  
  // Optional: Custom scopes (defaults to standard player scopes)
  SCOPES: [
    "streaming",
    "user-read-email", 
    "user-read-private",
    "user-library-read",
    "user-library-modify",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
    "playlist-read-private",
    "playlist-read-collaborative",
  ]
};

// Check if config is properly set
if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID === 'PLACEHOLDER_CLIENT_ID' || /YOUR_SPOTIFY_CLIENT_ID/i.test(String(CONFIG.CLIENT_ID))) {
  console.error('❌ Spotify Client ID not configured!');
  console.error('📝 Please edit config.js and replace placeholder with your actual Client ID');
  console.error('🔗 Get your Client ID from: https://developer.spotify.com/dashboard');
}

// Instructions:
// 1. Go to https://developer.spotify.com/dashboard
// 2. Create a new app or select an existing one
// 3. Copy your Client ID from the app settings
// 4. Add your redirect URI (usually your domain + /index.html)
// 5. Replace 'YOUR_SPOTIFY_CLIENT_ID_HERE' with your actual Client ID
// 6. Save this file as config.js
