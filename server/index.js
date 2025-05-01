// File Transfer Web Application Backend (Express + Socket.io)
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// In-memory drive/session store
const DRIVES = {}; // { driveCode: { senderSocketId, expiresAt, filesMeta, ... } }
const SESSION_TIMEOUT_MS = 1000 * 60 * 10; // 10 minutes

function generateDriveCode() {
  return crypto.randomBytes(3).toString('hex'); // 6-char hex code
}

// Clean up expired drives every minute
setInterval(() => {
  const now = Date.now();
  for (const code in DRIVES) {
    if (DRIVES[code].expiresAt < now) {
      delete DRIVES[code];
    }
  }
}, 60000);

// Serve static frontend if built (optional, for deployment)
// app.use(express.static('../client/build'));

// --- WebSocket Signaling ---
io.on('connection', (socket) => {
  // Sender creates drive
  socket.on('create-drive', ({ filesMeta }, cb) => {
    const driveCode = generateDriveCode();
    DRIVES[driveCode] = {
      senderSocketId: socket.id,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS,
      filesMeta,
      receivers: []
    };
    socket.join(driveCode);
    cb({ driveCode });
  });

  // Receiver joins drive
  socket.on('join-drive', ({ driveCode }, cb) => {
    const drive = DRIVES[driveCode];
    if (!drive || drive.expiresAt < Date.now()) {
      cb({ error: 'Drive not found or expired.' });
      return;
    }
    drive.receivers.push(socket.id);
    socket.join(driveCode);
    cb({ filesMeta: drive.filesMeta });
    // Notify sender that a receiver joined
    io.to(drive.senderSocketId).emit('receiver-joined', { receiverId: socket.id });
  });

  // WebRTC signaling relay
  socket.on('signal', ({ driveCode, to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Sender/receiver disconnect
  socket.on('disconnect', () => {
    for (const code in DRIVES) {
      const drive = DRIVES[code];
      if (drive.senderSocketId === socket.id) {
        // Sender left: expire drive
        delete DRIVES[code];
      } else {
        // Remove receiver
        drive.receivers = drive.receivers.filter(id => id !== socket.id);
      }
    }
  });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
