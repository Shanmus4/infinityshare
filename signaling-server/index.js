require("dotenv").config(); // Load environment variables from .env file at the very top

const http = require("http");
const https = require("https");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const twilio = require("twilio");

const app = express();

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Ensure Twilio credentials are provided
if (!accountSid || !authToken) {
  console.error(
    "Twilio Account SID or Auth Token is missing. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables."
  );
  // process.exit(1); // Optionally exit if credentials are vital
}

// Determine allowed origins for CORS based on environment variable
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
const defaultDevOrigin = "http://localhost:3001"; // Default for client development
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv.split(",")
  : [defaultDevOrigin];

console.log("Allowed CORS Origins for Socket.IO:", allowedOrigins);

// --- Server Setup (HTTP or HTTPS) ---
let server;
const sslCertPath = process.env.SSL_CERT_PATH;
const sslKeyPath = process.env.SSL_KEY_PATH;

if (
  sslCertPath &&
  sslKeyPath &&
  fs.existsSync(sslCertPath) &&
  fs.existsSync(sslKeyPath)
) {
  try {
    const options = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
    server = https.createServer(options, app); // Use Express app with HTTPS
    console.log("SSL certificate and key found. Starting HTTPS server.");
  } catch (err) {
    console.error(
      `Error reading SSL certificate/key files. Paths: ${sslCertPath}, ${sslKeyPath}`
    );
    console.error(
      "Falling back to HTTP. Ensure paths are correct and files are readable.",
      err
    );
    server = http.createServer(app); // Fallback to HTTP with Express app
  }
} else {
  if (sslCertPath || sslKeyPath) {
    console.warn(
      "SSL_CERT_PATH or SSL_KEY_PATH provided but files not found. Starting HTTP server."
    );
  } else {
    console.log(
      "SSL certificate/key paths not provided. Starting HTTP server."
    );
  }
  server = http.createServer(app); // Create HTTP server with Express app
}

// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (origin.startsWith("capacitor://") &&
          allowedOrigins.includes("capacitor://localhost"))
      ) {
        // Allow capacitor local
        callback(null, true);
      } else {
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        console.warn(msg);
        callback(new Error(msg), false);
      }
    },
    methods: ["GET", "POST"],
  },
});

// --- API Endpoint for TURN Credentials ---
app.get("/api/ice-servers", async (req, res) => {
  // CORS for this specific API endpoint (can be different from Socket.IO CORS)
  const requestOrigin = req.headers.origin;
  if (
    requestOrigin &&
    (allowedOrigins.includes(requestOrigin) ||
      (requestOrigin.startsWith("capacitor://") &&
        allowedOrigins.includes("capacitor://localhost")))
  ) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  } else if (!requestOrigin && req.headers.host.startsWith("localhost")) {
    // Allow if no origin but localhost (e.g. server-side test)
    // No CORS header needed for same-origin or no-origin from localhost
  } else if (requestOrigin) {
    console.warn(
      `[API CORS] Denied origin for /api/ice-servers: ${requestOrigin}`
    );
    return res.status(403).json({ error: "Origin not allowed" });
  }

  if (!accountSid || !authToken) {
    console.error(
      "/api/ice-servers: Twilio credentials not configured on server."
    );
    return res
      .status(500)
      .json({ error: "TURN server configuration error on backend." });
  }

  try {
    const client = twilio(accountSid, authToken);
    const token = await client.tokens.create({ ttl: 3600 }); // TTL 1 hour
    // token.iceServers will include an array of STUN and TURN servers with temporary credentials
    console.log(
      "[API] Successfully fetched temporary ICE servers from Twilio."
    );
    res.json({ iceServers: token.iceServers });
  } catch (error) {
    console.error(
      "[API] Error fetching Twilio TURN credentials:",
      error.message
    );
    res
      .status(500)
      .json({ error: "Failed to get TURN credentials from Twilio." });
  }
});

// --- Socket.IO Connection Handling (existing logic) ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("create-room", (room) => {
    if (typeof room !== "string" || room.trim() === "") {
      console.error(`[${socket.id}] Invalid 'create-room' event. Room:`, room);
      return;
    }
    console.log(`[${socket.id}] create-room:`, room);
    socket.join(room);
  });

  socket.on("join-room", (room) => {
    if (typeof room !== "string" || room.trim() === "") {
      console.error(`[${socket.id}] Invalid 'join-room' event. Room:`, room);
      return;
    }
    console.log(`[${socket.id}] join-room:`, room);
    socket.join(room);
    socket.to(room).emit("joined-room", socket.id);
  });

  socket.on("file-list", (data) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.room !== "string" ||
      data.room.trim() === ""
    ) {
      console.error(`[${socket.id}] Invalid 'file-list' event. Data:`, data);
      return;
    }
    console.log(`[${socket.id}] file-list to room:`, data.room);
    socket.to(data.room).emit("file-list", data);
  });

  socket.on("get-file-list", (data) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.room !== "string" ||
      data.room.trim() === ""
    ) {
      console.error(
        `[${socket.id}] Invalid 'get-file-list' event. Data:`,
        data
      );
      return;
    }
    console.log(`[${socket.id}] get-file-list for room:`, data.room);
    socket.to(data.room).emit("get-file-list", data);
  });

  socket.on("download-file", (data) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.room !== "string" ||
      data.room.trim() === ""
    ) {
      console.error(
        `[${socket.id}] Invalid 'download-file' event. Data:`,
        data
      );
      return;
    }
    const { room, fileId, transferFileId, name, isZipRequest } = data;
    console.log(
      `[${
        socket.id
      }] download-file request for room: ${room}, originalFileId: ${fileId}, transferFileId: ${transferFileId}, name: ${name}, isZip: ${!!isZipRequest}`
    );
    socket.to(room).emit("download-file", data);
  });

  socket.on("heartbeat-zip", (data) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.room !== "string" ||
      data.room.trim() === "" ||
      typeof data.pcId !== "string" ||
      data.pcId.trim() === ""
    ) {
      console.warn(`[${socket.id}] Invalid 'heartbeat-zip' event. Data:`, data);
      return;
    }
    // console.log(`[${socket.id}] heartbeat-zip from ${data.pcId} for room ${data.room}`);
    // Relay to sender in the room (sender will check if pcId is active for them)
    socket
      .to(data.room)
      .emit("heartbeat-zip", { pcId: data.pcId, room: data.room });
  });

  socket.on("signal", (data) => {
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.room !== "string" ||
      data.room.trim() === ""
    ) {
      console.error(`[${socket.id}] Invalid 'signal' event. Data:`, data);
      return;
    }
    const {
      room: signalRoom,
      fileId: signalFileId,
      data: signalDataContent,
    } = data;
    const signalType = signalDataContent?.candidate
      ? "candidate"
      : signalDataContent?.sdp?.type || "unknown";
    // console.log(`[${socket.id}] signal for room: ${signalRoom}, transferFileId: ${signalFileId}, type: ${signalType}`);
    socket.to(signalRoom).emit("signal", data);
  });

  socket.on("disconnect", (reason) => {
    console.log("Client disconnected:", socket.id, "reason:", reason);
  });
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, (err) => {
  if (err) {
    console.error("Failed to start signaling server:", err);
  } else {
    const protocol = sslCertPath && sslKeyPath ? "HTTPS" : "HTTP";
    console.log(
      `Signaling server (${protocol}) with API for TURN credentials listening on port ${PORT}`
    );
  }
});

server.on("error", (err) => {
  console.error("Server error:", err);
});
