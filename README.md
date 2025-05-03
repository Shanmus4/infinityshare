# File Send: Peer-to-Peer File Transfer Web App

## Overview

File Send is a modern web application for secure, direct peer-to-peer (P2P) file transfers between devices using WebRTC. It enables users to send files without uploading them to any server. Files are shared via QR code or a short drive code, and are never stored on the backend. The app is designed for privacy, speed, and ease of use.

## Features (Verified 2025-05-03)

- Upload files via drag-and-drop or file selection.
- Generate a unique drive code and QR code for sharing.
- Join a drive using the URL path, drive code input, or by scanning the QR code.
- Add/delete files dynamically on the sender side (updates receiver list in real-time).
- Secure, direct peer-to-peer (P2P) file transfer using WebRTC DataChannels (DTLS encryption).
- Single file download streaming via Service Worker for efficient handling.
- "Download All" functionality: Downloads all files via WebRTC, zips them in the browser (`JSZip`), and saves (`FileSaver`).
- Basic progress indication for the "Download All" process.
- No file storage on any server.
- Sender must keep the tab open; closing it ends the session.
- Warning displayed to sender before closing/reloading the tab.

## Architecture & Tech Stack

- **Frontend:** React.js, react-dropzone, qrcode.react, socket.io-client, jszip, file-saver.
- **Signaling Server:** Standalone Node.js + socket.io server (`/signaling-server`) handles room management and WebRTC signaling relay. **This is the only active backend component.**
- **Backend (`/server`):** _Currently unused_ Node.js + Express directory. Needs review for potential removal.
- **WebRTC:** Direct P2P communication via `RTCDataChannel`.
- **Service Worker:** (`/client/public/service-worker.js`) Handles streaming downloads for single files.
- **Testing:** Pytest structure exists (`/tests`), but tests for the signaling server are not yet implemented.
- **Monorepo:** Contains `/client`, `/server` (unused?), `/signaling-server`, `/tests`.

## Directory Structure

```
/file-send/
  /client/           # React frontend (main application logic)
  /server/           # Node.js backend (Currently unused? Needs review)
  /signaling-server/ # Standalone Node.js + Socket.io signaling server (Active)
  /tests/            # Pytest tests (planned for signaling-server)
  PLANNING.md        # Project architecture and guidelines
  TASK.md            # Active and completed tasks
  README.md          # This file
  package.json       # Root package file (monorepo scripts)
```

## Security Model

- All file transfers are end-to-end encrypted via WebRTC (DTLS).
- The signaling server only relays messages and does not store files.
- **Production:** The signaling server should be configured with TLS/SSL for secure WebSocket connections (`wss://`).
- No files are ever stored on any server.
- Sessions are transient and depend on the sender keeping their browser tab open.
- **Vulnerabilities:** As of 2025-05-03, `npm audit` reports 8 vulnerabilities (2 moderate, 6 high) in the client dependencies, originating from `react-scripts`. These need investigation and resolution before production deployment. See `TASK.md` for details.

## Getting Started

1.  **Prerequisites:** Node.js and npm installed.
2.  **Install Dependencies:**
    ```sh
    # Navigate to the project root directory
    cd client && npm install
    cd ../signaling-server && npm install
    # cd ../server && npm install # Skip this, as /server seems unused
    ```
3.  **Start the Signaling Server:**
    ```sh
    cd signaling-server
    node index.js
    # Keep this terminal running
    ```
4.  **Start the Frontend:**
    ```sh
    cd ../client
    npm start
    # Keep this terminal running
    ```
5.  Open your browser to the address provided by the frontend (usually `http://localhost:3000` or similar).

## Testing

- **Signaling Server Tests:** Pytest structure is set up in `/tests`, but tests need to be implemented.

## Contributing

- Please see `PLANNING.md` and `TASK.md` for architecture details, contribution guidelines, and active development tasks.
- Key areas for contribution include UI improvements, bug fixes (especially for "Download All"), implementing tests, and refactoring large components like `client/src/App.js`.
- Follow the code style and modularity rules outlined in `PLANNING.md`.

## Changelog

- **2025-05-03:** Documentation updated, codebase analyzed, tasks updated. Identified unused `/server` directory. Added "Download All" feature using JSZip.
- _(Previous)_ Fixed a race condition by ensuring the service worker is ready before starting downloads for newly added files.

---

For questions or issues, please open an issue on the repository or refer to the project planning documents (`PLANNING.md`, `TASK.md`).
