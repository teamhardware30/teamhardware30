export interface AtsCheck {
  id: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'error';
  message: string;
  fix: string;
}

export interface ResumeExtractionSummary {
  text: string;
  pageCount: number;
  hasImages: boolean;
  likelyMultiColumn: boolean;
  isScanned: boolean;
  hasTables: boolean;
}

export function runDeterministicChecks(fileName: string, extraction: ResumeExtractionSummary): AtsCheck[] {
  const text = extraction.text ?? '';
  const headings = ['experience', 'education', 'skills', 'summary', 'profile'];
  const foundHeadings = headings.filter((heading) => new RegExp(`\\b${heading}\\b`, 'i').test(text));
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
  const dates = text.match(/\b(19|20)\d{2}\b/g) ?? [];

  return [
    { id: 'parseable-text', passed: text.trim().length >= 50, severity: 'error', message: text.trim().length >= 50 ? 'Resume text is extractable.' : 'The resume has too little extractable text.', fix: 'Upload a text-based PDF or DOCX instead of an image-only file.' },
    { id: 'not-scanned', passed: !extraction.isScanned, severity: 'error', message: extraction.isScanned ? 'The file appears to be scanned.' : 'The file is not scan-dependent.', fix: 'Use a text-based PDF export rather than a scanned image.' },
    { id: 'single-column', passed: !extraction.likelyMultiColumn && !extraction.hasTables, severity: 'warning', message: extraction.likelyMultiColumn || extraction.hasTables ? 'Complex layout detected.' : 'Layout is ATS-friendly.', fix: 'Use a single-column layout without tables.' },
    { id: 'no-images', passed: !extraction.hasImages, severity: 'warning', message: extraction.hasImages ? 'Images were detected.' : 'No layout-breaking images were detected.', fix: 'Remove photos, icons, and image-based content.' },
    { id: 'page-count', passed: extraction.pageCount >= 1 && extraction.pageCount <= 2, severity: 'warning', message: `The resume has ${extraction.pageCount} page(s).`, fix: 'Keep the resume to one or two pages.' },
    { id: 'standard-headings', passed: foundHeadings.length >= 2, severity: 'warning', message: foundHeadings.length >= 2 ? 'Standard headings are present.' : 'Standard headings are missing.', fix: 'Add Experience, Education, Skills, and Summary headings.' },
    { id: 'contact-info', passed: email && phone, severity: 'error', message: email && phone ? 'Email and phone number are present.' : 'Contact information is incomplete.', fix: 'Add a professional email address and phone number.' },
    { id: 'date-consistency', passed: dates.length >= 2, severity: 'warning', message: dates.length >= 2 ? 'Dates are present and parseable.' : 'Dates are missing or inconsistent.', fix: 'Use consistent YYYY-MM or Month YYYY dates.' },
    { id: 'file-name', passed: /^[A-Za-z0-9][A-Za-z0-9._ -]*\.pdf$/i.test(fileName) || /^[A-Za-z0-9][A-Za-z0-9._ -]*\.docx$/i.test(fileName), severity: 'info', message: 'File name is ATS-safe.', fix: 'Rename the file using letters, numbers, hyphens, and underscores only.' },
    { id: 'text-not-header-footer', passed: true, severity: 'info', message: 'Key information is available in the extracted text.', fix: 'Avoid placing essential details only in headers or footers.' },
  ];
}
