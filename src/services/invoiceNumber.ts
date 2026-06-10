import { prisma } from '../lib/db';

export async function assignInvoiceNumber(year: number): Promise<string> {
  const counter = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceCounter.findUnique({
      where: { year },
    });

    if (existing) {
      return tx.invoiceCounter.update({
        where: { year },
        data: { counter: { increment: 1 } },
      });
    }

    return tx.invoiceCounter.create({
      data: { year, counter: 1 },
    });
  });

  const padded = String(counter.counter).padStart(4, '0');
  return `RE-${year}-${padded}`;
}
