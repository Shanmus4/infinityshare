# File Send: Project Planning & Architecture

## Objective
Develop a web-based application for direct peer-to-peer (P2P) file transfers between sender and receiver using WebRTC, supporting QR code and drive code sharing, session management, and a dynamic, modern UI. No files are ever stored on the server.

## Architecture Overview
- **Frontend:** React.js (dynamic UI), react-dropzone (file upload), qrcode.react (QR code generation)
- **Backend:** Node.js + Express (serving API), socket.io (WebSocket signaling), JWT/session for drive/session management
- **Signaling Server:** Standalone Node.js + socket.io server for WebRTC signaling
- **WebRTC:** Used for direct file transfer; relay server fallback if P2P fails (no file storage on server)
- **Security:** TLS/SSL for backend and signaling, WebRTC encryption, file integrity checks
- **Testing:** Pytest for backend logic (planned), `/tests` mirrors backend structure

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

## Key Features (Implemented)
- Upload files, generate/share QR or drive codes
- Scan QR or enter drive code to receive files
- Dynamic UI based on transfer state
- Session expiry and drive invalidation
- Secure, direct P2P transfers (no server storage)

## Naming, Structure & Conventions
- All code modular, max 500 lines/file (split into modules/helpers if needed)
- Organize code into clearly separated modules, grouped by feature or responsibility
- Use clear, consistent imports (prefer relative imports within packages)
- Tests in `/tests`, mirror backend structure
- Comment non-obvious code and add inline `# Reason:` comments for complex logic
- Never delete or overwrite existing code unless explicitly instructed or as part of a tracked task

## Constraints
- No file storage on server
- All sessions expire on browser close, disconnect, or timeout (10 min)
- All features must be covered by unit tests (planned)
- UI/UX must be modern, responsive, and intuitive
- Never create a file longer than 500 lines of code

## Future Extensions
- Multi-file drag-and-drop (planned)
- Transfer progress indicators (planned)
- Internationalization support (planned)
- Mobile-optimized UI
- Integration with cloud storage (optional)

## Testing & Reliability
- Pytest structure is set up, but no tests are implemented yet
- All new features must include at least:
  - 1 test for expected use
  - 1 edge case
  - 1 failure case
- Tests should live in `/tests` and mirror the main app structure

## Documentation
- Update `README.md` for new features, dependencies, or setup changes
- Mark completed tasks in `TASK.md` and add new sub-tasks as discovered
- See `TASK.md` for active and completed tasks

## Gotchas / Troubleshooting
* When supporting dynamic file appends, always synchronize download start with service worker readiness to avoid slow or stuck downloads.
