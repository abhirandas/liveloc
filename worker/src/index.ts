import "dotenv/config";
import { Kafka } from "kafkajs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgTable, uuid, doublePrecision, timestamp, text } from "drizzle-orm/pg-core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Inline schema to avoid sharing source across packages
const locationHistory = pgTable("location_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

interface LocationEvent {
  userId: string;
  email: string;
  lat: number;
  lng: number;
  timestamp: number;
}

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "10", 10);
const BATCH_FLUSH_MS = parseInt(process.env.BATCH_FLUSH_MS || "5000", 10);

let batch: LocationEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushBatch(): Promise<void> {
  if (batch.length === 0) return;

  const toInsert = batch.splice(0, batch.length);

  try {
    await db.insert(locationHistory).values(
      toInsert.map((e) => ({
        userId: e.userId,
        lat: e.lat,
        lng: e.lng,
      }))
    );
    console.log(`DB writer: inserted ${toInsert.length} location records`);
  } catch (err) {
    console.error("DB writer: batch insert failed:", err);
    // Re-queue failed events back to batch for retry on next flush
    batch.unshift(...toInsert);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushBatch();
  }, BATCH_FLUSH_MS);
}

async function main(): Promise<void> {
  const kafka = new Kafka({
    clientId: "live-location-db-writer",
    brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
  });

  const consumer = kafka.consumer({ groupId: "db-writer" });
  await consumer.connect();
  await consumer.subscribe({ topic: "location-updates", fromBeginning: false });

  console.log("DB writer consumer started");

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      try {
        const event = JSON.parse(message.value.toString()) as LocationEvent;

        if (
          typeof event.userId !== "string" ||
          typeof event.lat !== "number" ||
          typeof event.lng !== "number"
        ) {
          console.warn("DB writer: invalid event shape, skipping");
          return;
        }

        batch.push(event);

        if (batch.length >= BATCH_SIZE) {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          await flushBatch();
        } else {
          scheduleFlush();
        }
      } catch (err) {
        console.error("DB writer: failed to parse message:", err);
      }
    },
  });

  const shutdown = async () => {
    console.log("DB writer shutting down...");
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    await flushBatch();
    await consumer.disconnect();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
