import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { getConfig } from '../lib/config';

interface EmailOptions {
  to: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  customerCountry?: string;
}

export async function sendInvoiceEmail(opts: EmailOptions): Promise<void> {
  const config = getConfig();
  const isGerman = !opts.customerCountry || opts.customerCountry === 'DE';
  const subject = isGerman
    ? `Ihre Rechnung ${opts.invoiceNumber}`
    : `Your Invoice ${opts.invoiceNumber}`;
  const body = isGerman
    ? `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie Ihre Rechnung ${opts.invoiceNumber}.\n\nMit freundlichen Grüßen\n${config.SELLER_NAME}`
    : `Dear Customer,\n\nPlease find your invoice ${opts.invoiceNumber} attached.\n\nBest regards\n${config.SELLER_NAME}`;

  const attachment = {
    filename: `${opts.invoiceNumber}.pdf`,
    content: opts.pdfBuffer,
    contentType: 'application/pdf',
  };

  if (config.EMAIL_PROVIDER === 'resend') {
    await sendResend({ to: opts.to, subject, body, attachment, config });
  } else if (config.EMAIL_PROVIDER === 'postmark') {
    await sendPostmark({ to: opts.to, subject, body, attachment, config });
  } else {
    await sendSmtp({ to: opts.to, subject, body, attachment, config });
  }
}

async function sendResend(opts: {
  to: string;
  subject: string;
  body: string;
  attachment: { filename: string; content: Buffer; contentType: string };
  config: ReturnType<typeof getConfig>;
}): Promise<void> {
  const resend = new Resend(opts.config.RESEND_API_KEY!);
  const { error } = await resend.emails.send({
    from: opts.config.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: [{
      filename: opts.attachment.filename,
      content: opts.attachment.content,
    }],
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

async function sendPostmark(opts: {
  to: string;
  subject: string;
  body: string;
  attachment: { filename: string; content: Buffer; contentType: string };
  config: ReturnType<typeof getConfig>;
}): Promise<void> {
  const { ServerClient } = await import('postmark');
  const client = new ServerClient(opts.config.POSTMARK_API_KEY!);
  await client.sendEmail({
    From: opts.config.EMAIL_FROM,
    To: opts.to,
    Subject: opts.subject,
    TextBody: opts.body,
    Attachments: [{
      Name: opts.attachment.filename,
      Content: opts.attachment.content.toString('base64'),
      ContentType: opts.attachment.contentType,
      ContentID: '',
    }],
  });
}

async function sendSmtp(opts: {
  to: string;
  subject: string;
  body: string;
  attachment: { filename: string; content: Buffer; contentType: string };
  config: ReturnType<typeof getConfig>;
}): Promise<void> {
  const port = opts.config.SMTP_PORT ?? 587;
  const transporter = nodemailer.createTransport({
    host: opts.config.SMTP_HOST!,
    port,
    secure: port === 465,
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    auth: opts.config.SMTP_USER && opts.config.SMTP_PASS
      ? { user: opts.config.SMTP_USER, pass: opts.config.SMTP_PASS }
      : undefined,
  });

  await transporter.sendMail({
    from: opts.config.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: [{
      filename: opts.attachment.filename,
      content: opts.attachment.content,
      contentType: opts.attachment.contentType,
    }],
  });
}
