import React, { useState, useEffect, useRef } from 'react';
import { subscribeToLogs, getLogBuffer, clearLogBuffer, LogCategory } from '../utils/debugLog';

/**
 * Floating collapsible debug panel that shows both local and remote logs.
 * Logs are color-coded by level and clearly segregated by SENDER/RECEIVER source.
 */
function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('ALL'); // ALL, SENDER, RECEIVER, ERROR
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const logEndRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // Initialize with existing buffer
    setLogs(getLogBuffer());

    // Subscribe to new logs
    const unsubscribe = subscribeToLogs((newLogs) => {
      setLogs(newLogs);
      if (!isOpen) {
        setUnreadCount(prev => prev + 1);
      }
    });

    return unsubscribe;
  }, [isOpen]);

  useEffect(() => {
    if (autoScroll && isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) setUnreadCount(0);
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'SENDER' && log.source !== 'SENDER') return false;
    if (filter === 'RECEIVER' && log.source !== 'RECEIVER') return false;
    if (filter === 'ERROR' && log.level !== 'error') return false;
    if (filter === 'REMOTE' && !log._isRemote) return false;
    if (categoryFilter !== 'ALL' && log.category !== categoryFilter) return false;
    return true;
  });

  const getLevelStyle = (level) => {
    switch (level) {
      case 'error': return { color: '#ff6b6b', fontWeight: 'bold' };
      case 'warn': return { color: '#ffd93d' };
      default: return { color: '#e0e0e0' };
    }
  };

  const getSourceBadge = (source) => {
    if (source === 'SENDER') return { background: '#2d6a4f', color: '#b7e4c7' };
    if (source === 'RECEIVER') return { background: '#5a189a', color: '#e0aaff' };
    return { background: '#555', color: '#ccc' };
  };

  const getCategoryBadge = (category) => {
    const colors = {
      [LogCategory.ICE]: '#1d3557',
      [LogCategory.WEBRTC]: '#264653',
      [LogCategory.DATACHANNEL]: '#2a9d8f',
      [LogCategory.TURN_STUN]: '#e76f51',
      [LogCategory.SOCKET]: '#457b9d',
      [LogCategory.TRANSFER]: '#f4a261',
      [LogCategory.CLEANUP]: '#6c757d',
      [LogCategory.NETWORK]: '#0077b6',
      [LogCategory.SERVICE_WORKER]: '#7209b7',
      [LogCategory.SYSTEM]: '#495057',
    };
    return { background: colors[category] || '#555', color: '#fff' };
  };

  const categories = ['ALL', ...Object.values(LogCategory)];

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={handleToggle}
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          zIndex: 10001,
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          border: 'none',
          background: isOpen ? '#dc3545' : '#1a1a2e',
          color: '#fff',
          fontSize: '18px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s ease',
        }}
        title={isOpen ? 'Close Debug Panel' : 'Open Debug Panel'}
      >
        {isOpen ? '✕' : '🐛'}
        {!isOpen && unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            background: '#dc3545',
            color: '#fff',
            borderRadius: '50%',
            width: '20px',
            height: '20px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Debug Panel */}
      {isOpen && (
        <div style={{
          position: 'fixed',
          bottom: '72px',
          right: '16px',
          width: 'min(520px, calc(100vw - 32px))',
          height: 'min(500px, calc(100vh - 100px))',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: '12px',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
          fontSize: '11px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '8px 12px',
            background: '#161b22',
            borderBottom: '1px solid #30363d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '12px' }}>
              🔍 Debug Logs ({filteredLogs.length}/{logs.length})
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <label style={{ color: '#8b949e', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  style={{ width: '12px', height: '12px' }}
                />
                Auto-scroll
              </label>
              <button
                onClick={() => clearLogBuffer()}
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#8b949e',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Filters */}
          <div style={{
            padding: '6px 12px',
            background: '#161b22',
            borderBottom: '1px solid #30363d',
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap',
            flexShrink: 0,
          }}>
            {/* Source filter */}
            {['ALL', 'SENDER', 'RECEIVER', 'ERROR'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#388bfd' : '#21262d',
                  border: '1px solid ' + (filter === f ? '#388bfd' : '#30363d'),
                  color: filter === f ? '#fff' : '#8b949e',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                {f}
              </button>
            ))}
            <span style={{ color: '#30363d', margin: '0 2px' }}>|</span>
            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#8b949e',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Log entries */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 8px',
          }}>
            {filteredLogs.length === 0 && (
              <div style={{ color: '#8b949e', textAlign: 'center', padding: '20px', fontSize: '12px' }}>
                No logs yet. Perform an action to see debug output.
              </div>
            )}
            {filteredLogs.map((log, i) => (
              <div key={i} style={{
                padding: '3px 4px',
                borderBottom: '1px solid #21262d',
                lineHeight: '1.4',
                ...getLevelStyle(log.level),
              }}>
                <span style={{ color: '#484f58', marginRight: '6px' }}>{log.timeStr}</span>
                <span style={{
                  ...getSourceBadge(log.source),
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  marginRight: '4px',
                  display: 'inline-block',
                }}>
                  {log.source}{log._isRemote ? ' 📡' : ''}
                </span>
                <span style={{
                  ...getCategoryBadge(log.category),
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  marginRight: '6px',
                  display: 'inline-block',
                }}>
                  {log.category}
                </span>
                <span>{log.message}</span>
                {log.data && (
                  <div style={{
                    color: '#8b949e',
                    marginLeft: '20px',
                    marginTop: '2px',
                    fontSize: '10px',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 1)}
                  </div>
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* Footer with PC count */}
          <div style={{
            padding: '4px 12px',
            background: '#161b22',
            borderTop: '1px solid #30363d',
            color: '#8b949e',
            fontSize: '10px',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>💡 Filter by source/category to isolate issues</span>
            <span>Online: {navigator.onLine ? '✅' : '❌'}</span>
          </div>
        </div>
      )}
    </>
  );
}

export default DebugPanel;
