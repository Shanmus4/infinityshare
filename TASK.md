# TASK.md

## Active Tasks

- [x] **Feature: Implement Twilio TURN Server Integration** (User Request 2025-05-11, Completed 2025-05-11)
  - `signaling-server/index.js` updated with Express.js to serve temporary STUN/TURN credentials from Twilio via an `/api/ice-servers` endpoint. Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` as environment variables.
  - `client/src/utils/signaling.js` updated to fetch ICE server configuration from this endpoint, with fallback to public STUNs.
  - `App.js`, `useZipDownload.js`, `useWebRTC.js` updated to use the dynamically fetched ICE server configuration.
- [ ] **BUGFIX & Stability:** Monitor WebRTC connection stability and performance with TURN server integration. (Ongoing)
  - Symptoms:
    - Previously: Mid-transfer drops (heartbeat timeouts, possibly due to WebSocket instability), connection failures on restrictive networks (STUN 701 errors), and slow local transfers when TURN was enabled (suggesting TURN was chosen over local P2P).
  - Current Status (2025-05-11):
    - **Full STUN+TURN functionality re-enabled.** `getIceServers()` in `client/src/utils/signaling.js` now calls `fetchIceServers_ORIGINAL()` to get config from backend.
    - Diagnostic test showed local transfers were faster with STUN-only, indicating local P2P paths might not be optimally chosen by ICE when TURN candidates are present on some networks.
    - Heartbeat mechanism adjusted (Sender: 90s timeout, 15s check; Receiver: sends every 10s).
    - ICE connection timeouts (30s) implemented.
    - WebRTC state cleanup logic improved.
  - Next Steps: User to test transfers on various networks (local and remote).
    - Monitor for connection success rates.
    - Observe transfer speeds, especially on local networks (is P2P being prioritized over TURN?).
    - Check for WebSocket stability (`[Socket]...` logs).
    - If local transfers are consistently slow with TURN enabled, further investigation into local network configuration (firewalls, AP isolation, mDNS) or advanced ICE candidate filtering might be needed.

## Completed Tasks (Verified 2025-05-10)

- [x] **UI:** Update progress bar text to display `(Downloaded Size / Total Size)` next to the main operation text (e.g., "Downloading and Zipping All Files..."), with "Downloaded Size" in primary green. (User Request 2025-05-10, Completed 2025-05-10)
  - Modified `client/src/App.js` to update the `.progress-filename-text` display.
- [x] **Feature: Screen Wake Lock (using NoSleep.js)** (User Request 2025-05-10, Implemented 2025-05-10)
  - `nosleep.js` library is installed in `/client`.
  - Integrated `NoSleep.js` directly into `client/src/App.js` as per the library's official usage example:
    - Imports `NoSleep` from `nosleep.js`.
    - Uses a `useRef` (e.g., `noSleepRef`) to store the `NoSleep` instance.
    - A `useEffect` hook initializes `noSleepRef.current = new NoSleep();` on component mount.
    - Event listeners for 'click' and 'touchstart' are added to `document.body` (with `{ once: true }`). These listeners call a function that enables the wake lock via `noSleepRef.current.enable()`.
    - The cleanup function in `useEffect` disables the wake lock if active and cleans up the ref and listeners.
  - The custom `client/src/hooks/useNoSleep.js` file was previously deleted.

## Completed Tasks (Verified 2025-05-04)

- [x] **Feature: PWA Configuration** (User Request 2025-05-09, Completed 2025-05-09)
  - Created `client/public/manifest.json` with app metadata.
  - Linked manifest in `client/public/index.html`.
  - Added `client/src/serviceWorkerRegistration.js` for CRA PWA service worker lifecycle.
  - Updated `client/src/index.js` to call `serviceWorkerRegistration.register()`.
  - Added `apple-touch-icon` link to `client/public/index.html` for better iOS home screen icon.
- [x] **SEO:** Add `og:url` and `twitter:url` to `client/public/index.html` after deployment. (Discovered 2025-05-07, Completed 2025-05-09 - Actual URL `https://infinityshare.netlify.app/` added.)
- [x] **Deployment:** Configure and deploy frontend (Netlify/Vercel) and signaling server (Render/Fly.io). (User Request 2025-05-09, Completed 2025-05-09 - Steps provided, user execution and URL updates done. Netlify redirect rule for client-side routing added.)
  - Signaling server configured for `process.env.PORT` and HTTP (SSL termination by platform).
  - Frontend `SIGNALING_SERVER_URL` configured for production environment variable.
  - Frontend build process outlined.
  - Deployment steps for Render (signaling) and Netlify (frontend) provided.
  - CORS and frontend URL environment variables explained.
  - Added `client/public/_redirects` file for Netlify to handle client-side routing (e.g., `/DRIVE_CODE?as=receiver`).

