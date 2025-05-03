export const SIGNALING_SERVER_URL = "wss://679a-49-207-206-28.ngrok-free.app"; // Ensure this ngrok URL is still active!
export const ICE_SERVERS = [
  // Add more STUN servers for redundancy
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.global.twilio.com:3478" },
  // Add another public TURN server (Note: Public TURN servers can be unreliable)
  // Consider setting up your own Coturn server for better reliability
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443", // Try port 443 as well
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:relay.metered.ca:80", // Another potential server from Metered
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:relay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // Example of adding another public TURN provider (Twilio - requires account usually, but has free tier)
  // { urls: "turn:global.turn.twilio.com:3478?transport=udp", username: "YOUR_TWILIO_ACCOUNT_SID", credential: "YOUR_TWILIO_AUTH_TOKEN" },
  // { urls: "turn:global.turn.twilio.com:3478?transport=tcp", username: "YOUR_TWILIO_ACCOUNT_SID", credential: "YOUR_TWILIO_AUTH_TOKEN" },
];
