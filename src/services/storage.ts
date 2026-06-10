import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../lib/config';

export async function storePdf(invoiceId: string, pdfBuffer: Buffer): Promise<string> {
  const config = getConfig();

  if (config.STORAGE_TYPE === 's3') {
    return storeS3(invoiceId, pdfBuffer, config);
  }
  return storeLocal(invoiceId, pdfBuffer, config);
}

export async function getPdfUrl(pdfPath: string): Promise<string> {
  const config = getConfig();

  if (config.STORAGE_TYPE === 's3') {
    const client = buildS3Client(config);
    const cmd = new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: pdfPath });
    return getSignedUrl(client, cmd, { expiresIn: 3600 });
  }

  return `file://${pdfPath}`;
}

export async function getPdfBuffer(pdfPath: string): Promise<Buffer> {
  const config = getConfig();

  if (config.STORAGE_TYPE === 's3') {
    const client = buildS3Client(config);
    const cmd = new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: pdfPath });
    const res = await client.send(cmd);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  return fs.promises.readFile(pdfPath);
}

async function storeLocal(
  invoiceId: string,
  pdfBuffer: Buffer,
  config: ReturnType<typeof getConfig>,
): Promise<string> {
  await fs.promises.mkdir(config.STORAGE_PATH, { recursive: true });
  const filePath = path.join(config.STORAGE_PATH, `${invoiceId}.pdf`);
  await fs.promises.writeFile(filePath, pdfBuffer);
  return filePath;
}

async function storeS3(
  invoiceId: string,
  pdfBuffer: Buffer,
  config: ReturnType<typeof getConfig>,
): Promise<string> {
  const key = `invoices/${invoiceId}.pdf`;
  const client = buildS3Client(config);
  await client.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET!,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  }));
  return key;
}

function buildS3Client(config: ReturnType<typeof getConfig>): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY!,
      secretAccessKey: config.S3_SECRET_KEY!,
    },
    forcePathStyle: !!config.S3_ENDPOINT,
  });
}
