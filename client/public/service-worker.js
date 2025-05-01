// Service Worker for streaming P2P file download
let streams = {};
let pendingChunks = {};

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Wait for meta before responding
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/sw-download/')) {
    const fileId = url.pathname.split('/').pop();
    event.respondWith(new Promise((resolve) => {
      let controllerRef;
      let meta = null;
      let metaReceived = false;
      let metaPromise = new Promise((metaResolve) => {
        streams[fileId] = {
          controller: null,
          resolve,
          metaResolve,
          meta: null,
          received: 0,
          closed: false
        };
        streams[fileId].metaResolve = (m) => {
          meta = m;
          metaReceived = true;
          metaResolve();
        };
      });
      const stream = new ReadableStream({
        start(controller) {
          controllerRef = controller;
          streams[fileId].controller = controller;
          self.clients.matchAll().then((clients) => {
            clients.forEach(client => {
              client.postMessage({ type: 'sw-ready', fileId });
            });
          });
          // Flush any pending chunks for this fileId
          if (pendingChunks[fileId]) {
            pendingChunks[fileId].forEach(chunk => {
              try {
                controller.enqueue(chunk);
                streams[fileId].received += chunk.byteLength;
              } catch (e) {
                streams[fileId].closed = true;
                delete streams[fileId];
              }
            });
            delete pendingChunks[fileId];
          }
        }
      });
      // Wait for meta before responding
      metaPromise.then(() => {
        const filename = meta && meta.filename ? meta.filename : 'download.bin';
        const mime = meta && meta.mimetype ? meta.mimetype : 'application/octet-stream';
        resolve(new Response(stream, {
          headers: {
            'Content-Type': mime,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          }
        }));
      });
    }));
  }
});

self.addEventListener('message', (event) => {
  const { fileId, chunk, filename, mimetype, done } = event.data;
  if (!streams[fileId]) {
    console.warn('[SW] Message for missing stream', fileId, event.data);
    return;
  }
  if (filename) {
    if (!streams[fileId]) {
      streams[fileId] = { meta: null, metaResolve: null, controller: null, resolve: null, received: 0, closed: false };
    }
    streams[fileId].meta = { filename, mimetype };
    if (streams[fileId].metaResolve) streams[fileId].metaResolve(streams[fileId].meta);
    console.log('[SW] Meta received for', fileId, streams[fileId].meta);
  }
  if (chunk) {
    if (!streams[fileId] || !streams[fileId].controller) {
      // Queue chunk until stream is ready
      if (!pendingChunks[fileId]) pendingChunks[fileId] = [];
      pendingChunks[fileId].push(new Uint8Array(chunk));
      console.log('[SW] Queued chunk for', fileId, 'pending now', pendingChunks[fileId].length);
      return;
    }
    try {
      if (streams[fileId].closed) {
        console.warn('[SW] Ignoring chunk for closed stream', fileId, event.data);
        return;
      }
      console.log('[SW] Enqueue chunk for', fileId, 'length', chunk.byteLength, 'closed?', streams[fileId].closed);
      streams[fileId].controller.enqueue(new Uint8Array(chunk));
      streams[fileId].received += chunk.byteLength;
      console.log('[SW] Chunk received for', fileId, chunk.byteLength, 'total', streams[fileId].received);
    } catch (e) {
      // Defensive: Mark stream closed and delete entry to avoid repeated errors
      streams[fileId].closed = true;
      delete streams[fileId];
      console.warn('[SW] enqueue error, forcibly closing and deleting stream', e, fileId, event.data);
    }
  }
  if (done) {
    try {
      if (streams[fileId] && streams[fileId].controller && !streams[fileId].closed) {
        streams[fileId].controller.close();
        streams[fileId].closed = true;
        console.log('[SW] Stream closed for', fileId);
      }
    } catch (e) {
      console.warn('[SW] close error', e, fileId, event.data);
    }
    delete streams[fileId];
    delete pendingChunks[fileId];
  }
});
