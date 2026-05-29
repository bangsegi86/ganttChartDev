import { jsPDF } from 'jspdf';
import { renderFullCanvas, type FullRenderInput } from './renderFullCanvas';
import { bridge } from '@/shared/bridge';

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? '';
}

/** Export the full chart as a high-resolution PNG. */
export async function exportPng(input: FullRenderInput, fileName: string): Promise<void> {
  const canvas = renderFullCanvas(input);
  const dataUrl = canvas.toDataURL('image/png');
  await bridge().export.saveBinary(`${fileName}.png`, dataUrlToBase64(dataUrl), [
    { name: 'PNG Image', extensions: ['png'] },
  ]);
}

/**
 * Export the full chart as a PDF. The chart image is placed on a landscape
 * page, scaled to fit while preserving aspect ratio.
 */
export async function exportPdf(input: FullRenderInput, fileName: string): Promise<void> {
  const canvas = renderFullCanvas(input);
  const imgData = canvas.toDataURL('image/png');

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  const ratio = Math.min(availW / canvas.width, availH / canvas.height);
  const w = canvas.width * ratio;
  const h = canvas.height * ratio;
  pdf.addImage(imgData, 'PNG', margin, margin, w, h);

  const base64 = btoa(
    new Uint8Array(pdf.output('arraybuffer') as ArrayBuffer).reduce(
      (acc, byte) => acc + String.fromCharCode(byte),
      '',
    ),
  );
  await bridge().export.saveBinary(`${fileName}.pdf`, base64, [
    { name: 'PDF Document', extensions: ['pdf'] },
  ]);
}
