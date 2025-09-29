// Example Configuration file for Spotify Web Player
// Copy this file to config.js and update with your Spotify app credentials

// Get these from your Spotify Developer Dashboard: https://developer.spotify.com/dashboard
const CONFIG = {
  // Your Spotify App Client ID - REPLACE THIS with your actual Client ID!
  // Example: CLIENT_ID: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  CLIENT_ID: 'YOUR_SPOTIFY_CLIENT_ID_HERE',
  
  // Optional: Custom redirect URI (defaults to current origin)
  // Example: REDIRECT_URI: 'https://yourdomain.com',
  REDIRECT_URI: window.location.origin,
  
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

// Instructions:
// 1. Go to https://developer.spotify.com/dashboard
// 2. Create a new app or select an existing one
// 3. Copy your Client ID from the app settings
// 4. Add your redirect URI (usually your domain + /index.html)
// 5. Replace 'YOUR_SPOTIFY_CLIENT_ID_HERE' with your actual Client ID
// 6. Save this file as config.js
