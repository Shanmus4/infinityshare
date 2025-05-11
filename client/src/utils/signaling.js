// Use environment variable for Signaling Server URL, fallback for local dev
// Example .env file: REACT_APP_SIGNALING_SERVER_URL=wss://your-signaling-server.com
export const SIGNALING_SERVER_URL =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_SIGNALING_SERVER_URL // This will be set in Netlify/Vercel
    : "ws://localhost:3000";
// Base URL for the signaling server's API (where /api/ice-servers is hosted)
// This needs to be the HTTP/HTTPS URL, not the WebSocket URL.
// Assuming your signaling server (now with Express) runs on the same host/port as the WebSocket,
// but uses http/https protocol.

let apiBaseUrl = SIGNALING_SERVER_URL.replace(/^ws/, 'http'); 
// If SIGNALING_SERVER_URL is like 'wss://your-domain.com', apiBaseUrl becomes 'https://your-domain.com'
// If SIGNALING_SERVER_URL is like 'ws://localhost:3000', apiBaseUrl becomes 'http://localhost:3000'

// Fallback public STUN servers if fetching from backend fails
const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];

let iceServerConfigPromise = null;

export async function fetchIceServers() {
  if (!apiBaseUrl) {
    console.error("Cannot determine API base URL for fetching ICE servers from SIGNALING_SERVER_URL:", SIGNALING_SERVER_URL);
    return FALLBACK_ICE_SERVERS;
  }
  
  // Ensure SIGNALING_SERVER_URL is defined, otherwise default to localhost for API calls too
  // This is important if REACT_APP_SIGNALING_SERVER_URL is not set in production for the client
  if (process.env.NODE_ENV === 'production' && !process.env.REACT_APP_SIGNALING_SERVER_URL) {
    console.warn("REACT_APP_SIGNALING_SERVER_URL is not set in production. Defaulting API for ICE servers to current origin if possible, or expecting relative path.");
    // Attempt to use relative path if on same domain, or adjust as needed for your deployment
    apiBaseUrl = ''; // This will make it a relative path e.g. /api/ice-servers
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
    iceServerConfigPromise = fetchIceServers();
  }
  return iceServerConfigPromise;
}

// For places that might still expect a static array (though they should be updated)
// This will be initially empty and then populated.
// However, it's better to call getIceServers() and await its result.
export let ICE_SERVERS = []; // Deprecated, use getIceServers()
getIceServers().then(servers => {
  ICE_SERVERS = servers; // Populate for any old code, but new code should await
  console.log("ICE Servers (potentially with TURN) have been fetched and set:", ICE_SERVERS);
});
