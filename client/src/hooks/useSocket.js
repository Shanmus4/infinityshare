import { io } from 'socket.io-client';
import { SIGNALING_SERVER_URL } from '../utils/signaling';

const socket = io(SIGNALING_SERVER_URL, { transports: ['websocket'] });

export function useSocket() {
  return socket;
} 