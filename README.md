# File Send: Peer-to-Peer File Transfer Web App

## Overview
File Send is a modern web application for secure, direct peer-to-peer (P2P) file transfers between devices using WebRTC. It enables users to send files without uploading them to any server. Files are shared via QR code or a short drive code, and are never stored on the backend. The app is designed for privacy, speed, and ease of use.

## Features
- Upload files and generate a QR code or drive code for sharing
- Scan QR or enter drive code to receive files on another device
- Dynamic, modern UI (React)
- Session expiry and drive invalidation for security
- Secure, encrypted transfers (WebRTC, TLS)
- No file storage on server—files go directly from sender to receiver
- Multi-file drag-and-drop (planned)
- Transfer progress indicators (planned)

## Architecture & Tech Stack
- **Frontend:** React.js, react-dropzone (file upload), qrcode.react (QR code generation), socket.io-client
- **Backend:** Node.js, Express (API), socket.io (WebSocket signaling), JWT/session for drive/session management
- **Signaling Server:** Dedicated Node.js + socket.io server for WebRTC signaling
- **Testing:** Pytest planned for backend logic (no tests yet)
- **Monorepo:** Contains `/client` (frontend), `/server` (backend API), `/signaling-server` (WebRTC signaling), `/tests` (for future backend tests)

## Directory Structure
```
/file-send/
  /client/           # React frontend
  /server/           # Node.js backend (Express + WebSocket signaling)
  /signaling-server/ # Standalone signaling server for WebRTC
  /tests/            # Pytest tests (planned)
  PLANNING.md
  TASK.md
  README.md
  package.json       # (root for monorepo scripts)
```

## Security Model
- All file transfers are end-to-end encrypted via WebRTC
- Backend and signaling use TLS/SSL (configure in production)
- No files are ever stored on the server
- Sessions expire after 10 minutes or when the sender disconnects

## Getting Started
1. Install dependencies:
   ```sh
   cd client && npm install
   cd ../server && npm install
   cd ../signaling-server && npm install
   ```
2. Start the signaling server:
   ```sh
   cd signaling-server && node index.js
   ```
3. Start the backend server:
   ```sh
   cd server && npm start
   ```
4. Start the frontend:
   ```sh
   cd client && npm start
   ```

## Testing
- **Backend tests:** Pytest structure is set up, but no tests are implemented yet. (See `/tests`)

## Contributing
- Please see `PLANNING.md` and `TASK.md` for architecture, features, and active tasks.
- Follow the code style and modularity rules in `PLANNING.md`.

---
For questions or issues, open an issue or see the project planning docs.
