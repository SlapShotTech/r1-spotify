// Spotify Web Player - Vanilla JavaScript Implementation
// Configuration (loaded from config.js)
const CLIENT_ID = CONFIG?.CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
const REDIRECT_URI = CONFIG?.REDIRECT_URI || (window.location.origin + (window.location.pathname.endsWith('/') ? 'index.html' : window.location.pathname));
const SCOPES = CONFIG?.SCOPES?.join(" ") || [
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
].join(" ");

// Validate configuration on load
if (typeof CONFIG === 'undefined') {
  console.error('❌ CONFIG object not found! Make sure config.js is loaded before app.js');
} else if (!CLIENT_ID || /YOUR_SPOTIFY_CLIENT_ID/i.test(String(CLIENT_ID)) || CLIENT_ID === 'PLACEHOLDER_CLIENT_ID' || CLIENT_ID === 'undefined') {
  console.error('❌ Spotify Client ID not properly configured!');
  console.error('📝 Current CLIENT_ID:', CLIENT_ID);
  console.error('🔧 Please check your config.js file or GitHub secrets');
}

const STORAGE_KEY = "sp_token_bundle_v1";
const LOGIN_COOKIE_KEY = "spotify_login_cookie";

// Global variables
let tokenBundle = null;
let deviceId = null;
let ready = false;
let error = null;
let needsAudioUnlock = false;
let audioUnlocked = false;
let utilityOpen = false;
let volume = 0.7;
let playerState = {
  paused: true,
  position: 0,
  duration: 0,
  trackName: null,
  artists: null,
  albumArt: null
};

let player = null;
let volumeRef = 0.7;
let playbackPausedRef = true;
let readyRef = false;
let pttClickCountRef = 0;
let pttTimerRef = null;

// Utility functions
function isIOS() { 
  return /iP(hone|ad|od)/i.test(navigator.userAgent); 
}

function isMobile() { 
  return /Android|iP(hone|ad|od)/i.test(navigator.userAgent); 
}

function persistSpotifyLoginCookie() {
  try {
    const cookieString = document.cookie || "";
    const relevant = cookieString
      .split(/;\s*/)
      .filter(Boolean)
      .filter((fragment) => /sp(_|otify)/i.test(fragment));
    const payload = {
      updatedAt: Date.now(),
      cookies: relevant.length ? relevant : cookieString ? [cookieString] : [],
    };
    localStorage.setItem(LOGIN_COOKIE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist Spotify login cookie", error);
  }
}

function saveBundle(bundle) { 
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle)); 
  persistSpotifyLoginCookie(); 
}

function loadBundle() { 
  try { 
    const raw = localStorage.getItem(STORAGE_KEY); 
    return raw ? JSON.parse(raw) : null; 
  } catch { 
    return null; 
  } 
}

function isExpired(bundle, skewSec = 60) { 
  const expiry = bundle.obtained_at + (bundle.expires_in - skewSec) * 1000; 
  return Date.now() >= expiry; 
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = ""; 
  const arr = crypto.getRandomValues(new Uint8Array(len));
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

async function beginPkceAuth() {
  if (!CLIENT_ID || CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID' || CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID_HERE') {
    showError("Please configure your Spotify Client ID. See console for details.");
    console.error('❌ Spotify Client ID not configured!');
    console.error('📝 Current CLIENT_ID:', CLIENT_ID);
    console.error('🔧 Configuration methods:');
    console.error('   📁 Local development: Edit config.js and replace YOUR_SPOTIFY_CLIENT_ID_HERE');
    console.error('   🚀 GitHub Actions: Set SPOTIFY_CLIENT_ID secret in repository settings');
    console.error('🔗 Get your Client ID from: https://developer.spotify.com/dashboard');
    console.error('📋 Steps:');
    console.error('   1. Go to https://developer.spotify.com/dashboard');
    console.error('   2. Create a new app or select an existing one');
    console.error('   3. Copy your Client ID from the app settings');
    console.error('   4. Add your redirect URI (usually your domain + /index.html)');
    console.error('   5. Configure using one of the methods above');
    return;
  }
  
  const verifier = randString(64);
  const challenge = base64url(await sha256(verifier));
  sessionStorage.setItem("sp_pkce_verifier", verifier);

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("show_dialog", "true");
  window.location.href = url.toString();
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem("sp_pkce_verifier") || "";
  const body = new URLSearchParams({
    client_id: CLIENT_ID, 
    grant_type: "authorization_code", 
    code,
    redirect_uri: REDIRECT_URI, 
    code_verifier: verifier,
  });
  
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", 
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, 
    body,
  });
  
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const json = await res.json();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in,
    obtained_at: Date.now(),
  };
}

