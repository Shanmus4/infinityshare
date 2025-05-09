// Use environment variable for Signaling Server URL, fallback for local dev
// Example .env file: REACT_APP_SIGNALING_SERVER_URL=wss://your-signaling-server.com
export const SIGNALING_SERVER_URL =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_SIGNALING_SERVER_URL // This will be set in Netlify/Vercel
    : "ws://localhost:3000";
// Base STUN servers - Google Only
const baseIceServers = [
  // Google STUN servers (using multiple can sometimes help redundancy)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  // Adding public TURN server for testing NAT traversal
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject"
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject"
  }
];

// Twilio TURN server credentials from environment variables - REMOVED
// Example .env file:
// REACT_APP_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// REACT_APP_TWILIO_AUTH_TOKEN=your_auth_token_here
// const twilioAccountSid = process.env.REACT_APP_TWILIO_ACCOUNT_SID; // REMOVED
// const twilioAuthToken = process.env.REACT_APP_TWILIO_AUTH_TOKEN; // REMOVED

// Use only the base STUN servers now
const finalIceServers = [...baseIceServers];

// REMOVED Conditional TURN logic
// if (twilioAccountSid && twilioAuthToken) { ... }

console.log("ICE Servers Configured (including test TURN):", finalIceServers); // Log the actual config

export const ICE_SERVERS = finalIceServers;

// REMOVED Twilio credential warning
// if ( ... ) { ... }