- [x] **UI Styling:** Apply CSS changes provided by the user for colors, fonts, and general styling. (User Request 2025-05-07)
- [x] **UI:** Fix general UI issues and improve responsiveness (User Request)
- [x] **Feature:** Add mobile-optimized UI
- [x] **UI & Feature:** Implement folder structure display and actions (User Request 2025-05-04, Completed 2025-05-04 3:05 PM)
  - Captured `file.path` in `App.js`.
  - Implemented expandable/collapsible tree view in `FileList.js`.
  - Added Delete/Download buttons for folders in `FileList.js`.
  - Added `handleDeleteFolder` in `App.js`.
  - Refactored `useZipDownload.js` to handle both "Download All" and specific folder downloads (using `startZipProcess(folderPath?)`).
- **Fixed:** Moved speed/ETR calculation back into `onmessage` handler for accuracy (2025-05-04 4:16 PM)
  - Updated sender (`App.js`) to handle folder download requests via `isFolderRequest` flag.
  - Integrated refactored `useZipDownload` hook into `App.js` receiver view for both button types.
  - Removed unused `useFolderDownload.js` hook.
- [x] **UI/UX:** Show folder download progress inline, disable other folders, and restore "Download All" progress (User Request 2025-05-04, Completed 2025-05-04 4:35 PM)
  - Added `zippingFolderPath` state to `useZipDownload` hook.
  - Passed progress state (`isZipping`, `zippingFolderPath`, `zipProgress`, etc.) and formatters from `App.js` to `FileList.js`.
  - Updated `FileList.js` (`RenderNode`) to display progress inline (including "Please wait..." text) for the specific folder being zipped.
  - Updated `FileList.js` (`RenderNode`) to disable download buttons for other folders when `isZipping` is true.
  - Restored global progress display in `App.js`, conditional on `isZipping && !zippingFolderPath` (for "Download All").
- [x] **BUG & Improvements:** Fix and enhance "Download All" ZIP functionality (User Request, Completed 2025-05-04 1:24 PM)
  - **Fixed:** Resolved failures caused by ICE errors (non-fatal 701 treated as fatal) and background tab throttling.
    - _Root cause: Likely browser/network limits with multiple PeerConnections. Background tab throttling also caused stalls._
    - _Fix: Refactored to use a single PeerConnection with multiple DataChannels. Switched sender loop to `setTimeout`. Modified ICE error handling._
  - **Improved:** Removed artificial delay between file requests to increase speed.
  - **Improved:** Changed downloaded zip filename to `InfinityShare Files.zip`.
  - **Improved:** Updated progress calculation (80% download/20% zip weighting) and display (removed individual file progress, added 2 decimal places).
  - **Improved:** Added download speed and ETR calculation/display.
