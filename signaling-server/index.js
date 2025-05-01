const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(); // Create HTTP server
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', socket => {
  console.log('New client connected:', socket.id);
  socket.on('create-room', room => {
    console.log(`[${socket.id}] create-room:`, room);
    socket.join(room);
  });
  socket.on('join-room', room => {
    console.log(`[${socket.id}] join-room:`, room);
    socket.join(room);
    socket.to(room).emit('joined-room', socket.id);
  });
  socket.on('file-list', data => {
    console.log(`[${socket.id}] file-list to room:`, data.room);
    socket.to(data.room).emit('file-list', data);
  });
  // --- Handle get-file-list from receiver ---
  socket.on('get-file-list', data => {
    console.log(`[${socket.id}] get-file-list for room:`, data.room);
    // Relay request to all clients in room (sender will respond)
    socket.to(data.room).emit('get-file-list', data);
  });
  socket.on('download-file', data => {
    console.log(`[${socket.id}] download-file to room:`, data.room);
    socket.to(data.room).emit('download-file', data);
  });
  socket.on('signal', data => {
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