async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, 
    grant_type: "refresh_token", 
    refresh_token,
  });
  
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", 
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, 
    body,
  });
  
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  const json = await res.json();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || refresh_token,
    expires_in: json.expires_in,
    obtained_at: Date.now(),
  };
}

function scheduleAutoRefresh(bundle, onNew) {
  const ms = Math.max(5_000, bundle.obtained_at + (bundle.expires_in - 60) * 1000 - Date.now());
  window.setTimeout(async () => {
    if (!bundle.refresh_token) return;
    try {
      const nb = await refreshToken(bundle.refresh_token);
      onNew(nb); 
      saveBundle(nb); 
      scheduleAutoRefresh(nb, onNew);
    } catch (e) { 
      console.error(e); 
    }
  }, ms);
}

// UI functions
function showError(message) {
  error = message;
  const errorEl = document.getElementById('error-message');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function hideError() {
  error = null;
  const errorEl = document.getElementById('error-message');
  errorEl.style.display = 'none';
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('player-screen').style.display = 'none';
  document.body.classList.remove('player-bg');
}

function showPlayerScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('player-screen').style.display = 'block';
  document.body.classList.add('player-bg');
}

function updatePlayerState(newState) {
  playerState = { ...playerState, ...newState };
  
  document.getElementById('track-name').textContent = playerState.trackName || '—';
  document.getElementById('track-artist').textContent = playerState.artists || 'Not playing';
  
  const albumBg = document.getElementById('album-bg');
  const controlsBg = document.getElementById('controls-bg');
  const defaultBg = 'https://images.pexels.com/photos/801863/pexels-photo-801863.jpeg';
  const bgUrl = playerState.albumArt || defaultBg;
  
  albumBg.style.backgroundImage = `url(${bgUrl})`;
  controlsBg.style.backgroundImage = `url(${bgUrl})`;
  
  // Update play/pause button
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  if (playerState.paused) {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  } else {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  }
  
  playbackPausedRef = playerState.paused;
}

function updateVolume(vol) {
  volume = Math.min(1, Math.max(0, vol));
  volumeRef = volume;
  document.getElementById('volume-meter').textContent = Math.round(volume * 100) + '%';
  
  if (player && typeof player.setVolume === "function") {
    player.setVolume(volume).catch(() => {});
  }
}

function adjustVolume(delta) {
  updateVolume(volumeRef + delta);
}

function updateAudioUnlockState(needsUnlock, unlocked, message) {
  needsAudioUnlock = needsUnlock;
  audioUnlocked = unlocked;
  
  const volumeBtn = document.getElementById('volume-btn');
  const volumeStatus = document.getElementById('volume-status');
  
  if (needsUnlock) {
    volumeBtn.classList.add('player__volume--alert');
  } else {
    volumeBtn.classList.remove('player__volume--alert');
  }
  
  if (!unlocked) {
    volumeBtn.classList.add('player__volume--locked');
  } else {
    volumeBtn.classList.remove('player__volume--locked');
  }
  
  if (message) {
    volumeStatus.textContent = message;
    volumeStatus.style.display = 'block';
  } else {
    volumeStatus.style.display = 'none';
  }
}

function updateReadyState(isReady) {
  ready = isReady;
  readyRef = isReady;
  
  const buttons = ['prev-btn', 'play-btn', 'next-btn', 'transfer-btn'];
  buttons.forEach(id => {
    document.getElementById(id).disabled = !isReady;
  });
}

async function ensureAudioUnlockedFromGesture() {
  if (!player) return false;
  if (audioUnlocked) return true;

  const activator = player.activateElement;
  if (typeof activator !== "function") {
    updateAudioUnlockState(false, true, null);
    return true;
  }

  try {
    await activator.call(player);
    updateAudioUnlockState(false, true, null);
    return true;
  } catch {
    updateAudioUnlockState(true, false, isIOS()
      ? "Unable to enable audio. Please tap the volume icon again."
      : "Audio is still blocked. Tap the volume icon again.");
    return false;
  }
}

