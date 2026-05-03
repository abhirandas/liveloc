import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import { Server } from "socket.io";
import authRoutes from "./routes/auth";
import { setupSocket } from "./socket/index";
import { startBroadcaster, disconnectBroadcaster } from "./kafka/broadcaster";
import { disconnectProducer } from "./kafka/producer";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use(express.static(path.join(__dirname, "../../client")));

setupSocket(io);

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await startBroadcaster(io);
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

async function shutdown() {
  console.log("Shutting down...");
  await disconnectBroadcaster();
  await disconnectProducer();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
