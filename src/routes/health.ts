import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.status(200).send({ status: 'ok', db: 'connected' });
    } catch {
      return reply.status(503).send({ status: 'error', db: 'disconnected' });
    }
  });
}
