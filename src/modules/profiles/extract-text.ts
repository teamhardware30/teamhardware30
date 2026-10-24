import { Logger } from '@nestjs/common';
import { getDocumentProxy, extractText as extractPdfText, extractTextItems, extractImages, renderPageAsImage } from 'unpdf';
import * as mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';

const logger = new Logger('extractText');

const OCR_TEXT_THRESHOLD = 200;
const LEFT_COLUMN_RATIO = 0.45;
const RIGHT_COLUMN_RATIO = 0.55;
const MIN_COLUMN_LINES = 8;

export interface ExtractedDocument {
  text: string;
  pageCount?: number;
  hasImages?: boolean;
  likelyMultiColumn?: boolean;
  isScanned?: boolean;
  hasTables?: boolean;
  ocrApplied?: boolean;
}

export async function extractText(buffer: Buffer, mime: string): Promise<ExtractedDocument> {
  if (mime === 'application/pdf') {
    return extractFromPdf(buffer);
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractFromDocx(buffer);
  }
  throw new Error(`Unsupported document type for text extraction: ${mime}`);
}

async function extractFromPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const data = new Uint8Array(buffer);
  const doc = await getDocumentProxy(data);

  const { text } = await extractPdfText(doc, { mergePages: true });
  const { items } = await extractTextItems(doc);

  let hasImages = false;
  for (let pageNumber = 1; pageNumber <= doc.numPages && !hasImages; pageNumber++) {
    const images = await extractImages(doc, pageNumber);
    hasImages = images.length > 0;
  }

  const likelyMultiColumn = await detectMultiColumn(doc, items);

  const result: ExtractedDocument = {
    text,
    pageCount: doc.numPages,
    hasImages,
    likelyMultiColumn,
    isScanned: text.trim().length < OCR_TEXT_THRESHOLD,
  };

  if (result.isScanned) {
    const ocrText = await ocrPdf(doc, doc.numPages);
    if (ocrText && ocrText.trim().length > result.text.trim().length) {
      result.text = ocrText;
      result.ocrApplied = true;
    }
  }

  return result;
}

async function detectMultiColumn(
  doc: Awaited<ReturnType<typeof getDocumentProxy>>,
  pagesOfItems: Awaited<ReturnType<typeof extractTextItems>>['items'],
): Promise<boolean> {
  for (let pageIndex = 0; pageIndex < pagesOfItems.length; pageIndex++) {
    const page = await doc.getPage(pageIndex + 1);
    const pageWidth = page.view[2] - page.view[0];
    if (!pageWidth) {
      continue;
    }

    const byLine = new Map<number, { left: number; right: number }>();
    for (const item of pagesOfItems[pageIndex]) {
      const lineKey = Math.round(item.y / 3);
      const line = byLine.get(lineKey) ?? { left: 0, right: 0 };
      if (item.x < pageWidth * LEFT_COLUMN_RATIO) {
        line.left++;
      } else if (item.x > pageWidth * RIGHT_COLUMN_RATIO) {
        line.right++;
      }
      byLine.set(lineKey, line);
    }

    let leftOnlyLines = 0;
    let rightOnlyLines = 0;
    for (const line of byLine.values()) {
      if (line.left > 0 && line.right === 0) {
        leftOnlyLines++;
      } else if (line.right > 0 && line.left === 0) {
        rightOnlyLines++;
      }
    }

    if (leftOnlyLines >= MIN_COLUMN_LINES && rightOnlyLines >= MIN_COLUMN_LINES) {
      return true;
    }
  }
  return false;
}

async function ocrPdf(doc: Awaited<ReturnType<typeof getDocumentProxy>>, pageCount: number): Promise<string | null> {
  try {
    const worker = await createWorker('eng');
    try {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const png = await renderPageAsImage(doc, pageNumber, {
          canvasImport: () => import('@napi-rs/canvas'),
          scale: 2,
        });
        const { data: result } = await worker.recognize(Buffer.from(png));
        pages.push(result.text);
      }
      return pages.join('\n\n');
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    logger.warn(`OCR fallback failed, keeping extracted text as-is: ${String(error)}`);
    return null;
  }
}

async function extractFromDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const [html, raw] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    mammoth.extractRawText({ buffer }),
  ]);

  return {
    text: raw.value,
    hasTables: html.value.includes('<table'),
  };
}
