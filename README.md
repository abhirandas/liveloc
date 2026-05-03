# Live Location Tracker

Real-time location sharing system built with Express.js, Socket.IO, Kafka, PostgreSQL, and Leaflet maps.



## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Express 5 + TypeScript |
| Real-time | Socket.IO 4 |
| Message broker | Apache Kafka (KafkaJS) |
| Database | PostgreSQL + Drizzle ORM |
| Frontend | Vanilla HTML/CSS/JS + Leaflet |
| Auth | JWT (localStorage) |
| Infrastructure | Docker Compose |

## Project Structure

```
live-location/
├── docker-compose.yml     # PostgreSQL (5435) + Kafka (KRaft, no Zookeeper)
├── server/                # Express + Socket.IO + Kafka producer + broadcaster consumer
│   ├── src/
│   │   ├── index.ts
│   │   ├── db/            # Drizzle schema + client + migrate
│   │   ├── routes/auth.ts # POST /api/auth/register, POST /api/auth/login
│   │   ├── middleware/    # JWT verification
│   │   ├── kafka/         # producer.ts + broadcaster.ts (socket-broadcaster group)
│   │   └── socket/        # Socket.IO setup + TTL stale-user cleanup
│   └── drizzle.config.ts
├── worker/                # Separate Node process — db-writer Kafka consumer
│   └── src/index.ts
└── client/
    ├── login.html
    ├── map.html
    ├── css/style.css
    └── js/                # login.js + map.js
```

## Setup

### Prerequisites

- Docker + Docker Compose
- Node.js 20+
- pnpm (`npm install -g pnpm`)

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port **5435**
- Kafka (KRaft mode) on port **9092** — no Zookeeper needed

### 2. Install & configure server

```bash
cd server
pnpm install
cp .env.example .env   # edit JWT_SECRET
```

### 3. Run database migrations

```bash
cd server
pnpm db:generate       # generates SQL from schema
pnpm db:migrate        # applies migrations to Postgres
```

### 4. Start the server

```bash
cd server
pnpm dev
```

Server runs on `http://localhost:3000`

### 5. Install & start the worker

```bash
cd worker
pnpm install
cp .env.example .env
pnpm dev
```

### 6. Open the frontend

Open `client/login.html` directly in your browser (or serve with `npx serve client`).

## Environment Variables

### server/.env

| Variable | Description |
|---|---|
| `PORT` | HTTP server port (default 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `KAFKA_BROKER` | Kafka broker address |

### worker/.env

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KAFKA_BROKER` | Kafka broker address |
| `BATCH_SIZE` | Number of events before forced flush (default 10) |
| `BATCH_FLUSH_MS` | Max ms before batch is flushed even if not full (default 5000) |

## Auth Flow

1. User registers or logs in via `POST /api/auth/register` or `/api/auth/login`
2. Server returns a JWT signed with `JWT_SECRET`
3. Client stores JWT in `localStorage`
4. Socket.IO connection sends `auth: { token }` on handshake
5. Server middleware verifies token — rejects unauthenticated sockets
6. All socket events are tied to the `userId` extracted from the token

## Socket Event Flow

```
client  ──location:update { lat, lng }──▶  server
server  ──▶ validates JWT userId from socket
server  ──▶ publishLocation() → Kafka topic: location-updates (key = userId)
Kafka   ──▶ socket-broadcaster consumer → io.emit("location:update", payload)
client  ◀── location:update { userId, email, lat, lng, timestamp }

client  ──heartbeat──▶  server  (updates TTL, no Kafka publish)
server  setInterval(5s): evicts users with lastSeen > 10s
server  ──▶ io.emit("user:left", { userId })
```

## Kafka Event Flow

```
topic: location-updates
  key: userId (ensures per-user ordering within a partition)

consumer group: socket-broadcaster  (server/)
  → reads every event → io.emit to all connected clients

consumer group: db-writer  (worker/)
  → accumulates events in memory batch
  → flushes to location_history table when:
      (a) batch reaches BATCH_SIZE events, OR
      (b) BATCH_FLUSH_MS ms have passed
```

### Why Kafka instead of direct DB writes?

Every location update fires every 3 seconds per user. At 100 concurrent users that's ~33 writes/second. Direct DB writes on every socket event means:

- DB becomes the bottleneck for real-time throughput
- Socket handler blocks waiting for DB round-trip
- No replay capability if DB is temporarily down

Kafka decouples the write path. The socket handler just produces to Kafka (fast), and the `db-writer` consumer batches inserts independently. If the DB is slow or temporarily unavailable, Kafka holds the backlog and the consumer catches up without data loss.

### Consumer groups

Two independent consumer groups read from the same topic:

- `socket-broadcaster` — needs every event immediately to update the map
- `db-writer` — can lag, batches writes, optimizes DB I/O

Each group maintains its own offset. A failure in `db-writer` does not affect `socket-broadcaster`, and vice versa.

## Database Schema

```sql
users (
  id          uuid PRIMARY KEY,
  email       text UNIQUE NOT NULL,
  password    text NOT NULL,        -- bcrypt hash
  created_at  timestamp
)

location_history (
  id          uuid PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  lat         float8,
  lng         float8,
  recorded_at timestamp DEFAULT now()
)
```

## Assumptions & Limitations

- JWT stored in `localStorage` — acceptable for demo, not recommended for production (use httpOnly cookies)
- Single Kafka broker, single partition — sufficient for demo; production would use replication factor > 1
- Frontend served as static files — no bundler; works by opening HTML directly or via `npx serve`
- Geolocation accuracy depends on browser/device
- Stale user TTL is 10 seconds server-side; clients that close the tab without disconnecting cleanly are cleaned up by this mechanism
- Location history is append-only; no pruning or aggregation is implemented
