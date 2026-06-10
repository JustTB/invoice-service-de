import { z } from 'zod';

export const CustomerAddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().length(2),
});

export const CustomerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  address: CustomerAddressSchema.optional(),
  vatId: z.string().optional(),
  type: z.enum(['b2c', 'b2b']).optional(),
});

export const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceNet: z.number().nonnegative(),
  vatRate: z.number().refine((v) => [0, 7, 19].includes(v), {
    message: 'vatRate must be 0, 7, or 19',
  }),
});

export const CreateInvoiceRequestSchema = z.object({
  paymentId: z.string().min(1),
  paymentProvider: z.enum(['stripe', 'mollie']),
  paidAt: z.string().datetime(),
  customer: CustomerSchema,
  lineItems: z.array(LineItemSchema).min(1),
  currency: z.literal('EUR'),
  amountGross: z.number().positive(),
});

export type CustomerAddress = z.infer<typeof CustomerAddressSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

export interface InvoiceResponse {
  invoiceNumber: string;
  invoiceId: string;
}

export interface DuplicateInvoiceResponse extends InvoiceResponse {
  duplicate: true;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceId: string;
  issuedAt: Date;
  leistungsdatum: Date;
  customer: Customer;
  lineItems: LineItem[];
  currency: string;
  amountGross: number;
  isB2B: boolean;
  reverseCharge: boolean;
}