- [x] **Refactor:** Review and remove unused dependencies across `client`, `server`, and `signaling-server` (User Request) - Done (2025-05-04): `/server` directory removed. Other dependencies checked.
- [x] **Security/Prep:** Address `npm audit` vulnerabilities in `/client` (8 vulnerabilities: 2 moderate, 6 high from `react-scripts` transitive dependencies - `nth-check`, `postcss`). **Mitigation Applied (2025-05-04):** Added `overrides` for `nth-check@2.0.1` and `postcss@8.4.31` in `client/package.json` and reinstalled. `npm audit` still reports the vulnerabilities, but the overrides should force the use of patched versions. `npm audit fix --force` was avoided as breaking.
- [x] **Security/Prep:** Perform Security/Privacy review for open-sourcing (User Request) - **Done (2025-05-04):** Hardcoded Twilio credentials removed from client (`client/src/utils/signaling.js`). Signaling server logging reviewed (seems okay). CORS restricted. Input validation added. XSS checked in `FileList`, `App`, `ErrorBanner` (React escaping handles it). Lack of rate limiting on signaling server noted as potential improvement area. Git history cleaned of secrets.
- [x] **Security/Prep:** Check dependency licenses for open-sourcing (User Request) - **Done (2025-05-04):** Manually reviewed direct dependencies in `client` and `signaling-server`. All use permissive licenses (MIT, ISC). `license-checker` tool failed to scan.
- [x] **Prep:** Choose and add an open-source license file (e.g., MIT) to the project root. (Done 2025-05-04)
- [x] **Deployment/Security:** Restrict CORS origins in `signaling-server/index.js` for production (Done 2025-05-04 via environment variable `ALLOWED_ORIGINS`).
- [x] **Improvement/Security:** Add basic input validation on `signaling-server` for incoming socket messages (e.g., check data types/structure). (Done 2025-05-04)
- [x] Set up project skeleton (client, server, signaling-server, tests)
- [x] Generate `package-lock.json` for `client`, `server`, `signaling-server`
- [x] Remove unused `jsonwebtoken` dependency from `/server`
- [x] Implement standalone signaling server (Node.js + Socket.io for room management and WebRTC signaling relay)
- [x] Implement client-side drive code generation and joining logic
- [x] Implement React frontend (Initial setup, Sender view, Receiver view)
- [x] Integrate react-dropzone for file upload
- [x] Integrate qrcode.react for QR code generation
- [x] Implement WebRTC file transfer logic (P2P via DataChannels)
- [x] Implement client-side session handling (URL parsing, state management, leave warning)
- [x] Implement basic security (WebRTC encryption)
- [x] Add monorepo structure and root scripts (`package.json`)
- [x] Implement Service Worker for single file download streaming (`client/public/service-worker.js`)
- [x] Implement "Download All" functionality using JSZip and FileSaver (`client/src/hooks/useZipDownload.js`)
- [x] Implement adding/deleting files dynamically on sender side
- [x] Implement joining drive via URL path or code input field
- [x] Implement basic error handling/display component (`client/src/components/ErrorBanner.js`)
- [x] Update README.md and PLANNING.md (Initial versions)
- [x] BUG FIX: Download of newly appended files is slow or stuck unless page is refreshed (fixed YYYY-MM-DD HH:MM, ensured SW is ready before starting download)

## Discovered During Work (2025-05-03)

- **RESOLVED (2025-05-04):** The `/server` directory was confirmed unused and has been removed.
- **MITIGATED (2025-05-04):** `npm audit` reported 8 vulnerabilities (2 moderate, 6 high) in `/client` due to `react-scripts` transitive dependencies (`nth-check`, `postcss`). Added `overrides` in `client/package.json` as mitigation, although `npm audit` continues to report them.

- **RESOLVED (2025-05-04):** CORS origins are now configurable via environment variable (`ALLOWED_ORIGINS`) in `signaling-server`. `/server` was removed.

- **RESOLVED (2025-05-04):** Basic input validation added to signaling server socket event handlers.

---

_Last updated: 2025-05-03T18:03:30+05:30_

- [x] **UI:** Update URL when drive code is entered manually, so refresh keeps the user on the receiver page. (2025-05-04 04:05 AM)
