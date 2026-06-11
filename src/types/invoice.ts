import { z } from 'zod';

// ISO 3166-1 alpha-2 — keeps invalid codes from reaching DB or invoice logic
const ISO_3166_1 = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
  'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
  'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
  'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
  'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
  'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
  'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
  'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
  'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
  'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
  'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
] as const;

export const CountryCodeSchema = z.enum(ISO_3166_1);

export const CustomerAddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  zip: z.string().min(1),
  country: CountryCodeSchema,
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
