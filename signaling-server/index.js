const http = require('http');
const { Server } = require('socket.io');

// Determine allowed origins based on environment variable
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
// Default to localhost:3001 for development if not set
const defaultDevOrigin = 'http://localhost:3001';
const allowedOrigins = allowedOriginsEnv ? allowedOriginsEnv.split(',') : [defaultDevOrigin];

console.log('Allowed CORS Origins:', allowedOrigins); // Log allowed origins for debugging

const server = http.createServer(); // Create HTTP server
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST"] // Specify allowed methods if needed
  }
});

io.on('connection', socket => {
  console.log('New client connected:', socket.id);
  socket.on('create-room', room => {
    // Validation: Ensure room is a non-empty string
    if (typeof room !== 'string' || room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'create-room' event: Room must be a non-empty string. Received:`, room);
      return; // Stop processing if invalid
    }
    console.log(`[${socket.id}] create-room:`, room);
    socket.join(room);
  });
  socket.on('join-room', room => {
    // Validation: Ensure room is a non-empty string
    if (typeof room !== 'string' || room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'join-room' event: Room must be a non-empty string. Received:`, room);
      return; // Stop processing if invalid
    }
    console.log(`[${socket.id}] join-room:`, room);
    socket.join(room);
    socket.to(room).emit('joined-room', socket.id);
  });
  socket.on('file-list', data => {
    // Validation: Ensure data is an object with a non-empty room string
    if (typeof data !== 'object' || data === null || typeof data.room !== 'string' || data.room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'file-list' event: Data must be an object with a non-empty 'room' string. Received:`, data);
      return; // Stop processing if invalid
    }
    console.log(`[${socket.id}] file-list to room:`, data.room);
    socket.to(data.room).emit('file-list', data);
  });
  // --- Handle get-file-list from receiver ---
  socket.on('get-file-list', data => {
    // Validation: Ensure data is an object with a non-empty room string
    if (typeof data !== 'object' || data === null || typeof data.room !== 'string' || data.room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'get-file-list' event: Data must be an object with a non-empty 'room' string. Received:`, data);
      return; // Stop processing if invalid
    }
    console.log(`[${socket.id}] get-file-list for room:`, data.room);
    // Relay request to all clients in room (sender will respond)
    socket.to(data.room).emit('get-file-list', data);
  });
  socket.on('download-file', data => {
    // Validation: Ensure data is an object with a non-empty room string
    if (typeof data !== 'object' || data === null || typeof data.room !== 'string' || data.room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'download-file' event: Data must be an object with a non-empty 'room' string. Received:`, data);
      return; // Stop processing if invalid
    }
    console.log(`[${socket.id}] download-file to room:`, data.room);
    socket.to(data.room).emit('download-file', data);
  });
  socket.on('signal', data => {
    // Validation: Ensure data is an object with a non-empty room string
    if (typeof data !== 'object' || data === null || typeof data.room !== 'string' || data.room.trim() === '') {
      console.error(`[${socket.id}] Invalid 'signal' event: Data must be an object with a non-empty 'room' string. Received:`, data);
      return; // Stop processing if invalid
    }
    // Note: We don't validate the 'signal' content itself here, as it's complex WebRTC data.
    // The receiving client is responsible for handling potentially malformed signal data.
    console.log(`[${socket.id}] signal to room:`, data.room);
    socket.to(data.room).emit('signal', data);
  });
  socket.on('disconnect', reason => {
    console.log('Client disconnected:', socket.id, 'reason:', reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, (err) => {
  if (err) {
    console.error('Failed to start signaling server:', err);
  } else {
    console.log(`Signaling server listening on port ${PORT}`);
  }
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
