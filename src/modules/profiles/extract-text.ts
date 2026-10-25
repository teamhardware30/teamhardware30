import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import { getDocumentProxy, extractImages, renderPageAsImage } from 'unpdf';

export interface ExtractedText {
  text: string;
  pageCount: number;
  hasImages: boolean;
  likelyMultiColumn: boolean;
  isScanned: boolean;
  hasTables: boolean;
  ocrApplied: boolean;
}

export interface ExtractTextOptions {
  maxPages?: number;
  maxOcrPages?: number;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_OCR_PAGES = 20;
const OCR_TEXT_THRESHOLD = 200;

export async function extractText(buffer: Buffer, mime: string, options: ExtractTextOptions = {}): Promise<ExtractedText> {
  if (mime === 'application/pdf') return extractPdf(buffer, options);
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return extractDocx(buffer);
  throw new Error('Upload a PDF or DOCX');
}

async function extractPdf(buffer: Buffer, options: ExtractTextOptions): Promise<ExtractedText> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxOcrPages = options.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES;
  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  if (pdf.numPages > maxPages) {
    throw new Error(`PDF has too many pages: ${pdf.numPages} exceeds ${maxPages}`);
  }

  let text = '';
  let hasImages = false;
  let likelyMultiColumn = false;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    text += pageText + '\n';

    const pageImages = await extractImages(pdf, pageNumber);
    if (pageImages.length > 0) hasImages = true;
    const pageWidth = page.view[2] - page.view[0];
    const items = content.items.filter((item) => {
      const candidate = item as { transform?: unknown; width?: unknown };
      return Array.isArray(candidate.transform) && typeof candidate.width === 'number';
    });
    const left = items.filter((item) => ((item as { transform: number[] }).transform[4] ?? 0) < pageWidth * 0.45);
    const right = items.filter((item) => ((item as { transform: number[] }).transform[4] ?? 0) > pageWidth * 0.55);
    if (left.length > 5 && right.length > 5 && left.length / items.length > 0.2 && right.length / items.length > 0.2) {
      likelyMultiColumn = true;
    }
  }

  const isScanned = text.trim().length < OCR_TEXT_THRESHOLD;
  let ocrApplied = false;
  let finalText = text;

  if (isScanned) {
    if (pdf.numPages > maxOcrPages) {
      throw new Error(`OCR is limited to at most ${maxOcrPages} pages`);
    }
    try {
      const worker = await createWorker('eng');
      let ocrText = '';
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const image = await renderPageAsImage(pdf, pageNumber, { scale: 2, canvasImport: async () => await import('@napi-rs/canvas') });
        const result = await worker.recognize(Buffer.from(image));
        ocrText += result.data.text + '\n';
      }
      await worker.terminate();
      if (ocrText.trim().length > text.trim().length) {
        finalText = ocrText;
        ocrApplied = true;
      }
    } catch (error) {
      console.error('OCR fallback failed', error);
    }
  }

  return {
    text: finalText,
    pageCount: pdf.numPages,
    hasImages,
    likelyMultiColumn,
    isScanned,
    hasTables: false,
    ocrApplied,
  };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  const raw = await mammoth.extractRawText({ buffer });
  const html = await mammoth.convertToHtml({ buffer });
  return {
    text: raw.value,
    pageCount: 1,
    hasImages: /<img\b/i.test(html.value),
    likelyMultiColumn: false,
    isScanned: raw.value.trim().length < OCR_TEXT_THRESHOLD,
    hasTables: /<table\b/i.test(html.value),
    ocrApplied: false,
  };
}


export type ExtractedDocument = ExtractedText;
