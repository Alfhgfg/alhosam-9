import * as XLSX from 'xlsx';

export interface ExcelSheetData {
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
  footerRows?: (string | number)[][];
}

interface AndroidFileBridge {
  saveFile: (base64Data: string, fileName: string, mimeType: string) => boolean;
}

function getAndroidFileBridge(): AndroidFileBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AndroidFileBridge?: AndroidFileBridge };
  return w.AndroidFileBridge ?? null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function saveTextFileCrossPlatform(
  content: string,
  fileName: string,
  mimeType: string
): boolean {
  const bridge = getAndroidFileBridge();
  if (bridge) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    return bridge.saveFile(bytesToBase64(bytes), fileName, mimeType);
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function writeWorkbookCrossPlatform(
  wb: XLSX.WorkBook,
  fileNameWithExt: string
): void {
  const bridge = getAndroidFileBridge();
  if (bridge) {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const base64 = bytesToBase64(new Uint8Array(out));
    const ok = bridge.saveFile(
      base64,
      fileNameWithExt,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    if (ok) return;
  }
  XLSX.writeFile(wb, fileNameWithExt);
}

export function appendRtlSheet(
  wb: XLSX.WorkBook,
  sheet: ExcelSheetData
): void {
  const allRows = [
    sheet.headers,
    ...sheet.rows,
    ...(sheet.footerRows ?? []),
  ];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  ws['!views'] = [{ RTL: true }];
  ws['!cols'] = sheet.headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...sheet.rows.map((r) => String(r[i] ?? '').length),
      ...(sheet.footerRows ?? []).map((r) => String(r[i] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 5, 13), 42) };
  });
  XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName.slice(0, 31));
}

export function exportToExcel(fileName: string, sheets: ExcelSheetData[]): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  for (const sheet of sheets) {
    appendRtlSheet(wb, sheet);
  }

  writeWorkbookCrossPlatform(wb, `${fileName}.xlsx`);
}
