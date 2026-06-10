import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { prisma } from '../lib/db';
import { generateInvoice } from '../services/invoiceGenerator';
import { assignInvoiceNumber } from '../services/invoiceNumber';
import { sendInvoiceEmail } from '../services/emailSender';
import { getPdfBuffer, getPdfUrl, storePdf } from '../services/storage';
import {
  CreateInvoiceRequestSchema,
  type CreateInvoiceRequest,
} from '../types/invoice';
import { getConfig } from '../lib/config';

export async function invoiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/invoices', handleCreateInvoice);
  fastify.get('/invoices/:invoiceId', handleGetInvoice);
}

async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const config = getConfig();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${config.INVOICE_SERVICE_SECRET}`) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

async function handleCreateInvoice(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  let body: CreateInvoiceRequest;
  try {
    body = CreateInvoiceRequestSchema.parse(req.body);
  } catch (err) {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: err.errors });
    }
    throw err;
  }

  // Validate gross against line items
  const computedGross = body.lineItems.reduce((sum, item) => {
    const net = Math.round(item.quantity * item.unitPriceNet * 100) / 100;
    const vat = Math.round(net * item.vatRate) / 100;
    return sum + Math.round((net + vat) * 100) / 100;
  }, 0);
  const grossDiff = Math.abs(Math.round(computedGross * 100) - Math.round(body.amountGross * 100));
  if (grossDiff > 2) {
    return reply.status(400).send({
      error: 'amountGross does not match line items',
      computed: computedGross,
      provided: body.amountGross,
    });
  }

  // Deduplication
  const existing = await prisma.invoice.findUnique({
    where: { paymentId: body.paymentId },
  });
  if (existing) {
    return reply.status(409).send({
      invoiceNumber: existing.invoiceNumber,
      invoiceId: existing.id,
      duplicate: true,
    });
  }

  const isB2B = body.customer.type === 'b2b' || !!body.customer.vatId;
  const addr = body.customer.address;
  const isEuBusiness = isB2B && !!body.customer.vatId &&
    addr && addr.country !== 'DE' && isEuCountry(addr.country);
  const reverseCharge = isEuBusiness;

  const now = new Date();
  const year = now.getFullYear();
  const invoiceNumber = await assignInvoiceNumber(year);
  const invoiceId = crypto.randomUUID();

  // Create DB record early (failed status) so number is never reused
  await prisma.invoice.create({
    data: {
      id: invoiceId,
      invoiceNumber,
      paymentId: body.paymentId,
      paymentProvider: body.paymentProvider,
      status: 'failed',
      customerEmail: body.customer.email,
      customerName: body.customer.name,
      amountGross: body.amountGross,
      currency: body.currency,
      issuedAt: now,
      leistungsdatum: new Date(body.paidAt),
      isB2B,
      vatId: body.customer.vatId,
      customerCountry: addr?.country,
    },
  });

  try {
    const { pdf } = await generateInvoice({
      invoiceNumber,
      invoiceId,
      issuedAt: now,
      leistungsdatum: new Date(body.paidAt),
      customer: body.customer,
      lineItems: body.lineItems,
      currency: body.currency,
      amountGross: body.amountGross,
      isB2B,
      reverseCharge: !!reverseCharge,
    });

    const pdfPath = await storePdf(invoiceId, pdf);

    let status: 'generated' | 'email_failed' = 'generated';
    try {
      await sendInvoiceEmail({
        to: body.customer.email,
        invoiceNumber,
        pdfBuffer: pdf,
        customerCountry: addr?.country,
      });
    } catch (emailErr) {
      req.log.error({ err: emailErr }, 'Failed to send invoice email');
      status = 'email_failed';
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status, pdfPath },
    });

    return reply.status(201).send({ invoiceNumber, invoiceId });
  } catch (err) {
    req.log.error({ err }, 'Invoice generation failed');
    return reply.status(500).send({ error: 'Invoice generation failed' });
  }
}

async function handleGetInvoice(
  req: FastifyRequest<{ Params: { invoiceId: string } }>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const { invoiceId } = req.params;
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice) {
    return reply.status(404).send({ error: 'Not found' });
  }

  let pdfUrl: string | null = null;
  if (invoice.pdfPath) {
    pdfUrl = await getPdfUrl(invoice.pdfPath);
  }

  return reply.send({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    customerEmail: invoice.customerEmail,
    customerName: invoice.customerName,
    amountGross: invoice.amountGross,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
    leistungsdatum: invoice.leistungsdatum,
    pdfUrl,
  });
}

// EU member state ISO codes (for reverse charge logic)
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU',
  'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

function isEuCountry(code: string): boolean {
  return EU_COUNTRIES.has(code.toUpperCase());
}
