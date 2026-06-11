import 'dotenv/config';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { getConfig } from './lib/config';
import { healthRoutes } from './routes/health';
import { invoiceRoutes } from './routes/invoices';

const fastify = Fastify({ logger: true });

async function main(): Promise<void> {
  const config = getConfig();

  await fastify.register(helmet);
  await fastify.register(cors, { origin: false });
  await fastify.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
  });

  await fastify.register(healthRoutes);
  await fastify.register(invoiceRoutes);

  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
