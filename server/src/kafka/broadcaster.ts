import { Consumer, Kafka } from "kafkajs";
import { Server } from "socket.io";

const kafka = new Kafka({
  clientId: "live-location-broadcaster",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

let consumer: Consumer | null = null;

export async function startBroadcaster(io: Server): Promise<void> {
  consumer = kafka.consumer({ groupId: "socket-broadcaster" });
  await consumer.connect();
  await consumer.subscribe({ topic: "location-updates", fromBeginning: false });
   
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      try {
        const payload = JSON.parse(message.value.toString()) as {
          userId: string;
          email: string;
          lat: number;
          lng: number;
          timestamp: number;
        };

        if (
          typeof payload.userId !== "string" ||
          typeof payload.lat !== "number" ||
          typeof payload.lng !== "number"
        ) {
          console.warn("Broadcaster: invalid payload shape, skipping");
          return;
        }

        io.emit("location:update", payload);
      } catch (err) {
        console.error("Broadcaster: failed to parse message", err);
      }
    },
  });

  console.log("Kafka broadcaster consumer started");
}

export async function disconnectBroadcaster(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
}
