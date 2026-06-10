import { InvoiceService as EInvoiceService } from '@e-invoice-eu/core';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { getConfig } from '../lib/config';
import type { InvoiceData, LineItem } from '../types/invoice';

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const MARGIN = 60;

export interface GeneratedInvoice {
  pdf: Buffer;
  isZugferd: boolean;
}

export async function generateInvoice(data: InvoiceData): Promise<GeneratedInvoice> {
  const basePdf = await generateBasePdf(data);

  if (data.isB2B) {
    const zugferdPdf = await embedZugferd(basePdf, data);
    return { pdf: zugferdPdf, isZugferd: true };
  }

  return { pdf: basePdf, isZugferd: false };
}

async function generateBasePdf(data: InvoiceData): Promise<Buffer> {
  const config = getConfig();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: {
      Title: `Rechnung ${data.invoiceNumber}`,
      Author: config.SELLER_NAME,
    }});

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderPdf(doc, data, config);
    doc.end();
  });
}

function renderPdf(
  doc: PDFKit.PDFDocument,
  data: InvoiceData,
  config: ReturnType<typeof getConfig>,
): void {
  const pageWidth = doc.page.width - MARGIN * 2;

  // Logo
  if (config.SELLER_LOGO_PATH && fs.existsSync(config.SELLER_LOGO_PATH)) {
    doc.image(config.SELLER_LOGO_PATH, MARGIN, MARGIN, { height: 50 });
    doc.moveDown(3);
  }

  // Seller info (top right)
  const sellerLines = [
    config.SELLER_NAME,
    config.SELLER_ADDRESS_STREET,
    `${config.SELLER_ADDRESS_ZIP} ${config.SELLER_ADDRESS_CITY}`,
    ...(config.SELLER_VAT_ID ? [`USt-IdNr.: ${config.SELLER_VAT_ID}`] : []),
    ...(config.SELLER_STEUERNUMMER ? [`St.-Nr.: ${config.SELLER_STEUERNUMMER}`] : []),
  ];

  const sellerTextHeight = sellerLines.length * 14;
  const sellerStartY = MARGIN;
  sellerLines.forEach((line, i) => {
    doc.font(i === 0 ? FONT_BOLD : FONT_REGULAR)
       .fontSize(9)
       .text(line, MARGIN + pageWidth - 200, sellerStartY + i * 14, { width: 200, align: 'right' });
  });

  // Customer address block
  const addressY = MARGIN + sellerTextHeight + 20;
  doc.font(FONT_REGULAR).fontSize(9).fillColor('#666666')
     .text(
       `${config.SELLER_NAME}, ${config.SELLER_ADDRESS_STREET}, ${config.SELLER_ADDRESS_ZIP} ${config.SELLER_ADDRESS_CITY}`,
       MARGIN, addressY, { width: 250 }
     );

  doc.fillColor('#000000');
  const addrLines = buildAddressLines(data);
  addrLines.forEach((line, i) => {
    doc.font(FONT_REGULAR).fontSize(10)
       .text(line, MARGIN, addressY + 16 + i * 15, { width: 250 });
  });

  // Invoice title + metadata
  const metaX = MARGIN + pageWidth - 200;
  const metaY = addressY + 16;
  const metaRows = [
    ['Rechnungsnummer:', data.invoiceNumber],
    ['Rechnungsdatum:', formatDate(data.issuedAt)],
    ['Leistungsdatum:', formatDate(data.leistungsdatum)],
  ];
  metaRows.forEach(([label, value], i) => {
    doc.font(FONT_BOLD).fontSize(9).text(label, metaX, metaY + i * 16, { width: 200 });
    doc.font(FONT_REGULAR).fontSize(9).text(value, metaX + 120, metaY + i * 16, { width: 80, align: 'right' });
  });

  // Heading
  const headingY = addressY + 16 + addrLines.length * 15 + 30;
  doc.font(FONT_BOLD).fontSize(16).text('Rechnung', MARGIN, headingY);

  // Line items table
  const tableY = headingY + 40;
  renderLineItemsTable(doc, data.lineItems, data.reverseCharge, MARGIN, tableY, pageWidth);

  // Footer
  renderFooter(doc, config);
}

