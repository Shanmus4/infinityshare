# File Transfer Web Application (P2P via WebRTC)

## Objective
Develop a web-based application for direct peer-to-peer (P2P) file transfers between sender and receiver using WebRTC, supporting QR code and drive code sharing, session management, and dynamic UI.

## Architecture Overview
- **Frontend:** React.js (dynamic UI), Dropzone.js (file upload), qrcode.js (QR code generation)
- **Backend:** Node.js + Express (serving app), WebSocket (signaling server), JWT/session for drive/session management
- **WebRTC:** Used for direct file transfer; relay server fallback if P2P fails (no file storage on server)
- **Security:** TLS/SSL for backend, WebRTC encryption, file integrity checks
- **Testing:** Pytest for backend logic, `/tests` mirrors backend structure

## Directory Structure
```
/file-send/
  /client/           # React frontend
  /server/           # Node.js backend (Express + WebSocket signaling)
  /tests/            # Pytest tests (for backend logic)
  PLANNING.md
  TASK.md
  README.md
  package.json       # (root for monorepo scripts)
```

## Key Features
- Upload files, generate/share QR/drive codes
- Scan QR or enter drive code to receive files
- Dynamic UI based on transfer state
- Session expiry and drive invalidation
- Secure, direct P2P transfers (no server storage)

## Naming, Structure & Conventions
- All code modular, max 500 lines/file
- Tests in `/tests`, mirror backend structure
- Use clear, consistent imports (relative within packages)
- Document non-obvious logic, inline `# Reason:` comments for complex logic

## Constraints
- No file storage on server
- All sessions expire on browser close or timeout
- All features must be covered by unit tests
- UI/UX must be modern, responsive, and intuitive

## Future Extensions
- Multi-file drag-and-drop
- Transfer progress indicators
- Internationalization support
