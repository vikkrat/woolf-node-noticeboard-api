import { createApp } from './src/app.ts';
import { config } from './src/config.ts';
import prisma from './prisma/client.ts';

// Establish connectivity before accepting traffic; startup fails clearly if the DB is unavailable.
await prisma.$connect();
const server = createApp().listen(config.port, '127.0.0.1', () => {
  console.log(`NoticeBoard API: http://localhost:${config.port}\nInteractive documentation: http://localhost:${config.port}/api-docs`);
});

/** Finish in-flight requests and release the PostgreSQL pool on a normal shutdown. */
function shutdown() {
  server.close(async () => { await prisma.$disconnect(); process.exitCode = 0; });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
