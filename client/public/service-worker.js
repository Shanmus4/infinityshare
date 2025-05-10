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
  // console.log('[SW] Received FETCH event for URL:', event.request.url); // Diagnostic log removed
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/sw-download/')) {
    // console.log('[SW] FETCH event is for /sw-download/, processing for fileId:', url.pathname.split('/').pop()); // Diagnostic log removed
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
          meta: null, // Will store { filename, mimetype, fileSize }
          received: 0,
          closed: false
        };
        streams[fileId].metaResolve = (m) => {
          meta = m; // meta now includes fileSize
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
                // Ensure fileSize is included when flushing pending meta
                streams[fileId].meta = { filename: msg.filename, mimetype: msg.mimetype, fileSize: msg.fileSize };
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
        // Access meta from streams[fileId].meta as it's more reliably updated
        const metaInfo = streams[fileId] && streams[fileId].meta ? streams[fileId].meta : {};
        const filename = metaInfo.filename || 'download.bin';
        const mime = metaInfo.mimetype || 'application/octet-stream';
        const fileSize = metaInfo.fileSize ? metaInfo.fileSize.toString() : null;

        // console.log(`[SW fetch metaPromise.then] fileId: ${fileId}, metaInfo:`, JSON.stringify(metaInfo), `Resolved filename: ${filename}, Resolved mime: ${mime}, Resolved fileSize for header: ${fileSize}`); // Diagnostic log removed

        const responseHeaders = new Headers({
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        });

        if (fileSize) {
          responseHeaders.set('Content-Length', fileSize);
          // console.log(`[SW fetch metaPromise.then] Setting Content-Length to: ${fileSize}`); // Diagnostic log removed
        } else {
          // console.warn(`[SW fetch metaPromise.then] fileSize is null or invalid, Content-Length NOT set. metaInfo.fileSize was: ${metaInfo.fileSize}`); // Diagnostic log removed
        }

        resolve(new Response(stream, { headers: responseHeaders }));
      });
    }));
  }
});

self.addEventListener('message', (event) => {
  // console.log('[SW] Received MESSAGE event. Data:', event.data); // Diagnostic log removed
  // Destructure fileSize as well, assuming main thread sends it
  const { fileId, chunk, filename, mimetype, fileSize, done, cancel } = event.data;
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
      // Ensure fileSize (from event.data) is queued with other meta info
      pendingChunks[fileId].push({ type: 'meta', filename, mimetype, fileSize }); 
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
    // Ensure fileSize (from event.data) is stored with other meta info
    streams[fileId].meta = { filename, mimetype, fileSize }; 
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
