import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startDelegationScheduler } from "./lib/ai-delegation";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured before starting the API server.");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

let shuttingDown = false;
const stopDelegationScheduler = startDelegationScheduler();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) {
      process.exit(1);
    }
    shuttingDown = true;
    stopDelegationScheduler();
    logger.info({ signal }, "Graceful shutdown started");

    const forceExit = setTimeout(() => {
      logger.error({ signal }, "Graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      void pool.end().then(() => {
        clearTimeout(forceExit);
        if (error) {
          logger.error({ err: error, signal }, "HTTP server shutdown failed");
          process.exitCode = 1;
          return;
        }
        logger.info({ signal }, "Graceful shutdown completed");
      }).catch((poolError: unknown) => {
        clearTimeout(forceExit);
        logger.error({ err: poolError, signal }, "Database pool shutdown failed");
        process.exitCode = 1;
      });
    });
  });
}
