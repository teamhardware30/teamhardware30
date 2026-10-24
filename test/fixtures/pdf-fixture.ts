/**
 * Builds a minimal, valid single-page PDF with real extractable text.
 * PDF.js (used by unpdf) tolerates a deliberately bare xref table and
 * recovers by scanning for `N G obj` markers, so this small hand-built
 * file parses just like a real one for extraction purposes.
 */
export function buildPdfFixture(lines: string[], pageSize: [number, number] = [612, 792]): Buffer {
  const content = ['BT', '/F1 12 Tf', '14 TL', `1 0 0 1 72 ${pageSize[1] - 72} Tm`]
    .concat(lines.map((line, i) => `${i === 0 ? '' : '0 -14 Td '}(${escapePdfText(line)}) Tj`))
    .concat(['ET'])
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf-8')} >>\nstream\n${content}\nendstream`,
  ];

  const body = objects.map((obj, i) => `${i + 1} 0 obj\n${obj}\nendobj\n`).join('');

  const pdf = `%PDF-1.4\n${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n0\n%%EOF`;

  return Buffer.from(pdf, 'utf-8');
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
