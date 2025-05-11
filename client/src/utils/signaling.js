// Use environment variable for Signaling Server URL, fallback for local dev
// Example .env file: REACT_APP_SIGNALING_SERVER_URL=wss://your-signaling-server.com
export const SIGNALING_SERVER_URL =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_SIGNALING_SERVER_URL // This will be set in Netlify/Vercel
    : "ws://localhost:3000";
// ICE servers: Google STUN servers and Twilio STUN
// const finalIceServers = [
//   { urls: "stun:stun.l.google.com:19302" },
//   { urls: "stun:stun1.l.google.com:19302" },
//   { urls: "stun:stun2.l.google.com:19302" },
//   { urls: "stun:global.stun.twilio.com:3478" } // Added Twilio's public STUN
// ];

// --- DIAGNOSTIC CHANGE: Force only host candidates ---
const finalIceServers = []; 
console.warn("DIAGNOSTIC MODE: ICE_SERVERS is empty. Relying on host candidates only.");
// --- END DIAGNOSTIC CHANGE ---

// Twilio TURN server credentials from environment variables - REMOVED
// Example .env file:
// REACT_APP_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// REACT_APP_TWILIO_AUTH_TOKEN=your_auth_token_here

console.log("ICE Servers Configured (Diagnostic):", finalIceServers); // Log the actual config

export const ICE_SERVERS = finalIceServers;

// REMOVED Twilio credential warning
// if ( ... ) { ... }
