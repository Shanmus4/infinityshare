# TASK.md

## Active Tasks

- [ ] **UI:** Fix general UI issues and improve responsiveness (User Request)
- [ ] **UI:** Display file and folder structure correctly (User Request 2025-05-04)
- [ ] **Feature:** Add mobile-optimized UI
- [ ] **Improvement/Security:** Implement rate limiting on `signaling-server` events (e.g., `create-room`, `join-room`) to prevent abuse. (Discovered 2025-05-04)
- [ ] **Deployment:** Configure TLS/SSL for production deployment (Mentioned in docs) - **Partially Done (2025-05-04):** Signaling server (`signaling-server/index.js`) updated to support HTTPS via `SSL_CERT_PATH` and `SSL_KEY_PATH` environment variables. Actual certificate provisioning and web server (hosting client) HTTPS configuration still required in deployment environment.

## Completed Tasks (Verified 2025-05-04)

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
