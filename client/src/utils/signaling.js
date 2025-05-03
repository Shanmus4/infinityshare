export const SIGNALING_SERVER_URL = 'wss://f558-49-207-206-28.ngrok-free.app';
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]; 