function buildAddressLines(data: InvoiceData): string[] {
  const lines = [data.customer.name];
  const addr = data.customer.address;
  if (addr) {
    lines.push(addr.street);
    lines.push(`${addr.zip} ${addr.city}`);
    if (addr.country !== 'DE') {
      lines.push(addr.country);
    }
  }
  if (data.customer.vatId) {
    lines.push(`USt-IdNr.: ${data.customer.vatId}`);
  }
  return lines;
}

function renderLineItemsTable(
  doc: PDFKit.PDFDocument,
  items: LineItem[],
  reverseCharge: boolean,
  x: number,
  y: number,
  width: number,
): void {
  // Table header
  const cols = {
    desc: { x, w: width * 0.45 },
    qty: { x: x + width * 0.45, w: width * 0.08 },
    net: { x: x + width * 0.53, w: width * 0.15 },
    vat: { x: x + width * 0.68, w: width * 0.1 },
    gross: { x: x + width * 0.78, w: width * 0.22 },
  };

  // Header row
  doc.font(FONT_BOLD).fontSize(9);
  doc.text('Beschreibung', cols.desc.x, y, { width: cols.desc.w });
  doc.text('Menge', cols.qty.x, y, { width: cols.qty.w, align: 'right' });
  doc.text('Nettobetrag', cols.net.x, y, { width: cols.net.w, align: 'right' });
  doc.text('MwSt.', cols.vat.x, y, { width: cols.vat.w, align: 'right' });
  doc.text('Bruttobetrag', cols.gross.x, y, { width: cols.gross.w, align: 'right' });

  doc.moveTo(x, y + 14).lineTo(x + width, y + 14).stroke();

  let currentY = y + 20;
  let totalNet = 0;
  const vatMap: Map<number, { net: number; vat: number }> = new Map();

  // Item rows
  doc.font(FONT_REGULAR).fontSize(9);
  for (const item of items) {
    const lineNet = round2(item.quantity * item.unitPriceNet);
    const lineVat = round2(lineNet * item.vatRate / 100);
    const lineGross = round2(lineNet + lineVat);
    totalNet += lineNet;

    const vatEntry = vatMap.get(item.vatRate) ?? { net: 0, vat: 0 };
    vatEntry.net += lineNet;
    vatEntry.vat += lineVat;
    vatMap.set(item.vatRate, vatEntry);

    doc.text(item.description, cols.desc.x, currentY, { width: cols.desc.w });
    doc.text(String(item.quantity), cols.qty.x, currentY, { width: cols.qty.w, align: 'right' });
    doc.text(eur(item.unitPriceNet), cols.net.x, currentY, { width: cols.net.w, align: 'right' });
    doc.text(`${item.vatRate} %`, cols.vat.x, currentY, { width: cols.vat.w, align: 'right' });
    doc.text(eur(lineGross), cols.gross.x, currentY, { width: cols.gross.w, align: 'right' });
    currentY += 18;
  }

  doc.moveTo(x, currentY).lineTo(x + width, currentY).stroke();
  currentY += 10;

  // VAT breakdown
  doc.font(FONT_BOLD).fontSize(9).text('MwSt.-Aufschlüsselung:', x, currentY);
  currentY += 14;
  doc.font(FONT_REGULAR).fontSize(9);
  let totalVat = 0;
  let totalGross = 0;
  for (const [rate, { net, vat }] of vatMap) {
    const gross = round2(net + vat);
    totalVat += vat;
    totalGross += gross;
    if (reverseCharge) {
      doc.text(`${rate} % (Reverse Charge — ${eur(net)} Netto)`, x, currentY, { width: width * 0.6 });
      doc.text('0,00 €', x + width, currentY, { align: 'right', width: 1 });
    } else {
      doc.text(`${rate} % auf ${eur(net)}`, x, currentY, { width: width * 0.6 });
      doc.text(eur(vat), x + width, currentY, { align: 'right', width: 1 });
    }
    currentY += 14;
  }
  currentY += 4;

  // Totals
  doc.moveTo(x, currentY).lineTo(x + width, currentY).stroke();
  currentY += 8;

  const totalsData: [string, string][] = reverseCharge
    ? [
        ['Nettobetrag gesamt', eur(totalNet)],
        ['MwSt. gesamt (Reverse Charge)', '0,00 €'],
        ['Gesamtbetrag', eur(totalNet)],
      ]
    : [
        ['Nettobetrag gesamt', eur(totalNet)],
        ['MwSt. gesamt', eur(totalVat)],
        ['Gesamtbetrag', eur(totalGross)],
      ];

  for (const [label, value] of totalsData) {
    doc.font(label === 'Gesamtbetrag' ? FONT_BOLD : FONT_REGULAR)
       .fontSize(label === 'Gesamtbetrag' ? 11 : 9);
    doc.text(label, x, currentY, { width: width * 0.75 });
    doc.text(value, x + width * 0.75, currentY, { width: width * 0.25, align: 'right' });
    currentY += label === 'Gesamtbetrag' ? 20 : 14;
  }

  // Legal notices
  currentY += 10;
  doc.font(FONT_REGULAR).fontSize(8).fillColor('#555555');

  if (reverseCharge) {
    doc.text(
      'Steuerschuldnerschaft des Leistungsempfängers: Die Umsatzsteuer ist vom Leistungsempfänger zu entrichten (§ 13b UStG / Reverse Charge).',
      x, currentY, { width: width }
    );
    currentY += 24;
  }

  doc.text(
    'Gemäß § 14 UStG ausgestellte Rechnung. Zahlungsziel: sofort fällig (bereits bezahlt).',
    x, currentY, { width: width }
  );
  doc.fillColor('#000000');
}

