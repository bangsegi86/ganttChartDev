import { jsPDF } from 'jspdf';
import { renderFullCanvas, type FullRenderInput } from './renderFullCanvas';
import { bridge } from '@/shared/bridge';
import { useProjectStore } from '@/app/store/useProjectStore';

/** Outcome of an image/PDF export, so callers can warn about cut-off rows. */
export interface ImageExportResult {
  totalRows: number;
  drawnRows: number;
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? '';
}

/** Base64-encode bytes in chunks (byte-by-byte string building is O(n²)). */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** Export the full chart as a high-resolution PNG. */
export async function exportPng(input: FullRenderInput, fileName: string): Promise<ImageExportResult> {
  const { canvas, totalRows, drawnRows } = renderFullCanvas(input);
  const dataUrl = canvas.toDataURL('image/png');
  await bridge().export.saveBinary(`${fileName}.png`, dataUrlToBase64(dataUrl), [
    { name: 'PNG Image', extensions: ['png'] },
  ]);
  return { totalRows, drawnRows };
}

/**
 * Export the full chart as a PDF. The chart is scaled to the A4 landscape page
 * width (so text stays legible) and split across as many pages as needed,
 * repeating the date header at the top of each page.
 */
export async function exportPdf(input: FullRenderInput, fileName: string): Promise<ImageExportResult> {
  const { canvas, headerPx, totalRows, drawnRows } = renderFullCanvas(input);

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  // Fit width; never upscale a narrow chart.
  const scale = Math.min(availW / canvas.width, 1);
  const headerH = headerPx * scale;
  const bodyPerPagePx = Math.max(1, Math.floor((availH - headerH) / scale));
  const bodyTotalPx = canvas.height - headerPx;
  const pages = Math.max(1, Math.ceil(bodyTotalPx / bodyPerPagePx));

  const slice = document.createElement('canvas');
  slice.width = canvas.width;
  const sctx = slice.getContext('2d')!;
  for (let page = 0; page < pages; page++) {
    const y0 = headerPx + page * bodyPerPagePx;
    const h = Math.min(bodyPerPagePx, canvas.height - y0);
    slice.height = headerPx + h;
    sctx.drawImage(canvas, 0, 0, canvas.width, headerPx, 0, 0, canvas.width, headerPx);
    sctx.drawImage(canvas, 0, y0, canvas.width, h, 0, headerPx, canvas.width, h);
    if (page > 0) pdf.addPage();
    // JPEG is embedded as-is; jsPDF re-encodes PNG in JS, which froze the UI for
    // tens of seconds on large charts.
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, slice.width * scale, slice.height * scale);
  }

  const base64 = bytesToBase64(new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer));
  await bridge().export.saveBinary(`${fileName}.pdf`, base64, [
    { name: 'PDF Document', extensions: ['pdf'] },
  ]);
  return { totalRows, drawnRows };
}

/** Tell the user when the image hit the size limit and rows were cut off. */
export function warnIfTruncated(r: ImageExportResult): void {
  if (r.drawnRows >= r.totalRows) return;
  useProjectStore.getState().showAppToast(
    `이미지 크기 한도 때문에 ${r.totalRows}개 행 중 ${r.drawnRows}개만 내보냈습니다. 전체가 필요하면 HTML 내보내기를 사용하세요.`,
    'error',
  );
}
