import type { ReportInput, KPIRow, RankingTable, PeriodInfo } from './reportTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [59, 130, 246];
}

function toNum(v: number | string): number {
  if (typeof v === 'string') {
    const clean = v.replace('%', '').replace('h', '').replace(/[R$\s.]/g, '').replace(',', '.');
    return parseFloat(clean) || 0;
  }
  return Number(v) || 0;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function exportToPDF(
  input: ReportInput,
  config: { includeTabs: Record<string, boolean>; filename?: string },
  onProgress?: (msg: string) => void
) {
  const { default: jsPDF }      = await import('jspdf');
  const { default: html2canvas } = await import('html2canvas');

  const A4_W    = 210;
  const A4_H    = 297;
  const MARGIN  = 14;
  const CW      = A4_W - MARGIN * 2; // content width
  const FOOTER_Y = A4_H - 10;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let pageNum = 1;

  // ── Footer ─────────────────────────────────────────────────────────────────

  function drawFooter() {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, FOOTER_Y - 4, A4_W - MARGIN, FOOTER_Y - 4);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.text(input.title, MARGIN, FOOTER_Y);
    doc.text(`Página ${pageNum}`, A4_W - MARGIN, FOOTER_Y, { align: 'right' });
    doc.text(input.generatedAt.toLocaleDateString('pt-BR'), A4_W / 2, FOOTER_Y, { align: 'center' });
  }

  function newPage() {
    drawFooter();
    doc.addPage();
    pageNum++;
  }

  function checkY(y: number, needed = 20): number {
    if (y + needed > FOOTER_Y - 8) { newPage(); return MARGIN; }
    return y;
  }

  // ── Cover page ─────────────────────────────────────────────────────────────

  onProgress?.('Gerando capa…');

  // Dark header bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, A4_W, 45, 'F');

  // Accent line
  doc.setFillColor(56, 138, 221);
  doc.rect(MARGIN, 38, CW, 2, 'F');

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(248, 250, 252);
  doc.text(input.title, MARGIN, 18);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('Relatório Comparativo de Períodos — Colabor Dashboard', MARGIN, 28);

  let y = 56;

  // Meta
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Gerado em: ${input.generatedAt.toLocaleString('pt-BR')}`, MARGIN, y);
  y += 14;

  // Periods section
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('Períodos Comparados', MARGIN, y);
  y += 4;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, A4_W - MARGIN, y);
  y += 7;

  input.periods.forEach(p => {
    const [r, g, b] = hexToRGB(p.color);
    doc.setFillColor(r, g, b);
    doc.circle(MARGIN + 2.5, y - 1.5, 2.5, 'F');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(r, g, b);
    doc.text(p.label, MARGIN + 7, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const dateStr = p.startDate
      ? `${p.startDate}  →  ${p.endDate}`
      : 'Todo o período';
    doc.text(dateStr, MARGIN + 18, y);
    y += 9;
  });
  y += 4;

  // Filters section
  if (input.activeFilters.length > 0) {
    y = checkY(y, 10 + input.activeFilters.length * 6);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Filtros Ativos', MARGIN, y);
    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, y, A4_W - MARGIN, y);
    y += 7;

    input.activeFilters.forEach(f => {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(`${f.label}:`, MARGIN + 4, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(f.value, MARGIN + 34, y);
      y += 6.5;
    });
  }

  // Tabs overview box
  y += 6;
  const selectedTabs = input.tabs.filter(t => config.includeTabs[t.id] !== false);
  y = checkY(y, 20 + selectedTabs.length * 7);

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(MARGIN, y, CW, 10 + selectedTabs.length * 7, 3, 3, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text('Dashboards incluídos neste relatório:', MARGIN + 5, y + 7);
  y += 13;
  selectedTabs.forEach(tab => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`• ${tab.label}  (${tab.kpis.length} KPIs)`, MARGIN + 8, y);
    y += 7;
  });

  drawFooter();

  // ── Per-tab pages ──────────────────────────────────────────────────────────

  const nPeriods = input.periods.length;
  const metricColW = 52;
  const dataColW   = Math.min(24, (CW - metricColW) / (nPeriods + (nPeriods - 1) * 2));

  for (const tab of selectedTabs) {
    onProgress?.(`Gerando aba: ${tab.label}…`);

    // ── Tab header page ──────────────────────────────────────────────────────
    doc.addPage();
    pageNum++;
    y = MARGIN;

    // Tab title bar
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, A4_W, 20, 'F');
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(248, 250, 252);
    doc.text(tab.label, MARGIN, 13);

    y = 28;

    // ── KPI table ────────────────────────────────────────────────────────────

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('KPIs Comparativos', MARGIN, y);
    y += 6;

    // Table header row
    const tableHeaders = ['Métrica', ...input.periods.map(p => p.label),
      ...input.periods.slice(1).map(p => `Δ ${p.label}`),
      ...input.periods.slice(1).map(p => `Δ%`)];

    const colWidths = [metricColW, ...Array(tableHeaders.length - 1).fill(dataColW)];
    let headerX = MARGIN;

    tableHeaders.forEach((h, i) => {
      const cw = colWidths[i];
      const bgRGB: [number, number, number] =
        i === 0 ? [30, 41, 59] :
        i <= nPeriods ? hexToRGB(input.periods[i - 1]?.color || '#334155') :
        [51, 65, 85];
      doc.setFillColor(...bgRGB);
      doc.rect(headerX, y, cw, 8, 'F');
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(h, headerX + cw / 2, y + 5, { align: 'center', maxWidth: cw - 2 });
      headerX += cw;
    });
    y += 8;

    // KPI data rows
    tab.kpis.forEach((kpi, rowIdx) => {
      y = checkY(y, 9);
      const rowH   = 8;
      const isEven = rowIdx % 2 === 0;
      const p1val  = toNum(kpi.values[0]);
      let rx       = MARGIN;

      // Metric name cell
      doc.setFillColor(isEven ? 248 : 255, isEven ? 250 : 255, isEven ? 252 : 255);
      doc.rect(rx, y, metricColW, rowH, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(kpi.title, rx + 2, y + 5.5, { maxWidth: metricColW - 4 });
      rx += metricColW;

      // Period values
      kpi.values.forEach((v, i) => {
        const [lr, lg, lb] = hexToRGB(input.periods[i]?.color || '#3B82F6');
        doc.setFillColor(
          isEven ? Math.round(lr * 0.08 + 248 * 0.92) : Math.round(lr * 0.05 + 255 * 0.95),
          isEven ? Math.round(lg * 0.08 + 250 * 0.92) : Math.round(lg * 0.05 + 255 * 0.95),
          isEven ? Math.round(lb * 0.08 + 252 * 0.92) : Math.round(lb * 0.05 + 255 * 0.95),
        );
        doc.rect(rx, y, dataColW, rowH, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(String(v), rx + dataColW / 2, y + 5.5, { align: 'center', maxWidth: dataColW - 1 });
        rx += dataColW;
      });

      // Delta absolute
      kpi.values.slice(1).forEach(v => {
        const delta = toNum(v) - p1val;
        const positiveIsGood = kpi.positiveIsGood !== false;
        const isGood = positiveIsGood ? delta >= 0 : delta <= 0;
        if (delta === 0) {
          doc.setFillColor(241, 245, 249);
        } else if (isGood) {
          doc.setFillColor(209, 250, 229);
        } else {
          doc.setFillColor(254, 226, 226);
        }
        doc.rect(rx, y, dataColW, rowH, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(
          delta === 0 ? 100 : isGood ? 6  : 127,
          delta === 0 ? 116 : isGood ? 95 : 29,
          delta === 0 ? 139 : isGood ? 70 : 29,
        );
        const sign = delta > 0 ? '+' : '';
        doc.text(`${sign}${delta}`, rx + dataColW / 2, y + 5.5, { align: 'center', maxWidth: dataColW - 1 });
        rx += dataColW;
      });

      // Delta %
      kpi.values.slice(1).forEach(v => {
        const delta = toNum(v) - p1val;
        const pct   = p1val !== 0 ? Math.round((delta / p1val) * 100) : null;
        const positiveIsGood = kpi.positiveIsGood !== false;
        const isGood = positiveIsGood ? delta >= 0 : delta <= 0;
        doc.setFillColor(isEven ? 248 : 255, isEven ? 250 : 255, isEven ? 252 : 255);
        doc.rect(rx, y, dataColW, rowH, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(delta === 0 ? 100 : isGood ? 6 : 127, delta === 0 ? 116 : isGood ? 95 : 29, delta === 0 ? 139 : isGood ? 70 : 29);
        doc.text(pct !== null ? `${pct > 0 ? '+' : ''}${pct}%` : '—', rx + dataColW / 2, y + 5.5, { align: 'center' });
        rx += dataColW;
      });

      // Row separator
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + rowH, MARGIN + CW, y + rowH);
      y += rowH;
    });

    y += 8;

    // ── Rankings ─────────────────────────────────────────────────────────────

    if (tab.rankings && tab.rankings.length > 0) {
      for (const ranking of tab.rankings) {
        const rankMetricW = 65;
        const rankDataW   = Math.min(28, (CW - rankMetricW) / nPeriods);
        const rowsToShow  = ranking.rows.slice(0, 10);
        const needed      = 8 + 8 + rowsToShow.length * 7 + 12;

        y = checkY(y, needed);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(ranking.title, MARGIN, y);
        y += 6;

        // Ranking header
        doc.setFillColor(30, 41, 59);
        doc.rect(MARGIN, y, rankMetricW, 8, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('NOME', MARGIN + 3, y + 5.5);
        let rrx = MARGIN + rankMetricW;
        input.periods.forEach((p, i) => {
          const [r, g, b] = hexToRGB(p.color);
          doc.setFillColor(r, g, b);
          doc.rect(rrx, y, rankDataW, 8, 'F');
          doc.setTextColor(255, 255, 255);
          doc.text(p.label, rrx + rankDataW / 2, y + 5.5, { align: 'center' });
          rrx += rankDataW;
        });
        y += 8;

        rowsToShow.forEach((row, rowIdx) => {
          y = checkY(y, 8);
          const rowH  = 7;
          const even  = rowIdx % 2 === 0;
          doc.setFillColor(even ? 248 : 255, even ? 250 : 255, even ? 252 : 255);
          doc.rect(MARGIN, y, rankMetricW + rankDataW * nPeriods, rowH, 'F');

          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(30, 41, 59);
          const name = row.name.length > 28 ? row.name.substring(0, 26) + '…' : row.name;
          doc.text(name, MARGIN + 2, y + 5);

          let drx = MARGIN + rankMetricW;
          row.values.forEach(v => {
            doc.setFont('helvetica', 'bold');
            doc.text(String(v), drx + rankDataW / 2, y + 5, { align: 'center', maxWidth: rankDataW - 2 });
            drx += rankDataW;
          });

          doc.setDrawColor(241, 245, 249);
          doc.setLineWidth(0.2);
          doc.line(MARGIN, y + rowH, MARGIN + CW, y + rowH);
          y += rowH;
        });
        y += 10;
      }
    }

    // ── Chart capture ─────────────────────────────────────────────────────────

    const chartEl = input.chartElements?.[tab.id];
    if (chartEl) {
      onProgress?.(`Capturando gráficos: ${tab.label}…`);
      try {
        const canvas  = await html2canvas(chartEl, {
          scale: 1.5,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          removeContainer: true,
        });
        const imgData = canvas.toDataURL('image/png');
        const imgW    = CW;
        const imgH    = Math.min((canvas.height / canvas.width) * imgW, A4_H - MARGIN * 2 - 20);

        y = checkY(y, imgH + 10);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text('Gráficos', MARGIN, y);
        y += 5;
        doc.addImage(imgData, 'PNG', MARGIN, y, imgW, imgH);
        y += imgH + 4;
      } catch (err) {
        console.warn(`[exportPDF] html2canvas falhou para tab ${tab.id}:`, err);
      }
    }

    drawFooter();
  }

  onProgress?.('Salvando PDF…');
  doc.save(config.filename || `relatorio-${Date.now()}.pdf`);
}