// Player actions
async function play() {
  if (!tokenBundle?.access_token) return;
  try {
    const unlocked = await ensureAudioUnlockedFromGesture();
    if (!unlocked) return;
    
    const url = deviceId
      ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
      : "https://api.spotify.com/v1/me/player/play";
    
    await fetch(url, { 
      method: "PUT", 
      headers: { 
        Authorization: `Bearer ${tokenBundle.access_token}`, 
        "Content-Type": "application/json" 
      } 
    });
    await player?.resume?.();
  } catch (e) { 
    showError(e.message ?? String(e)); 
  }
}

async function pause() {
  if (!tokenBundle?.access_token) return;
  try {
    await fetch("https://api.spotify.com/v1/me/player/pause", { 
      method: "PUT", 
      headers: { Authorization: `Bearer ${tokenBundle.access_token}` } 
    });
  } catch (e) { 
    showError(e.message ?? String(e)); 
  }
}

async function nextTrack() {
  if (!tokenBundle?.access_token) return;
  try {
    const unlocked = await ensureAudioUnlockedFromGesture();
    if (!unlocked) return;
    
    await fetch("https://api.spotify.com/v1/me/player/next", { 
      method: "POST", 
      headers: { Authorization: `Bearer ${tokenBundle.access_token}` } 
    });
    await player?.resume?.();
  } catch (e) { 
    showError(e.message ?? String(e)); 
  }
}

async function prevTrack() {
  if (!tokenBundle?.access_token) return;
  try {
    const unlocked = await ensureAudioUnlockedFromGesture();
    if (!unlocked) return;
    
    await fetch("https://api.spotify.com/v1/me/player/previous", { 
      method: "POST", 
      headers: { Authorization: `Bearer ${tokenBundle.access_token}` } 
    });
    await player?.resume?.();
  } catch (e) { 
    showError(e.message ?? String(e)); 
  }
}

