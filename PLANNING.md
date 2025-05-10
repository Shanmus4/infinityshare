# File Send: Project Planning & Architecture

## Objective
Develop a web-based application for direct peer-to-peer (P2P) file transfers between sender and receiver using WebRTC, supporting QR code and drive code sharing, session management, and a dynamic, modern UI. No files are ever stored on the server.

## Architecture Overview
- **Frontend:** React.js (dynamic UI), react-dropzone (file upload), qrcode.react (QR code generation), socket.io-client (signaling), jszip (zipping), file-saver (saving files), nosleep.js (screen wake lock).
- **Signaling Server:** Standalone Node.js + socket.io server for room management and WebRTC signaling relay. This is the active backend component.
- **WebRTC:** Used for direct P2P file transfer via `RTCDataChannel`.
- **Service Worker:** (`client/public/service-worker.js`) Intercepts download requests for single file streaming and enables PWA app shell caching. Registered via `client/src/serviceWorkerRegistration.js`.
- **PWA Support:** Includes `client/public/manifest.json` for installability ("Add to Home Screen") and app-like experience.
- **Security:** WebRTC encryption (DTLS). TLS/SSL for signaling server (requires setup for production).
- **Testing:** Pytest structure exists in `/tests`, but no tests are implemented yet.

## Directory Structure
```
/file-send/
  /client/           # React frontend (main application logic)
  /signaling-server/ # Standalone Node.js + Socket.io signaling server (Active)
  /tests/            # Pytest tests (planned)
  PLANNING.md
  TASK.md
  README.md
  package.json       # (root for monorepo scripts)
```

## Key Features (Implemented - Verified 2025-05-10)
- Upload files (drag-and-drop or select), including folder structure.
- Generate unique drive code and QR code for sharing.
- Join drive via URL path, drive code input, or QR scan.
- Add/delete files dynamically on sender side (updates receiver list).
- Direct P2P file transfer using WebRTC DataChannels.
- Single file download streaming via Service Worker.
- "Download All" functionality (downloads files via WebRTC, zips in browser using JSZip, saves using FileSaver).
- Download specific folders as a zip file.
- Enhanced progress indication for "Download All" and folder downloads (overall progress, speed, ETA, downloaded/total size).
- Client-side session handling (state management, URL parsing).
- Warning before closing/reloading sender/receiver tab during active operations.
- Standalone signaling server for relaying messages.
- **Progressive Web App (PWA):** Installable to home screen with basic offline app shell caching.
- **Screen Wake Lock:** Uses NoSleep.js to attempt to keep the screen awake during active use, preventing interruptions on mobile devices.

## Naming, Structure & Conventions
- All code modular, max 500 lines/file (split into modules/helpers if needed) - *Note: `client/src/App.js` exceeds this limit and needs refactoring.*
- Organize code into clearly separated modules, grouped by feature or responsibility (e.g., `/hooks`, `/components`, `/utils`)
- Use clear, consistent imports (prefer relative imports within packages)
- Tests in `/tests`, mirror backend/signaling structure (planned)
- Comment non-obvious code and add inline `# Reason:` comments for complex logic
- Never delete or overwrite existing code unless explicitly instructed or as part of a tracked task

## Constraints
- No file storage on any server (Signaling server only relays messages)
- Sender must keep the browser tab open for the drive to remain active. Closing/reloading the tab ends the session. Receiver also needs to keep tab open for active downloads.
- All features must be covered by unit tests (planned)
- UI/UX must be modern, responsive, and intuitive (requires improvement)
- Files larger than browser memory limits might fail during "Download All" zipping.

## Future Extensions / Active Tasks (See TASK.md for full list)
- UI Improvements & Responsiveness
- Bugfix/Improvements for "Download All"
- Multi-file drag-and-drop support (beyond current folder drop)
- Mobile-optimized UI (ongoing)
- Backend/Signaling Server Tests
- Dependency Cleanup
- Security/Privacy Review for Open Source (ongoing)
- License Checks for Open Source (ongoing)
- Production TLS/SSL Setup for Signaling Server
- Internationalization support (planned)
- Integration with cloud storage (optional)

## Testing & Reliability
- Pytest structure is set up in `/tests`, but no tests are implemented yet.
- All new features must include at least:
  - 1 test for expected use
  - 1 edge case
  - 1 failure case
- Tests should live in `/tests` and mirror the main app structure (likely `signaling-server` structure).

## Documentation
- Update `README.md` for new features, dependencies, or setup changes.
- Mark completed tasks in `TASK.md` and add new sub-tasks as discovered.
- See `TASK.md` for active and completed tasks.

## Gotchas / Troubleshooting
* **Service Worker Sync:** Always synchronize download start with service worker readiness (`sw-ready` message) to avoid slow or stuck downloads, especially for dynamically added files.
* **Download All Memory:** Zipping large files entirely in the browser (`JSZip`) can consume significant memory and may fail for very large transfers. Consider alternative approaches (e.g., streaming zip generation) if this becomes an issue.
* **App.js Size:** `client/src/App.js` is very large and handles too many responsibilities. Refactor into smaller hooks and components.
* **NoSleep.js Activation:** `NoSleep.js` relies on user interaction (like a click or touch) to initially enable its video-based wake lock. This is handled by the library, but ensure the first user interaction happens for it to take effect.
