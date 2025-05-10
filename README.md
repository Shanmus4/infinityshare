# InfinityShare: Peer-to-Peer File Transfer

**Live Website: [https://infinityshare.netlify.app/](https://infinityshare.netlify.app/)**

InfinityShare is a web application for direct, secure, and private peer-to-peer (P2P) file transfers. Share files of any size directly between devices without uploading them to any server.

## How to Use InfinityShare

InfinityShare makes file transfer simple and quick:

**1. Sender:**
   - Open [InfinityShare](https://infinityshare.netlify.app/) in your browser.
   - Drag and drop files/folders you want to share into the "Send" area, or click to select them.
   - A unique 4-character "Drive Code" and a QR code will be generated.
   - Share this Drive Code or QR code with the receiver.

**2. Receiver:**
   - Open [InfinityShare](https://infinityshare.netlify.app/) on another device.
   - In the "Receive" section, enter the 4-character Drive Code provided by the sender and click "Join Drive".
   - Alternatively, if the sender shared a direct link (which includes the drive code), opening that link will automatically attempt to join the drive.
   - If you have a QR code scanner, you can scan the QR code displayed on the sender's screen to join.
   - Once connected, you will see the list of shared files.
   - Click the download icon next to a file/folder to download it, or use the "Download All" button to get all files as a single ZIP archive.

**Important Notes for Optimal Use:**
*   **Network:** For the fastest transfer speeds, ensure both devices are on the **same local network** (e.g., connected to the same Wi-Fi router or hotspot). While transfers can work over the internet, local network connections are significantly faster.
*   **Keep Tab Active:** Both the sender and receiver must keep the InfinityShare browser tab **open and active** for the duration of the transfer. Closing the tab or navigating away will interrupt the connection and stop the transfer.
*   **Screen Sleep:** InfinityShare attempts to keep your device's screen awake during active use (sending or receiving) to prevent transfers from being interrupted, especially on mobile devices. This uses the `NoSleep.js` library.

**Progressive Web App (PWA) - Install for an App-Like Experience:**

InfinityShare is a PWA, meaning you can "install" it on your device for easier access and an experience similar to a native app.

*   **Desktop (Chrome, Edge):**
    1.  Navigate to [https://infinityshare.netlify.app/](https://infinityshare.netlify.app/).
    2.  Look for an "Install" icon in the address bar (usually a computer with a down arrow).
    3.  Click it and follow the prompts to install.
*   **Android (Chrome):**
    1.  Navigate to [https://infinityshare.netlify.app/](https://infinityshare.netlify.app/) in Chrome.
    2.  Tap the three-dot menu icon.
    3.  Select "Install app" or "Add to Home screen."
*   **iOS (Safari):**
    1.  Navigate to [https://infinityshare.netlify.app/](https://infinityshare.netlify.app/) in Safari.
    2.  Tap the "Share" icon (a square with an upward arrow).
    3.  Scroll down and tap "Add to Home Screen."
    4.  Confirm by tapping "Add."

## Key Features

- **Direct P2P Transfers:** Files are sent directly between browsers using WebRTC, ensuring privacy and speed.
- **No Server-Side Storage:** Your files are never uploaded to or stored on any server.
- **Drag & Drop Uploads:** Easily add files and entire folder structures.
- **Drive Code & QR Sharing:** Simple sharing using a 4-character code or a scannable QR code.
- **URL-Based Joining:** Receivers can join directly via a shared URL.
- **Dynamic File Management:** Senders can add or delete files/folders, and the receiver's list updates in real-time.
- **Single File Downloads:** Efficient streaming downloads for individual files via a Service Worker.
- **"Download All" as ZIP:** Download all shared files or specific folders as a single ZIP archive, created in the browser.
- **Progress Indicators:** View progress, speed, and ETA for "Download All" and folder downloads.
- **Progressive Web App (PWA):** Installable on desktop and mobile for an app-like experience and offline access to the app shell.
- **Screen Wake Lock:** Actively works to prevent your device's screen from sleeping during transfers.
- **Secure:** Transfers are encrypted using DTLS (standard with WebRTC).

## Local Development Setup

Want to run InfinityShare locally or contribute? Here’s how:

**Prerequisites:**
*   Node.js (v16 or later recommended)
*   npm (usually comes with Node.js) or yarn

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Shanmus4/infinityshare.git
    cd infinityshare
    ```

2.  **Install Root Dependencies (Optional - if any for monorepo tools):**
    ```bash
    npm install 
    ```
    *(Currently, the root `package.json` might only contain scripts for running client/server concurrently, actual dependencies are within sub-projects).*

3.  **Install Client Dependencies:**
    ```bash
    cd client
    npm install
    ```

4.  **Install Signaling Server Dependencies:**
    ```bash
    cd ../signaling-server 
    npm install
    ```

5.  **Environment Variables:**
    *   **Signaling Server (`signaling-server/.env` - create this file):**
        *   `PORT`: Port for the signaling server (defaults to 3000 if not set). E.g., `PORT=3000`
        *   `ALLOWED_ORIGINS`: Comma-separated list of URLs allowed to connect (for CORS). For local development, this should include your client's URL. E.g., `ALLOWED_ORIGINS=http://localhost:3001`
        *   `SSL_CERT_PATH` (Optional): Path to SSL certificate if running HTTPS locally.
        *   `SSL_KEY_PATH` (Optional): Path to SSL private key if running HTTPS locally.
    *   **Client (`client/.env` - create this file):**
        *   `REACT_APP_SIGNALING_SERVER_URL`: The URL of your signaling server. For local development:
            *   If signaling server is HTTP on port 3000: `REACT_APP_SIGNALING_SERVER_URL=ws://localhost:3000`
            *   If signaling server is HTTPS on port 3000: `REACT_APP_SIGNALING_SERVER_URL=wss://localhost:3000`

6.  **Running the Application:**

    *   **Start the Signaling Server:**
        ```bash
        cd signaling-server
        npm start 
        ```
        (This typically runs `node index.js`. Keep this terminal running.)

    *   **Start the React Client (in a new terminal):**
        ```bash
        cd client
        npm start
        ```
        This will usually open the app in your browser at `http://localhost:3001`.

## Project Architecture

InfinityShare consists of two main components:

1.  **React Frontend (`/client`):**
    *   The user interface built with React.
    *   Handles file selection, WebRTC connection setup, data channel management for file transfer, and all client-side logic (zipping, saving, PWA registration, NoSleep.js).
    *   Communicates with the signaling server to exchange connection details with the peer.
    *   Deployed on Netlify: [https://infinityshare.netlify.app/](https://infinityshare.netlify.app/)

2.  **Signaling Server (`/signaling-server`):**
    *   A lightweight Node.js server using `socket.io`.
    *   Its sole purpose is to help peers discover each other and exchange WebRTC signaling messages (like offers, answers, and ICE candidates).
    *   **It does not handle or store any file data.** All file transfers are direct P2P.
    *   Deployed on Render: `wss://infinityshare-signalserver.onrender.com`

**How it Works (WebRTC):**
*   When a sender uploads files, they connect to the signaling server and create a "room" identified by the Drive Code.
*   When a receiver joins using the Drive Code, they also connect to the signaling server and join the same room.
*   The signaling server then relays messages (SDP offers/answers, ICE candidates) between the sender and receiver. These messages allow their browsers to establish a direct WebRTC `PeerConnection`.
*   Once the `PeerConnection` is established, files are transferred directly between the two browsers using `RTCDataChannel`s, which are encrypted by default (DTLS).
*   If a direct P2P connection cannot be established (e.g., due to restrictive firewalls), WebRTC can attempt to use STUN/TURN servers as fallbacks. InfinityShare is configured with public STUN servers.

*(A visual diagram could be added here in the future to illustrate the signaling and P2P flow.)*

## File Structure Overview

-   **`/` (Root)**
    -   `package.json`: Scripts for managing the monorepo (e.g., concurrently running client and server).
    -   `PLANNING.md`: Detailed project architecture, conventions, and planning notes.
    -   `TASK.md`: Tracks active and completed development tasks.
    -   `README.md`: This file.
    -   `LICENSE`: MIT License.
-   **`/client`**: The React frontend application.
    -   `package.json`: Frontend dependencies and scripts.
    -   `/public`: Static assets, `index.html`, `manifest.json` (PWA), `service-worker.js`.
    -   `/src`: React application source code.
        -   `App.js`: The main application component, managing state and core logic.
        -   `/components`: Reusable UI components (e.g., `FileList.js`, `DropzoneArea.js`).
        -   `/hooks`: Custom React hooks for encapsulated logic (e.g., `useWebRTC.js`, `useZipDownload.js`, `useNoSleep.js`, `useSocket.js`).
        -   `/utils`: Utility functions and constants (e.g., `fileHelpers.js`, `signaling.js`).
        -   `index.js`: Entry point for the React app, registers service worker.
        -   `serviceWorkerRegistration.js`: Handles PWA service worker lifecycle.
-   **`/signaling-server`**: The Node.js + Socket.io signaling server.
    -   `package.json`: Server dependencies and start script.
    -   `index.js`: Main server logic for handling socket connections and relaying WebRTC signals.
-   **`/tests`**: Planned location for tests (currently empty).

## Contributing

Contributions are welcome! Please refer to `PLANNING.md` for architectural guidelines and `TASK.md` for ongoing tasks. Key areas for improvement include:
*   Implementing unit and end-to-end tests.
*   Refactoring `client/src/App.js` into smaller, more manageable components/hooks.
*   Enhancing UI/UX and responsiveness.
*   Improving error handling and resilience.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
