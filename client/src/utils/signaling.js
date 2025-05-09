// Use environment variable for Signaling Server URL, fallback for local dev
// Example .env file: REACT_APP_SIGNALING_SERVER_URL=wss://your-signaling-server.com
export const SIGNALING_SERVER_URL =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_SIGNALING_SERVER_URL // This will be set in Netlify/Vercel
    : "ws://localhost:3000";
// Base STUN servers - Google Only
const baseIceServers = [
  // Google STUN servers by IP (use IPs you've verified by pinging stun.l.google.com, stun1.l.google.com etc.)
  // Note: IPs can change, this is for testing DNS resolution hypothesis.
  { urls: "stun:74.125.250.129:19302" }, // IP from your ping
  { urls: "stun:172.217.192.127:19302" }, // Example of another Google STUN IP
  // Fallback to OpenRelay TURN servers
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

console.log("ICE Servers Configured (IP STUNs + Test TURN):", finalIceServers); // Log the actual config

export const ICE_SERVERS = finalIceServers;

// REMOVED Twilio credential warning
// if ( ... ) { ... }
