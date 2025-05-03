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
          // Flush any pending messages for this fileId
          if (pendingChunks[fileId]) {
            //console.log('[SW] Flushing pending messages for', fileId, pendingChunks[fileId]);
            pendingChunks[fileId].forEach(msg => {
              if (msg.type === 'meta') {
                streams[fileId].meta = { filename: msg.filename, mimetype: msg.mimetype };
                if (streams[fileId].metaResolve) streams[fileId].metaResolve(streams[fileId].meta);
              }
              if (msg.type === 'chunk') {
                try {
                  streams[fileId].controller.enqueue(new Uint8Array(msg.chunk));
                  streams[fileId].received += msg.chunk.byteLength;
                  //console.log('[SW] Flushed chunk for', fileId, msg.chunk.byteLength);
                } catch (e) {
                  streams[fileId].closed = true;
                  delete streams[fileId];
                  console.warn('[SW] Error flushing chunk for', fileId, e);
                }
              }
              if (msg.type === 'done') {
                try {
                  if (streams[fileId] && streams[fileId].controller && !streams[fileId].closed) {
                    streams[fileId].controller.close();
                    streams[fileId].closed = true;
                    //console.log('[SW] Flushed done for', fileId);
                  }
                } catch (e) {}
                delete streams[fileId];
                delete pendingChunks[fileId];
              }
            });
            delete pendingChunks[fileId];
          }
          console.log('[SW] Stream created for', fileId);
        }
      });
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
  const { fileId, chunk, filename, mimetype, done, cancel } = event.data;
  // Cancel download if requested
  if (cancel && fileId) {
    if (streams[fileId] && streams[fileId].controller && !streams[fileId].closed) {
      try {
        streams[fileId].controller.error('Download canceled by sender.');
        streams[fileId].closed = true;
        console.log('[SW] Download canceled for', fileId);
      } catch (e) {
        console.warn('[SW] Error canceling stream', fileId, e);
      }
    }
    delete streams[fileId];
    delete pendingChunks[fileId];
    return;
  }
  // If stream doesn't exist yet, queue everything (meta, chunk, done)
  if (!streams[fileId]) {
    if (!pendingChunks[fileId]) pendingChunks[fileId] = [];
    if (filename) {
      pendingChunks[fileId].push({ type: 'meta', filename, mimetype });
      //console.log('[SW] Queued meta for missing stream', fileId, event.data);
    }
    if (chunk) {
      pendingChunks[fileId].push({ type: 'chunk', chunk });
      //console.log('[SW] Queued chunk for missing stream', fileId, event.data);
    }
    if (done) {
      pendingChunks[fileId].push({ type: 'done' });
      //console.log('[SW] Queued done for missing stream', fileId, event.data);
    }
    return;
  }
  if (filename) {
    streams[fileId].meta = { filename, mimetype };
    if (streams[fileId].metaResolve) streams[fileId].metaResolve(streams[fileId].meta);
    //console.log('[SW] Meta received for', fileId, streams[fileId].meta);
  }
  if (chunk) {
    try {
      if (streams[fileId].closed) {
        console.warn('[SW] Ignoring chunk for closed stream', fileId, event.data);
        return;
      }
      streams[fileId].controller.enqueue(new Uint8Array(chunk));
      streams[fileId].received += chunk.byteLength;
      //console.log('[SW] Chunk received for', fileId, chunk.byteLength, 'total', streams[fileId].received);
    } catch (e) {
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
        //console.log('[SW] Stream closed for', fileId);
      }
    } catch (e) {
      console.warn('[SW] close error', e, fileId, event.data);
    }
    delete streams[fileId];
    delete pendingChunks[fileId];
  }
});
