import { useEffect } from "react";

export function useServiceWorker(onMessage) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js");
    }
  }, []);

  useEffect(() => {
    if (!onMessage) return;
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [onMessage]);

  // Helper to post message to SW
  function postMessage(msg) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  return { postMessage };
}

/* Add these changes to your service-worker.js file */

// Add this map to track stream controllers by fileId
const streamControllers = new Map();

// Update your message event handler to properly handle chunks
self.addEventListener("message", (event) => {
  const data = event.data;

  // Handle file metadata
  if (data.type === "meta") {
    console.log("[SW] Meta received for", data.fileId, data.meta);

    if (!streamControllers.has(data.fileId)) {
      // Create a new ReadableStream
      const { readable, writable } = new TransformStream();
      const controller = writable.getWriter();

      // Store the controller for later use
      streamControllers.set(data.fileId, {
        controller,
        readable,
        meta: data.meta,
      });

      // Create a download using the stream
      const fileName = data.meta.name;
      const headers = new Headers({
        "Content-Type": data.meta.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": data.meta.size
          ? data.meta.size.toString()
          : undefined,
      });

      const response = new Response(readable, { headers });

      // Store the stream for later
      caches.open("streams").then((cache) => {
        const url = new URL(`/download/${data.fileId}`, self.location.origin)
          .href;
        cache.put(url, response).then(() => {
          console.log("[SW] Cached stream for", data.fileId, "at", url);

          // Notify the client that the download is ready
          event.source.postMessage({
            type: "download-ready",
            fileId: data.fileId,
            url,
          });
        });
      });
    }
  }
  // Handle file chunks
  else if (data.type === "chunk") {
    if (streamControllers.has(data.fileId)) {
      const { controller } = streamControllers.get(data.fileId);

      if (data.chunk) {
        // Write the chunk to the stream
        const uint8Array = new Uint8Array(data.chunk);
        controller.write(uint8Array);
      }

      if (data.done) {
        // Close the stream
        controller.close();
        console.log("[SW] Stream closed for", data.fileId);
        streamControllers.delete(data.fileId);
      }
    } else {
      console.error("[SW] No stream controller found for", data.fileId);
    }
  }
  // Legacy compatibility for your existing code
  else if (data.fileId) {
    if (data.done) {
      // Handle EOF
      if (streamControllers.has(data.fileId)) {
        const { controller } = streamControllers.get(data.fileId);
        controller.close();
        console.log("[SW] Stream closed for", data.fileId);
        streamControllers.delete(data.fileId);
      }
    } else if (data.meta) {
      // Handle metadata in legacy format - process it like 'type: meta'
      console.log("[SW] Legacy meta received for", data.fileId, data.meta);

      if (!streamControllers.has(data.fileId)) {
        const { readable, writable } = new TransformStream();
        const controller = writable.getWriter();
        streamControllers.set(data.fileId, {
          controller,
          readable,
          meta: data.meta,
        });

        const headers = new Headers({
          "Content-Type": data.meta.type || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${data.meta.name}"`,
          "Content-Length": data.meta.size
            ? data.meta.size.toString()
            : undefined,
        });

        const response = new Response(readable, { headers });

        caches.open("streams").then((cache) => {
          const url = new URL(`/download/${data.fileId}`, self.location.origin)
            .href;
          cache.put(url, response).then(() => {
            console.log("[SW] Cached stream for", data.fileId, "at", url);
            event.source.postMessage({
              type: "download-ready",
              fileId: data.fileId,
              url,
            });
          });
        });
      }
    } else if (data.chunk || data.data) {
      // Handle chunk in legacy format
      const chunk = data.chunk || data.data;
      if (chunk && streamControllers.has(data.fileId)) {
        const { controller } = streamControllers.get(data.fileId);
        const uint8Array = new Uint8Array(chunk);
        controller.write(uint8Array);
      }
    }
  }
});

// Update your fetch handler to serve the cached streams
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Check if this is a request for a cached download
  if (url.pathname.startsWith("/download/")) {
    event.respondWith(
      caches.open("streams").then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            console.log("[SW] Serving cached stream for", url.pathname);
            return response;
          }
          return new Response("File not found", { status: 404 });
        });
      })
    );
  }
});
