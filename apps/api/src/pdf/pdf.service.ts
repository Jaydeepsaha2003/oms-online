import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// pdfmake's Node entry (PdfPrinter) ships without clean default-export typings;
// require keeps the import simple and avoids fighting the bundled browser types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake');

/**
 * Use the PDF standard-14 fonts (Helvetica family) so no .ttf files need to be
 * bundled or shipped — pdfkit (under pdfmake) resolves these built-in.
 */
const STANDARD_FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

export interface TableDocOptions {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
  /** Footer note (e.g. generated-by / page). */
  footer?: string;
}

/**
 * Reusable server-side PDF generator (invoices, work orders, reports…).
 * `render` takes a full pdfmake document definition; `renderTable` is a quick
 * helper for tabular documents.
 */
@Injectable()
export class PdfService {
  private readonly printer = new PdfPrinter(STANDARD_FONTS);

  /** Render any pdfmake document definition to a Buffer. */
  render(doc: TDocumentDefinitions): Promise<Buffer> {
    const definition: TDocumentDefinitions = {
      pageMargins: [40, 56, 40, 56],
      defaultStyle: { font: 'Helvetica', fontSize: 10 },
      styles: {
        title: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
        subtitle: { fontSize: 10, color: '#666666', margin: [0, 0, 0, 12] },
        tableHeader: { bold: true, fillColor: '#f1f5f9', margin: [0, 4, 0, 4] },
      },
      ...doc,
    };

    const pdfDoc = this.printer.createPdfKitDocument(definition);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  /** Quick tabular document — a title + a striped table. */
  renderTable(opts: TableDocOptions): Promise<Buffer> {
    return this.render({
      content: [
        { text: opts.title, style: 'title' },
        ...(opts.subtitle ? [{ text: opts.subtitle, style: 'subtitle' }] : []),
        {
          table: {
            headerRows: 1,
            widths: opts.columns.map(() => '*'),
            body: [
              opts.columns.map((c) => ({ text: c, style: 'tableHeader' })),
              ...opts.rows.map((r) => r.map((cell) => (cell ?? '').toString())),
            ],
          },
          layout: 'lightHorizontalLines',
        },
      ],
      footer: opts.footer
        ? (currentPage: number, pageCount: number) => ({
            text: `${opts.footer}  ·  ${currentPage}/${pageCount}`,
            alignment: 'center',
            fontSize: 8,
            color: '#999999',
            margin: [0, 16, 0, 0],
          })
        : undefined,
    });
  }

  setDownloadHeaders(res: Response, baseName: string): void {
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${baseName}-${stamp}.pdf"`,
    });
  }
}