async function transferToWebPlayer() {
  if (!tokenBundle?.access_token || !deviceId) return;
  try {
    const unlocked = await ensureAudioUnlockedFromGesture();
    if (!unlocked) return;
    
    await fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers: { 
        Authorization: `Bearer ${tokenBundle.access_token}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({ device_ids: [deviceId], play: true }),
    });
    window.setTimeout(() => player?.resume?.(), 400);
  } catch (e) { 
    showError(e.message ?? String(e)); 
  }
}

function logout() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LOGIN_COOKIE_KEY);
  player?.disconnect?.();
  player = null;
  tokenBundle = null;
  deviceId = null;
  ready = false;
  readyRef = false;
  playerState = { paused: true, position: 0, duration: 0 };
  utilityOpen = false;
  updateAudioUnlockState(isMobile(), !isMobile(), 
    isMobile() ? (isIOS() ? "Tap the volume icon to enable audio on iOS" : "Tap the volume icon to enable audio") : null);
  volumeRef = 0.7; 
  updateVolume(0.7);
  showLoginScreen();
}

// Initialize Spotify SDK
let sdkScriptAppended = false;
let sdkInitialized = false;

function initializeSpotifyPlayer() {
  if (!tokenBundle?.access_token) return;

  const attachListeners = () => {
    if (sdkInitialized || !window.Spotify || !window.Spotify.Player) return;

    const spotifyPlayer = new window.Spotify.Player({
      name: "R1 Web Player",
      getOAuthToken: (cb) => cb(tokenBundle.access_token),
      volume: 0.7,
    });

    player = spotifyPlayer;
    sdkInitialized = true;

    spotifyPlayer.addListener("ready", ({ device_id }) => {
      deviceId = device_id;
      updateReadyState(true);
      showPlayerScreen();

      const getVolumeFn = spotifyPlayer.getVolume;
      if (typeof getVolumeFn === "function") {
        getVolumeFn.call(spotifyPlayer)
          .then((value) => {
            if (typeof value === "number" && !Number.isNaN(value)) {
              volumeRef = value;
              updateVolume(value);
            } else {
              updateVolume(volumeRef);
            }
          })
          .catch(() => { updateVolume(volumeRef); });
      } else {
        updateVolume(volumeRef);
      }
    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
      console.warn("Device offline", device_id);
      updateReadyState(false);
    });

    spotifyPlayer.addListener("initialization_error", ({ message }) => showError(message));
    spotifyPlayer.addListener("authentication_error", ({ message }) => showError(message));
    spotifyPlayer.addListener("account_error", ({ message }) => showError(message));

    spotifyPlayer.addListener("autoplay_failed", async () => {
      updateAudioUnlockState(true, false, isIOS()
        ? "Playback is blocked until you enable audio. Tap the volume icon."
        : "Playback is blocked until audio is enabled. Tap the volume icon.");

      const tryResume = async () => {
        const ok = await ensureAudioUnlockedFromGesture();
        if (ok) {
          await player?.resume?.().catch(() => {});
          document.removeEventListener("touchend", tryResume);
          document.removeEventListener("mouseup", tryResume);
        }
      };
      document.addEventListener("touchend", tryResume, { once: true });
      document.addEventListener("mouseup", tryResume, { once: true });
    });

    spotifyPlayer.addListener("player_state_changed", (state) => {
      if (!state) return;

      const current = state.track_window?.current_track;
      updatePlayerState({
        paused: state.paused,
        position: state.position,
        duration: state.duration,
        trackName: current?.name,
        artists: current?.artists?.map((a) => a.name).join(", "),
        albumArt: current?.album?.images?.[0]?.url,
      });

      const userPaused = state?.paused && state?.context?.metadata?.is_paused_by_user;
      const disallow = state?.restrictions?.disallow_resuming_reasons ?? [];
      const canResume = !userPaused && !disallow.length;

      if (state.paused && canResume && state.position < 15000 && state.position > 0) {
        setTimeout(() => { player?.resume?.().catch(() => {}); }, 100);
      }
    });

    spotifyPlayer.connect();
  };

  if (window.Spotify && window.Spotify.Player) {
    attachListeners();
  } else {
    if (!sdkScriptAppended) {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
      sdkScriptAppended = true;
    }
    const prevReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof prevReady === "function") prevReady();
      attachListeners();
    };
  }
}

// Event listeners
function setupEventListeners() {
  // Login button
  document.getElementById('login-btn').addEventListener('click', () => {
    beginPkceAuth().catch((e) => showError(e.message));
  });

  // Play/Pause button
  document.getElementById('play-btn').addEventListener('click', () => {
    if (playerState.paused) {
      play();
    } else {
      pause();
    }
  });

  // Previous/Next buttons
  document.getElementById('prev-btn').addEventListener('click', prevTrack);
  document.getElementById('next-btn').addEventListener('click', nextTrack);

  // Volume button
  document.getElementById('volume-btn').addEventListener('click', () => {
    if (!audioUnlocked) {
      ensureAudioUnlockedFromGesture();
    } else {
      adjustVolume(0.05);
    }
  });

  document.getElementById('volume-btn').addEventListener('contextmenu', (event) => {
    event.preventDefault();
    adjustVolume(-0.05);
  });

  // Menu button
  document.getElementById('menu-btn').addEventListener('click', () => {
    utilityOpen = !utilityOpen;
    document.getElementById('utility-drawer').style.display = utilityOpen ? 'flex' : 'none';
  });

  // Utility drawer
  document.getElementById('utility-scrim').addEventListener('click', () => {
    utilityOpen = false;
    document.getElementById('utility-drawer').style.display = 'none';
  });

  document.getElementById('close-menu-btn').addEventListener('click', () => {
    utilityOpen = false;
    document.getElementById('utility-drawer').style.display = 'none';
  });

  document.getElementById('transfer-btn').addEventListener('click', () => {
    transferToWebPlayer();
    utilityOpen = false;
    document.getElementById('utility-drawer').style.display = 'none';
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    utilityOpen = false;
    document.getElementById('utility-drawer').style.display = 'none';
  });

  // ESC key to close utility
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && utilityOpen) {
      utilityOpen = false;
      document.getElementById('utility-drawer').style.display = 'none';
    }
  });

  // R1 sideClick: single=play/pause, double=next
  window.addEventListener("sideClick", () => {
    if (!readyRef) return;
    pttClickCountRef += 1;
    if (pttTimerRef) window.clearTimeout(pttTimerRef);
    pttTimerRef = window.setTimeout(() => {
      if (pttClickCountRef >= 2) nextTrack();
      else if (playbackPausedRef) play();
      else pause();
      pttClickCountRef = 0;
      pttTimerRef = null;
    }, 250);
  });

  // Scroll/knob volume
  window.addEventListener("scrollUp", () => adjustVolume(0.05));
  window.addEventListener("scrollDown", () => adjustVolume(-0.05));
  window.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) adjustVolume(0.05);
    else if (event.deltaY > 0) adjustVolume(-0.05);
  }, { passive: true });

  // Swipe up gesture for next track
  if (isMobile()) {
    let startY = 0;
    let startTime = 0;
    const minSwipeDistance = 50;
    const maxSwipeTime = 500;

    const playerElement = document.querySelector('.player');
    if (playerElement) {
      playerElement.addEventListener('touchstart', (event) => {
        startY = event.touches[0].clientY;
        startTime = Date.now();
      }, { passive: true });

      playerElement.addEventListener('touchend', (event) => {
        if (!event.changedTouches.length) return;
        
        const endY = event.changedTouches[0].clientY;
        const endTime = Date.now();
        const swipeDistance = startY - endY; // Positive means swipe up
        const swipeTime = endTime - startTime;

        // Check if it's a valid swipe up gesture
        if (swipeDistance > minSwipeDistance && swipeTime < maxSwipeTime) {
          nextTrack();
        }
      }, { passive: true });
    }
  }

  // Pre-unlock on first gesture (mobile)
  if (isMobile()) {
    const unlockOnFirstGesture = () => {
      ensureAudioUnlockedFromGesture().then((unlocked) => {
        if (unlocked) {
          document.removeEventListener("touchstart", unlockOnFirstGesture);
          document.removeEventListener("mousedown", unlockOnFirstGesture);
          document.removeEventListener("keydown", unlockOnFirstGesture);
        }
      });
    };
    
    document.addEventListener("touchstart", unlockOnFirstGesture, { once: true });
    document.addEventListener("mousedown", unlockOnFirstGesture, { once: true });
    document.addEventListener("keydown", unlockOnFirstGesture, { once: true });
  }
}

// Initialize app
function initializeApp() {
  // Show swipe hint on mobile
  if (isMobile()) {
    document.getElementById('swipe-hint').style.display = 'block';
  }

  // Initialize audio unlock state
  updateAudioUnlockState(isMobile(), !isMobile(), 
    isMobile() ? (isIOS() ? "Tap the volume icon to enable audio on iOS" : "Tap the volume icon to enable audio") : null);

  // Restore saved session
  const saved = loadBundle();
  if (saved) {
    if (!isExpired(saved)) {
      tokenBundle = saved;
      persistSpotifyLoginCookie();
      scheduleAutoRefresh(saved, (newBundle) => {
        tokenBundle = newBundle;
      });
      showPlayerScreen();
      initializeSpotifyPlayer();
    } else if (saved.refresh_token) {
      refreshToken(saved.refresh_token)
        .then((nb) => { 
          tokenBundle = nb; 
          saveBundle(nb); 
          scheduleAutoRefresh(nb, (newBundle) => {
            tokenBundle = newBundle;
          });
          showPlayerScreen();
          initializeSpotifyPlayer();
        })
        .catch(() => localStorage.removeItem(STORAGE_KEY));
    }
  }

  // Handle OAuth redirect
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    exchangeCodeForToken(code)
      .then((b) => {
        tokenBundle = b; 
        saveBundle(b);
        scheduleAutoRefresh(b, (newBundle) => {
          tokenBundle = newBundle;
        });
        history.replaceState(null, "", window.location.pathname);
        showPlayerScreen();
        initializeSpotifyPlayer();
      })
      .catch((e) => showError(e.message));
  }

  // Transfer as soon as the SDK says it's ready
  const checkReady = () => {
    if (ready && tokenBundle?.access_token && deviceId) {
      transferToWebPlayer();
    }
  };

  // Re-transfer when tab becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ready && tokenBundle?.access_token && deviceId) {
      transferToWebPlayer();
    }
  });

  setupEventListeners();
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
