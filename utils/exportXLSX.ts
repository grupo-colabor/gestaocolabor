import type ExcelJS from 'exceljs';
import type { ReportInput, KPIRow, RankingTable, PeriodInfo } from './reportTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toArgb(hex: string): string {
  return 'FF' + hex.replace('#', '').toUpperCase();
}

function toNum(v: number | string): number {
  if (typeof v === 'string') {
    const clean = v.replace('%', '').replace('h', '').replace(/[R$\s.]/g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  }
  return Number(v) || 0;
}

function triggerDownload(buffer: ArrayBuffer, filename: string, mime: string) {
  const blob = new Blob([buffer], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function exportToXLSX(
  input: ReportInput,
  config: { includeTabs: Record<string, boolean>; filename?: string }
) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Colabor Dashboard';
  wb.created  = input.generatedAt;
  wb.modified = input.generatedAt;

  const { periods } = input;
  const nPeriods    = periods.length;
  const periodColors = periods.map(p => p.color);

  // ── Style factories ──────────────────────────────────────────────────────

  const solidFill = (hex: string): ExcelJS.FillPattern => ({
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: toArgb(hex) },
  });

  const borderAll = (): Partial<ExcelJS.Borders> => ({
    top:    { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left:   { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right:  { style: 'thin', color: { argb: 'FFE2E8F0' } },
  });

  function styleHeaderCell(cell: ExcelJS.Cell, bgHex: string) {
    cell.fill   = solidFill(bgHex);
    cell.font   = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = borderAll();
  }

  function styleDataCell(cell: ExcelJS.Cell, rowEven: boolean) {
    cell.fill   = solidFill(rowEven ? 'F8FAFC' : 'FFFFFF');
    cell.font   = { size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = borderAll();
  }

  function styleDeltaCell(cell: ExcelJS.Cell, delta: number, positiveIsGood: boolean) {
    const isGood = positiveIsGood ? delta >= 0 : delta <= 0;
    if (delta === 0) {
      cell.fill = solidFill('F1F5F9');
      cell.font = { size: 10, color: { argb: 'FF64748B' } };
    } else {
      cell.fill = solidFill(isGood ? 'D1FAE5' : 'FEE2E2');
      cell.font = { bold: true, size: 10, color: { argb: isGood ? 'FF065F46' : 'FF7F1D1D' } };
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = borderAll();
  }

  // ── KPI sheet builder ────────────────────────────────────────────────────

  function buildKPISection(ws: ExcelJS.Worksheet, kpis: KPIRow[], startRow: number): number {
    // Column layout: [Métrica | P1 | P2 | … | ΔP2 | ΔP3 | … | Δ%P2 | …]
    const headerValues = [
      'Métrica',
      ...periods.map(p => `${p.label}\n${p.startDate || 'Todo período'} → ${p.endDate || ''}`),
      ...periods.slice(1).map(p => `Δ ${p.label} vs P1`),
      ...periods.slice(1).map(p => `Δ% ${p.label} vs P1`),
    ];

    const headerRow = ws.getRow(startRow);
    headerValues.forEach((v, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = v;
      const bgColor = i === 0
        ? '334155'
        : i <= nPeriods
          ? (periodColors[i - 1] || '334155').replace('#', '')
          : '475569';
      styleHeaderCell(cell, bgColor);
    });
    headerRow.height = 40;
    startRow++;

    kpis.forEach((kpi, rowIdx) => {
      const p1val = toNum(kpi.values[0]);
      const dataRow = ws.getRow(startRow);
      const isEven  = rowIdx % 2 === 0;

      // Metric name
      const nameCell = dataRow.getCell(1);
      nameCell.value     = kpi.title;
      nameCell.fill      = solidFill(isEven ? 'F8FAFC' : 'FFFFFF');
      nameCell.font      = { bold: true, size: 10 };
      nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
      nameCell.border    = borderAll();

      // Period values
      kpi.values.forEach((v, i) => {
        const cell = dataRow.getCell(i + 2);
        cell.value = typeof v === 'number'
          ? v
          : (kpi.isCurrency
              ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(toNum(v))
              : v);
        styleDataCell(cell, isEven);
        // Color period header dot effect with light fill
        const [r, g, b] = hexToRGB(periodColors[i] || '#3B82F6');
        if (i > 0) cell.fill = solidFill(lightenHex(periodColors[i] || '#3B82F6', 0.92));
      });

      // Delta absolute
      kpi.values.slice(1).forEach((v, i) => {
        const delta = toNum(v) - p1val;
        const cell  = dataRow.getCell(nPeriods + 1 + i + 1);
        const sign  = delta > 0 ? '+' : '';
        cell.value  = kpi.isCurrency
          ? `${sign}${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(delta)}`
          : `${sign}${delta}`;
        styleDeltaCell(cell, delta, kpi.positiveIsGood !== false);
      });

      // Delta %
      kpi.values.slice(1).forEach((v, i) => {
        const delta = toNum(v) - p1val;
        const pct   = p1val !== 0 ? Math.round((delta / p1val) * 100) : null;
        const cell  = dataRow.getCell(nPeriods + kpi.values.slice(1).length + 1 + i + 1);
        cell.value  = pct !== null ? `${pct > 0 ? '+' : ''}${pct}%` : 'N/A';
        styleDeltaCell(cell, delta, kpi.positiveIsGood !== false);
      });

      dataRow.height = 22;
      startRow++;
    });

    // Set column widths
    ws.getColumn(1).width = 34;
    for (let i = 2; i <= headerValues.length; i++) ws.getColumn(i).width = 22;

    return startRow + 1; // leave blank row
  }

  function buildRankingSection(ws: ExcelJS.Worksheet, ranking: RankingTable, startRow: number): number {
    const titleRow = ws.getRow(startRow);
    titleRow.getCell(1).value = ranking.title;
    titleRow.getCell(1).font  = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
    titleRow.height = 24;
    startRow++;

    const headers = ['Nome', ...periods.map(p => p.label)];
    const headerRow = ws.getRow(startRow);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      const bg = i === 0 ? '334155' : (periodColors[i - 1] || '334155').replace('#', '');
      styleHeaderCell(cell, bg);
    });
    headerRow.height = 28;
    startRow++;

    ranking.rows.forEach((row, rowIdx) => {
      const dataRow = ws.getRow(startRow);
      const isEven  = rowIdx % 2 === 0;

      const nameCell = dataRow.getCell(1);
      nameCell.value     = row.name;
      nameCell.fill      = solidFill(isEven ? 'F8FAFC' : 'FFFFFF');
      nameCell.font      = { size: 10 };
      nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
      nameCell.border    = borderAll();

      row.values.forEach((v, i) => {
        const cell  = dataRow.getCell(i + 2);
        cell.value  = v;
        styleDataCell(cell, isEven);
      });

      dataRow.height = 20;
      startRow++;
    });

    return startRow + 2;
  }

  // ── Sheet: Resumo ──────────────────────────────────────────────────────────

  const wsResumo = wb.addWorksheet('Resumo', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  });

  let row = 1;

  // Title block
  wsResumo.mergeCells(row, 1, row, nPeriods * 3 + 2);
  const titleCell = wsResumo.getCell(row, 1);
  titleCell.value = input.title;
  titleCell.font  = { bold: true, size: 18, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  wsResumo.getRow(row).height = 44;
  row++;

  wsResumo.getCell(row, 1).value = `Gerado em: ${input.generatedAt.toLocaleString('pt-BR')}`;
  wsResumo.getCell(row, 1).font  = { size: 10, color: { argb: 'FF64748B' } };
  row += 2;

  // Periods
  wsResumo.getCell(row, 1).value = 'Períodos Comparados';
  wsResumo.getCell(row, 1).font  = { bold: true, size: 11 };
  row++;
  periods.forEach((p) => {
    wsResumo.getCell(row, 1).value = `${p.label}: ${p.startDate || 'Início'} → ${p.endDate || 'Fim'}`;
    wsResumo.getCell(row, 1).font  = { size: 11, bold: true, color: { argb: toArgb(p.color) } };
    row++;
  });
  row++;

  // Active filters
  if (input.activeFilters.length > 0) {
    wsResumo.getCell(row, 1).value = 'Filtros Ativos';
    wsResumo.getCell(row, 1).font  = { bold: true, size: 11 };
    row++;
    input.activeFilters.forEach(f => {
      wsResumo.getCell(row, 1).value = `${f.label}: ${f.value}`;
      wsResumo.getCell(row, 1).font  = { size: 10, color: { argb: 'FF475569' } };
      row++;
    });
    row++;
  }

  // All KPIs from selected tabs
  wsResumo.getCell(row, 1).value = 'KPIs Consolidados';
  wsResumo.getCell(row, 1).font  = { bold: true, size: 13 };
  wsResumo.getRow(row).height = 28;
  row += 2;

  const selectedTabs = input.tabs.filter(t => config.includeTabs[t.id] !== false);
  const allKpis = selectedTabs.flatMap(tab =>
    tab.kpis.map(kpi => ({ ...kpi, title: `[${tab.label}] ${kpi.title}` }))
  );

  row = buildKPISection(wsResumo, allKpis, row);
  wsResumo.getColumn(1).width = 40;

  // ── Per-tab sheets ─────────────────────────────────────────────────────────

  for (const tab of selectedTabs) {
    const ws = wb.addWorksheet(tab.label, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });
    let r = 1;

    // Header
    ws.getCell(r, 1).value = `${tab.label} — ${input.title}`;
    ws.getCell(r, 1).font  = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    ws.getRow(r).height = 32;
    r++;
    ws.getCell(r, 1).value = `Gerado em: ${input.generatedAt.toLocaleString('pt-BR')}`;
    ws.getCell(r, 1).font  = { size: 9, color: { argb: 'FF94A3B8' } };
    r += 2;

    ws.getCell(r, 1).value = 'KPIs';
    ws.getCell(r, 1).font  = { bold: true, size: 12 };
    ws.getRow(r).height = 24;
    r += 2;

    r = buildKPISection(ws, tab.kpis, r);

    if (tab.rankings) {
      for (const ranking of tab.rankings) {
        r = buildRankingSection(ws, ranking, r);
      }
    }
  }

  // ── Download ───────────────────────────────────────────────────────────────

  const buffer = await wb.xlsx.writeBuffer() as ArrayBuffer;
  triggerDownload(
    buffer,
    config.filename || `relatorio-${Date.now()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [59, 130, 246];
}

/** Return a lightened hex string (amount 0–1, 1 = white) */
function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRGB(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return [lr, lg, lb].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
