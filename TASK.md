# TASK.md

## Active Tasks
- [ ] **UI:** Fix general UI issues and improve responsiveness (User Request)
- [ ] **BUG/Improvement:** Investigate and fix potential issues with "Download All" ZIP functionality (User Request)
- [ ] **Feature:** Add mobile-optimized UI
- [x] **Refactor:** Review and remove unused dependencies across `client`, `server`, and `signaling-server` (User Request) - Checked all package.json files and searched code; all declared dependencies seem to be used. Note: `/server` itself might be unused (see Discovered Tasks). (2025-05-03 8:52 PM)
- [ ] **Security/Prep:** Perform Security/Privacy review for open-sourcing (User Request)
- [ ] **Security/Prep:** Address `npm audit` vulnerabilities in `/client` (8 vulnerabilities: 2 moderate, 6 high from `react-scripts` transitive dependencies - `nth-check`, `postcss`). Requires careful update/override, `npm audit fix --force` is breaking. (Discovered 2025-05-03)
- [ ] **Security/Prep:** Check dependency licenses and add necessary notices for open-sourcing (User Request)
- [ ] **Deployment:** Configure TLS/SSL for production deployment (Mentioned in docs)
- [ ] **Deployment/Security:** Restrict CORS origins in `signaling-server/index.js` for production (currently `*`). (Discovered 2025-05-03)
- [ ] **Deployment/Security:** Restrict CORS origins in `server/index.js` for production (currently `*`) *if* this server is kept/used. (Discovered 2025-05-03)
- [ ] **Improvement/Security:** Add basic input validation on `signaling-server` for incoming socket messages (e.g., check data types/structure). (Discovered 2025-05-03)

## Completed Tasks (Verified 2025-05-03)
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
- The `/server` directory and its dependencies (`express`, `cors`, `socket.io`) appear unused by the current client implementation which connects directly to the `signaling-server`. Investigate if this directory can be removed.
- `npm audit` reported 8 vulnerabilities (2 moderate, 6 high) in `/client` due to `react-scripts` transitive dependencies (`nth-check`, `postcss`). Requires investigation.

- CORS origins are currently set to `*` (allow all) in `signaling-server` and `server`, which is insecure for production.

- Signaling server lacks input validation for socket messages.

---
*Last updated: 2025-05-03T18:03:30+05:30*

- [x] 2025-05-04 04:05 AM: Update URL when drive code is entered manually, so refresh keeps the user on the receiver page.