function renderFooter(
  doc: PDFKit.PDFDocument,
  config: ReturnType<typeof getConfig>,
): void {
  const footerY = doc.page.height - 80;
  doc.font(FONT_REGULAR).fontSize(7).fillColor('#666666');

  const parts = [config.SELLER_NAME, config.SELLER_ADDRESS_STREET,
    `${config.SELLER_ADDRESS_ZIP} ${config.SELLER_ADDRESS_CITY}`];
  if (config.SELLER_VAT_ID) parts.push(`USt-IdNr.: ${config.SELLER_VAT_ID}`);
  if (config.SELLER_STEUERNUMMER) parts.push(`St.-Nr.: ${config.SELLER_STEUERNUMMER}`);

  doc.text(parts.join(' · '), MARGIN, footerY, {
    width: doc.page.width - MARGIN * 2,
    align: 'center',
  });
  doc.fillColor('#000000');
}

async function embedZugferd(pdfBuffer: Buffer, data: InvoiceData): Promise<Buffer> {
  const config = getConfig();
  const service = new EInvoiceService({ warn: () => {}, log: () => {}, error: console.error });

  const invoice = buildUblInvoice(data, config);

  const result = await service.generate(invoice, {
    format: 'Factur-X-EN16931',
    lang: 'de',
    pdf: {
      buffer: new Uint8Array(pdfBuffer),
      filename: `${data.invoiceNumber}.pdf`,
      mimetype: 'application/pdf',
    },
  });

  return Buffer.from(result as Uint8Array);
}

