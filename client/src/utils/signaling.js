export const SIGNALING_SERVER_URL = "wss://b9c2-49-207-206-28.ngrok-free.app"; // Ensure this ngrok URL is still active!
// Base STUN servers
const baseIceServers = [
  // Google STUN servers (hostname and IP) - Port 19302 is standard STUN
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:74.125.140.127:19302" }, // Example Google STUN IP
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:74.125.196.127:19302" }, // Example Google STUN IP
  { urls: "stun:stun2.l.google.com:19302" },
  // Twilio STUN server
  { urls: "stun:global.stun.twilio.com:3478" },
];

// Twilio TURN server credentials from environment variables
// Example .env file:
// REACT_APP_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
// REACT_APP_TWILIO_AUTH_TOKEN=your_auth_token_here
const twilioAccountSid = process.env.REACT_APP_TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.REACT_APP_TWILIO_AUTH_TOKEN;

let finalIceServers = [...baseIceServers];

// Conditionally add TURN servers if credentials are provided
if (twilioAccountSid && twilioAuthToken) {
  console.log("Twilio TURN credentials found, adding TURN servers.");
  const twilioTurnServers = [
    {
      urls: "turn:global.turn.twilio.com:3478?transport=udp",
      username: twilioAccountSid,
      credential: twilioAuthToken,
    },
    {
      urls: "turn:global.turn.twilio.com:3478?transport=tcp",
      username: twilioAccountSid,
      credential: twilioAuthToken,
    },
    {
      // Also try port 443 for TURN over TLS (often better firewall traversal)
      urls: "turn:global.turn.twilio.com:443?transport=tcp",
      username: twilioAccountSid,
      credential: twilioAuthToken,
    },
  ];
  finalIceServers = finalIceServers.concat(twilioTurnServers);
} else {
  console.log("Twilio TURN credentials not found in environment variables. Using STUN servers only.");
}

export const ICE_SERVERS = finalIceServers;

// Basic check to warn if credentials are missing during development
if (process.env.NODE_ENV === 'development' && (!process.env.REACT_APP_TWILIO_ACCOUNT_SID || !process.env.REACT_APP_TWILIO_AUTH_TOKEN)) {
  console.warn(
    'Twilio TURN credentials (REACT_APP_TWILIO_ACCOUNT_SID, REACT_APP_TWILIO_AUTH_TOKEN) are not set in the environment. ' +
    'File transfer may fail over networks requiring TURN servers. Create a .env file in the client directory.'
  );
}
