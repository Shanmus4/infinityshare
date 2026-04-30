/**
 * Debug logging utility for InfinityShare.
 * Logs locally to console AND relays structured logs to the remote peer
 * via the signaling server's 'debug-log' event.
 *
 * Logs are segregated by source (SENDER/RECEIVER) and category for easy filtering.
 */

// Categories for structured logging
export const LogCategory = {
  SOCKET: 'SOCKET',
  ICE: 'ICE',
  WEBRTC: 'WEBRTC',
  DATACHANNEL: 'DATACHANNEL',
  TRANSFER: 'TRANSFER',
  CLEANUP: 'CLEANUP',
  NETWORK: 'NETWORK',
  SERVICE_WORKER: 'SERVICE_WORKER',
  TURN_STUN: 'TURN_STUN',
  SYSTEM: 'SYSTEM',
};

// Max logs to store in memory (for the debug panel)
const MAX_STORED_LOGS = 300;

// In-memory log buffer (both local + remote logs)
let _logBuffer = [];
let _listeners = [];

// Subscribe to log updates (used by DebugPanel component)
export function subscribeToLogs(listener) {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter(l => l !== listener);
  };
}

export function getLogBuffer() {
  return _logBuffer;
}

function _notifyListeners() {
  _listeners.forEach(l => l([..._logBuffer]));
}

function _addToBuffer(entry) {
  _logBuffer.push(entry);
  if (_logBuffer.length > MAX_STORED_LOGS) {
    _logBuffer = _logBuffer.slice(-MAX_STORED_LOGS);
  }
  _notifyListeners();
}

export function injectRemoteLog(entry) {
  _addToBuffer(entry);
}

/**
 * Get a snapshot of the current environment for diagnostic purposes.
 */
export function getEnvironmentInfo() {
  const nav = navigator;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    onLine: nav.onLine,
    serviceWorkerReady: !!nav.serviceWorker?.controller,
    connectionType: conn?.effectiveType || 'unknown',
    connectionDownlink: conn?.downlink || 'unknown',
    connectionRtt: conn?.rtt || 'unknown',
    saveData: conn?.saveData || false,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
  };
}

/**
 * Summarize ICE servers config to understand what's available (STUN vs TURN).
 */
export function summarizeIceServers(iceServers) {
  if (!iceServers || !Array.isArray(iceServers)) {
    return { total: 0, stun: 0, turn: 0, turnTls: 0, servers: [] };
  }
  let stun = 0, turn = 0, turnTls = 0;
  const servers = [];
  iceServers.forEach(s => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    urls.forEach(url => {
      if (typeof url !== 'string') return;
      if (url.startsWith('stun:')) {
        stun++;
        servers.push({ type: 'STUN', url, hasCredentials: !!(s.username && s.credential) });
      } else if (url.startsWith('turn:')) {
        turn++;
        servers.push({ type: 'TURN', url: url.substring(0, 60) + '...', hasCredentials: !!(s.username && s.credential) });
      } else if (url.startsWith('turns:')) {
        turnTls++;
        servers.push({ type: 'TURNS', url: url.substring(0, 60) + '...', hasCredentials: !!(s.username && s.credential) });
      }
    });
  });
  return { total: iceServers.length, stun, turn, turnTls, servers };
}

/**
 * Summarize PC state for logging.
 */
export function getPcState(pc) {
  if (!pc) return { state: 'null' };
  return {
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    iceGatheringState: pc.iceGatheringState,
    signalingState: pc.signalingState,
    localCandidateCount: pc.localDescription ? 'set' : 'unset',
    remoteCandidateCount: pc.remoteDescription ? 'set' : 'unset',
  };
}

/**
 * Count active peer connections and data channels.
 */
export function countPeerConnections(peerConns, dataChannels) {
  const pcKeys = Object.keys(peerConns?.current || {});
  const dcKeys = Object.keys(dataChannels?.current || {});
  const pcStates = {};
  pcKeys.forEach(id => {
    const pc = peerConns.current[id];
    if (pc) {
      const state = pc.connectionState || 'unknown';
      pcStates[state] = (pcStates[state] || 0) + 1;
    }
  });
  return {
    totalPCs: pcKeys.length,
    totalDCs: dcKeys.length,
    pcStates,
    pcIds: pcKeys.slice(0, 10), // Only show first 10 to avoid noise
  };
}

/**
 * Main debug log function.
 *
 * @param {object} params
 * @param {import('socket.io-client').Socket} params.socket - Socket.IO instance
 * @param {string} params.driveCode - Current drive room code
 * @param {string} params.source - 'SENDER' or 'RECEIVER'
 * @param {string} params.category - One of LogCategory values
 * @param {string} params.level - 'info', 'warn', 'error'
 * @param {string} params.message - Human-readable log message
 * @param {object} [params.data] - Optional structured data payload
 * @param {boolean} [params.relay=true] - Whether to relay to remote peer
 */
export function debugLog({ socket, driveCode, source, category, level, message, data, relay = true }) {
  const timestamp = Date.now();
  const timeStr = new Date(timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Build structured entry
  const entry = {
    timestamp,
    timeStr,
    source,       // SENDER or RECEIVER
    category,     // SOCKET, ICE, WEBRTC, etc.
    level,        // info, warn, error
    message,
    data: data || null,
  };

  // Local console log with clear prefix
  const prefix = `[${source}] [${category}]`;
  const consoleData = data ? [prefix, message, data] : [prefix, message];
  if (level === 'error') console.error(...consoleData);
  else if (level === 'warn') console.warn(...consoleData);
  else console.log(...consoleData);

  // Add to in-memory buffer
  _addToBuffer(entry);

  // Relay to remote peer via signaling server
  if (relay && socket && driveCode) {
    try {
      socket.emit('debug-log', {
        room: driveCode,
        timestamp,
        source,
        category,
        level,
        message,
        // Truncate data to avoid huge payloads
        data: data ? JSON.stringify(data).substring(0, 1000) : undefined,
      });
    } catch (e) {
      // Don't let debug logging errors break the app
      console.warn('[DebugLog] Failed to emit debug-log:', e.message);
    }
  }
}

/**
 * Clear the log buffer.
 */
export function clearLogBuffer() {
  _logBuffer = [];
  _notifyListeners();
}
