import { server } from "./server.js";
import { pool } from "./db.js";

async function start() {
  const PORT = Number(process.env.PORT || 3000);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    throw new Error("DATABASE_URL or PostgreSQL connection variables are required");
  }
  await pool.query("SELECT 1 FROM plans LIMIT 1");
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

let closing = false;
function stop() {
  if (closing) {
    return;
  }
  closing = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(async () => {
    await pool.end();
    clearTimeout(timer);
  });
}

server.on("error", async (error) => {
  console.error(error.message);
  await pool.end();
  process.exitCode = 1;
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
start().catch(async (error) => {
  console.error("Startup failed:", error.message);
  await pool.end();
  process.exitCode = 1;
});