function buildUblInvoice(
  data: InvoiceData,
  config: ReturnType<typeof getConfig>,
): import('@e-invoice-eu/core').Invoice {
  const vatMap: Map<number, { net: number; vat: number }> = new Map();
  for (const item of data.lineItems) {
    const lineNet = round2(item.quantity * item.unitPriceNet);
    const lineVat = round2(lineNet * item.vatRate / 100);
    const entry = vatMap.get(item.vatRate) ?? { net: 0, vat: 0 };
    entry.net = round2(entry.net + lineNet);
    entry.vat = round2(entry.vat + lineVat);
    vatMap.set(item.vatRate, entry);
  }

  const totalNet = round2([...vatMap.values()].reduce((s, v) => s + v.net, 0));
  const totalVat = data.reverseCharge
    ? 0
    : round2([...vatMap.values()].reduce((s, v) => s + v.vat, 0));
  const totalGross = round2(totalNet + totalVat);

  const taxTotals = data.reverseCharge
    ? [{
        'cbc:TaxAmount': '0.00',
        'cac:TaxSubtotal': [{
          'cbc:TaxableAmount': String(totalNet.toFixed(2)),
          'cbc:TaxAmount': '0.00',
          'cac:TaxCategory': {
            'cbc:ID': 'AE',
            'cbc:Percent': '0',
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        }],
      }]
    : [...vatMap.entries()].map(([rate, { net, vat }]) => ({
        'cbc:TaxAmount': String(vat.toFixed(2)),
        'cac:TaxSubtotal': [{
          'cbc:TaxableAmount': String(net.toFixed(2)),
          'cbc:TaxAmount': String(vat.toFixed(2)),
          'cac:TaxCategory': {
            'cbc:ID': rate === 0 ? 'Z' : 'S',
            'cbc:Percent': String(rate),
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        }],
      }));

  const invoiceLines = data.lineItems.map((item, idx) => {
    const lineNet = round2(item.quantity * item.unitPriceNet);
    const lineVat = data.reverseCharge ? 0 : round2(lineNet * item.vatRate / 100);
    return {
      'cbc:ID': String(idx + 1),
      'cbc:InvoicedQuantity': String(item.quantity),
      'cbc:InvoicedQuantity@unitCode': 'C62',
      'cbc:LineExtensionAmount': String(lineNet.toFixed(2)),
      'cac:Item': {
        'cbc:Name': item.description,
        'cac:ClassifiedTaxCategory': {
          'cbc:ID': data.reverseCharge ? 'AE' : (item.vatRate === 0 ? 'Z' : 'S'),
          'cbc:Percent': String(item.vatRate),
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      },
      'cac:Price': {
        'cbc:PriceAmount': String(item.unitPriceNet.toFixed(2)),
      },
    };
  });

  const addr = data.customer.address;
  const buyerParty: Record<string, unknown> = {
    'cac:PartyName': [{ 'cbc:Name': data.customer.name }],
    'cac:PostalAddress': addr
      ? {
          'cbc:StreetName': addr.street,
          'cbc:CityName': addr.city,
          'cbc:PostalZone': addr.zip,
          'cac:Country': { 'cbc:IdentificationCode': addr.country },
        }
      : { 'cac:Country': { 'cbc:IdentificationCode': 'DE' } },
    'cac:PartyLegalEntity': { 'cbc:RegistrationName': data.customer.name },
  };

  if (data.customer.vatId) {
    buyerParty['cac:PartyTaxScheme'] = [{
      'cbc:CompanyID': data.customer.vatId,
      'cac:TaxScheme': { 'cbc:ID': 'VAT' },
    }];
  }

  const sellerPartyTaxScheme: unknown[] = [];
  if (config.SELLER_VAT_ID) {
    sellerPartyTaxScheme.push({
      'cbc:CompanyID': config.SELLER_VAT_ID,
      'cac:TaxScheme': { 'cbc:ID': 'VAT' },
    });
  }
  if (config.SELLER_STEUERNUMMER) {
    sellerPartyTaxScheme.push({
      'cbc:CompanyID': config.SELLER_STEUERNUMMER,
      'cac:TaxScheme': { 'cbc:ID': 'TAX' },
    });
  }

  return {
    'ubl:Invoice': {
      'cbc:ID': data.invoiceNumber,
      'cbc:IssueDate': toIsoDate(data.issuedAt),
      'cbc:InvoiceTypeCode': '380',
      'cbc:DocumentCurrencyCode': 'EUR',
      'cbc:TaxPointDate': toIsoDate(data.leistungsdatum),
      ...(data.reverseCharge ? {
        'cbc:Note': ['Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG)'],
      } : {}),
      'cac:AccountingSupplierParty': {
        'cac:Party': {
          'cac:PartyName': [{ 'cbc:Name': config.SELLER_NAME }],
          'cac:PostalAddress': {
            'cbc:StreetName': config.SELLER_ADDRESS_STREET,
            'cbc:CityName': config.SELLER_ADDRESS_CITY,
            'cbc:PostalZone': config.SELLER_ADDRESS_ZIP,
            'cac:Country': { 'cbc:IdentificationCode': 'DE' },
          },
          'cac:PartyTaxScheme': sellerPartyTaxScheme,
          'cac:PartyLegalEntity': { 'cbc:RegistrationName': config.SELLER_NAME },
        },
      },
      'cac:AccountingCustomerParty': {
        'cac:Party': buyerParty,
      },
      'cac:TaxTotal': taxTotals,
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': String(totalNet.toFixed(2)),
        'cbc:TaxExclusiveAmount': String(totalNet.toFixed(2)),
        'cbc:TaxInclusiveAmount': String(totalGross.toFixed(2)),
        'cbc:PayableAmount': String(totalGross.toFixed(2)),
      },
      'cac:InvoiceLine': invoiceLines,
    },
  } as unknown as import('@e-invoice-eu/core').Invoice;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function eur(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
