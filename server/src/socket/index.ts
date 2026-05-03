import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { publishLocation } from "../kafka/producer";

interface AuthSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

interface JwtPayload {
  userId: string;
  email: string;
}

// userId -> last seen timestamp
const lastSeen = new Map<string, number>();
// userId -> { email, lat, lng }
const activeUsers = new Map<string, { email: string; lat: number; lng: number }>();

const STALE_THRESHOLD_MS = 10_000;
const CLEANUP_INTERVAL_MS = 5_000;

export function setupSocket(io: Server): void {
  // JWT auth middleware for socket connections
  io.use((socket: AuthSocket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      socket.userId = payload.userId;
      socket.userEmail = payload.email;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: AuthSocket) => {
    const userId = socket.userId!;
    const userEmail = socket.userEmail!;

    console.log(`User connected: ${userEmail} (${userId}) socket: ${socket.id}`);

    // Send current active users to the newly connected user
    const snapshot: Record<string, { email: string; lat: number; lng: number }> = {};
    activeUsers.forEach((data, uid) => {
      snapshot[uid] = data;
    });
    socket.emit("users:snapshot", snapshot);

    socket.on("location:update", async (data: unknown) => {
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as Record<string, unknown>).lat !== "number" ||
        typeof (data as Record<string, unknown>).lng !== "number"
      ) {
        socket.emit("error", { message: "Invalid location payload" });
        return;
      }

      const { lat, lng } = data as { lat: number; lng: number };

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        socket.emit("error", { message: "Coordinates out of range" });
        return;
      }

      lastSeen.set(userId, Date.now());
      activeUsers.set(userId, { email: userEmail, lat, lng });

      try {
        await publishLocation({ userId, email: userEmail, lat, lng, timestamp: Date.now() });
      } catch (err) {
        console.error("Failed to publish to Kafka:", err);
      }
    });

    socket.on("heartbeat", () => {
      lastSeen.set(userId, Date.now());
    });

    socket.on("disconnect", (reason) => {
      console.log(`User disconnected: ${userEmail} — reason: ${reason}`);
      lastSeen.delete(userId);
      activeUsers.delete(userId);
      io.emit("user:left", { userId });
    });
  });

  // Stale user cleanup
  setInterval(() => {
    const now = Date.now();
    lastSeen.forEach((ts, userId) => {
      if (now - ts > STALE_THRESHOLD_MS) {
        console.log(`Removing stale user: ${userId}`);
        lastSeen.delete(userId);
        activeUsers.delete(userId);
        io.emit("user:left", { userId });
      }
    });
  }, CLEANUP_INTERVAL_MS);
}
