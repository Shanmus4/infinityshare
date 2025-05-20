// Use environment variable for Signaling Server URL, fallback for local dev
// Example .env file: REACT_APP_SIGNALING_SERVER_URL=wss://your-signaling-server.com
export const SIGNALING_SERVER_URL =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_SIGNALING_SERVER_URL // This will be set in Netlify/Vercel
    : "ws://localhost:3000";

// Base URL for the signaling server's API (where /api/ice-servers is hosted)
// This needs to be the HTTP/HTTPS URL, not the WebSocket URL.
let apiBaseUrl = SIGNALING_SERVER_URL.replace(/^ws/, 'http'); 
// If SIGNALING_SERVER_URL is like 'wss://your-domain.com', apiBaseUrl becomes 'https://your-domain.com'
// If SIGNALING_SERVER_URL is like 'ws://localhost:3000', apiBaseUrl becomes 'http://localhost:3000'

// Single, correct declaration of FALLBACK_ICE_SERVERS
const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  { urls: "stun:stun.nextcloud.com:3478" },
  { urls: "stun:stun.voipbuster.com:3478" },
  { urls: "stun:stun.vline.com:3478" },
  { urls: "stun:stun.sipnet.ru:3478" }
];

let iceServerConfigPromise = null;

// This is the diagnostic version that ONLY returns public STUN servers
export async function fetchIceServers_TURN_DISABLED_FOR_TEST() {
  console.warn("[ICE Fetch DIAGNOSTIC] TURN fetching is disabled. Using public STUN servers only.");
  return Promise.resolve(FALLBACK_ICE_SERVERS);
}

// This is the original function that fetches from the backend (includes TURN)
export async function fetchIceServers_ORIGINAL() {
  if (!apiBaseUrl) {
    console.error("Cannot determine API base URL for fetching ICE servers from SIGNALING_SERVER_URL:", SIGNALING_SERVER_URL);
    return FALLBACK_ICE_SERVERS;
  }
  
  if (process.env.NODE_ENV === 'production' && !process.env.REACT_APP_SIGNALING_SERVER_URL) {
    console.warn("REACT_APP_SIGNALING_SERVER_URL is not set in production. Defaulting API for ICE servers to current origin if possible, or expecting relative path.");
    apiBaseUrl = ''; 
  }

  console.log(`[ICE Fetch] Attempting to fetch ICE servers from: ${apiBaseUrl}/api/ice-servers`);
  try {
    const response = await fetch(`${apiBaseUrl}/api/ice-servers`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ICE servers, status: ${response.status}`);
    }
    const data = await response.json();
    if (data && data.iceServers && data.iceServers.length > 0) {
      console.log("[ICE Fetch] Successfully fetched ICE servers (includes TURN):", data.iceServers);
      return data.iceServers;
    } else {
      console.warn("[ICE Fetch] Fetched data.iceServers is empty or invalid, using fallback STUN.");
      return FALLBACK_ICE_SERVERS;
    }
  } catch (error) {
    console.error("[ICE Fetch] Error fetching ICE servers:", error.message, "Using fallback STUN servers.");
    return FALLBACK_ICE_SERVERS;
  }
}

// To avoid fetching multiple times, we can cache the promise
export function getIceServers() {
  if (!iceServerConfigPromise) {
    // RE-ENABLE TURN by calling the original function that fetches from backend
    iceServerConfigPromise = fetchIceServers_ORIGINAL();
    // FOR DIAGNOSTIC TEST (STUN ONLY) - Comment out the line above and uncomment below:
    // iceServerConfigPromise = fetchIceServers_TURN_DISABLED_FOR_TEST();
  }
  return iceServerConfigPromise;
}

// For places that might still expect a static array (though they should be updated)
export let ICE_SERVERS = []; // Deprecated, use getIceServers()
getIceServers().then(servers => {
  ICE_SERVERS = servers; 
  // Log will indicate if it's STUN_ONLY or includes TURN based on which fetch function is active in getIceServers()
  console.log("ICE Servers (should now include TURN if backend is working) have been asynchronously set:", ICE_SERVERS);
});
