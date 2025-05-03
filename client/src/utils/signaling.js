export const SIGNALING_SERVER_URL = "wss://b9c2-49-207-206-28.ngrok-free.app"; // Ensure this ngrok URL is still active!
export const ICE_SERVERS = [
  // Google STUN servers (hostname and IP) - Port 19302 is standard STUN
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:74.125.140.127:19302" }, // Example Google STUN IP
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:74.125.196.127:19302" }, // Example Google STUN IP
  { urls: "stun:stun2.l.google.com:19302" },
  // Twilio STUN server
  { urls: "stun:global.stun.twilio.com:3478" },
  // Twilio TURN servers (using Account SID as username, Auth Token as credential)
  {
    urls: "turn:global.turn.twilio.com:3478?transport=udp",
    username: "AC8eeb1010efa9c35eab93f2ea2875c1bb", // Your Account SID
    credential: "7tKAjv7hMU2LIm0SvJphlRyAV6GHUFxB", // Your Auth Token
  },
  {
    urls: "turn:global.turn.twilio.com:3478?transport=tcp",
    username: "AC8eeb1010efa9c35eab93f2ea2875c1bb", // Your Account SID
    credential: "7tKAjv7hMU2LIm0SvJphlRyAV6GHUFxB", // Your Auth Token
  },
  {
    // Also try port 443 for TURN over TLS (often better firewall traversal)
    urls: "turn:global.turn.twilio.com:443?transport=tcp",
    username: "AC8eeb1010efa9c35eab93f2ea2875c1bb", // Your Account SID
    credential: "7tKAjv7hMU2LIm0SvJphlRyAV6GHUFxB", // Your Auth Token
  },
  // Removed other STUN and non-functional TURN servers
];
