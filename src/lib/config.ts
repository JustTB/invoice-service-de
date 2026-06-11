import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  INVOICE_SERVICE_SECRET: z.string().min(32),

  SELLER_NAME: z.string().min(1),
  SELLER_ADDRESS_STREET: z.string().min(1),
  SELLER_ADDRESS_CITY: z.string().min(1),
  SELLER_ADDRESS_ZIP: z.string().min(1),
  SELLER_STEUERNUMMER: z.string().optional(),
  SELLER_VAT_ID: z.string().optional(),
  SELLER_LOGO_PATH: z.string().optional(),

  DATABASE_URL: z.string().url(),

  STORAGE_TYPE: z.enum(['local', 's3']).default('local'),
  STORAGE_PATH: z.string().default('./invoices'),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['resend', 'postmark', 'smtp']).default('resend'),
  EMAIL_FROM: z.string().email(),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
}).refine(
  (c) => c.SELLER_STEUERNUMMER || c.SELLER_VAT_ID,
  { message: 'Either SELLER_STEUERNUMMER or SELLER_VAT_ID must be set' },
);

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = ConfigSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid configuration:', result.error.format());
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}
