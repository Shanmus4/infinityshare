# File Transfer Web Application (P2P via WebRTC)

## Overview
This project enables secure, direct peer-to-peer file transfers between devices using WebRTC, with QR code and drive code sharing. No files are stored on the server.

## Features
- Upload files and generate QR/drive codes for sharing
- Scan QR or enter drive code to receive files
- Dynamic, modern UI (React)
- Session expiry and drive invalidation
- Secure, encrypted transfers

## Tech Stack
- **Frontend:** React.js, Dropzone.js, qrcode.js
- **Backend:** Node.js, Express, WebSocket (signaling), JWT/session
- **Testing:** Pytest for backend logic

## Getting Started
1. Install dependencies in `/client` and `/server`:
   ```sh
   cd client && npm install
   cd ../server && npm install
   ```
2. Start backend server:
   ```sh
   cd server && npm start
   ```
3. Start frontend:
   ```sh
   cd client && npm start
   ```

## Security
- TLS/SSL for backend
- WebRTC encryption
- No file storage on server

## Testing
- Run backend tests:
  ```sh
  cd tests && pytest
  ```

---
See `PLANNING.md` and `TASK.md` for architecture, features, and active tasks.
