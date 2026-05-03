import { Kafka, Producer } from "kafkajs";

const kafka = new Kafka({
  clientId: "live-location-server",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
});

let producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
    console.log("Kafka producer connected");
  }
  return producer;
}

export async function publishLocation(payload: {
  userId: string;
  email: string;
  lat: number;
  lng: number;
  timestamp: number;
}): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic: "location-updates",
    messages: [
      {
        key: payload.userId,
        value: JSON.stringify(payload),
      },
    ],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
