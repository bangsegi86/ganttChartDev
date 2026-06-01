import ExcelJS from 'exceljs';
import type { Project } from '@/entities';
import { buildVisibleRows } from '@/features/grid/treeModel';
import { bridge } from '@/shared/bridge';
import { PRIORITY_COLORS } from '@/features/gantt/colors';
import { renderFullCanvas, type FullRenderInput } from './renderFullCanvas';

const PRIORITY_LABEL: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '긴급',
};

/**
 * Export the WBS to a styled .xlsx workbook. Preserves the outline hierarchy
 * (indented names + Excel grouping), priority colour swatches, progress and
 * assignees.
 */
export async function exportExcel(
  project: Project,
  fileName: string,
  ganttInput?: FullRenderInput,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Gantt';
  wb.created = new Date();
  const ws = wb.addWorksheet('WBS', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Title row.
  ws.mergeCells('A1:H1');
  const title = ws.getCell('A1');
  title.value = project.name;
  title.font = { size: 14, bold: true };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 24;

  // Header row.
  const headers = ['WBS', '작업명', '시작일', '종료일', '기간(일)', '담당자', '진척률', '우선순위'];
  const headerRow = ws.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = thinBorder();
  });
  headerRow.height = 20;

  ws.columns = [
    { width: 10 },
    { width: 36 },
    { width: 13 },
    { width: 13 },
    { width: 10 },
    { width: 18 },
    { width: 10 },
    { width: 12 },
  ];

  const rows = buildVisibleRows(project.tasks);
  rows.forEach((r) => {
    const t = r.task;
    const assignees = t.assigneeIds
      .map((id) => project.resources.find((res) => res.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    const row = ws.addRow([
      r.wbs,
      `${'    '.repeat(r.depth)}${t.name}`,
      t.start,
      t.isMilestone ? '' : t.end,
      t.isMilestone ? 0 : t.durationDays,
      assignees,
      t.progress / 100,
      PRIORITY_LABEL[t.priority] ?? t.priority,
    ]);

    row.outlineLevel = r.depth;
    row.getCell(2).font = { bold: r.hasChildren };
    row.getCell(7).numFmt = '0%';
    row.eachCell((cell) => (cell.border = thinBorder()));

    // Priority colour swatch.
    const colour = PRIORITY_COLORS[t.priority].replace('#', 'FF');
    row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
    row.getCell(8).font = { color: { argb: 'FFFFFFFF' } };
    row.getCell(8).alignment = { horizontal: 'center' };

    if (r.hasChildren) {
      for (let c = 1; c <= 8; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      }
    }
  });

  if (ganttInput) {
    const ganttCanvas = renderFullCanvas(ganttInput);
    const ganttBase64 = ganttCanvas.toDataURL('image/png').split(',')[1]!;
    const ws2 = wb.addWorksheet('간트 차트');
    const imageId = wb.addImage({ base64: ganttBase64, extension: 'png' });
    ws2.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: {
        width: ganttCanvas.width / (window.devicePixelRatio || 1),
        height: ganttCanvas.height / (window.devicePixelRatio || 1),
      },
    } as Parameters<typeof ws2.addImage>[1]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const base64 = arrayBufferToBase64(buffer as ArrayBuffer);
  await bridge().export.saveBinary(`${fileName}.xlsx`, base64, [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
  ]);
}

function thinBorder(): ExcelJS.Borders {
  const side = { style: 'thin' as const, color: { argb: 'FFE2E8F0' } };
  return { top: side, left: side, bottom: side, right: side } as ExcelJS.Borders;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
