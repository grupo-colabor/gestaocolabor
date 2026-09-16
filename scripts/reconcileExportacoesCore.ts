/**
 * CONFERÊNCIA Exportações × Excel de pagamento — o comparador, puro
 *
 * Extraído de `reconcileExportacoes.ts` para rodar também contra FIXTURES no
 * smoke (smokeMedicaoBlocos [13]). O runner contra o banco só busca os dois
 * lados e chama `compareExcelWithExport`.
 *
 * Regras (as mesmas do cabeçalho do runner):
 *   • linha do Excel sem correspondente no export → "fora-do-dataset" (demanda
 *     sem medição aberta; escopo aprovado), não falha;
 *   • dias de pagamento atravessando a borda do mês → "borda (esperado)":
 *     o Excel rateia, o export não;
 *   • linha do Excel com `horasInformadas === false` (acompanhante sem horas):
 *     o Excel imprime a pessoa com Horas em branco; o export tem de dizer
 *     `Horas pagamento` em branco COM origem "Acompanhante sem horas
 *     informadas". Qualquer outra combinação com horas em branco é FALHA;
 *   • o resto compara as horas com tolerância de 0,005.
 */

export interface ExcelLinhaLike {
  demandId: string;
  horas: number | null;
  horasInformadas: boolean;
}

export interface ExcelBlocoLike {
  instructorId: string;
  nome: string;
  linhas: ExcelLinhaLike[];
}

export interface ExportRowLike {
  demand: { id: string };
  instructorId: string;
  horasPagamento: number | null;
  origemHoras: string;
  diasPagamento: string;
  elegivelPagamento: boolean;
}

export const ORIGEM_ACOMPANHANTE_SEM_HORAS = 'Acompanhante sem horas informadas';

export interface ReconcileResult {
  iguais: number;
  borda: number;
  semHoras: number;
  foraDoDataset: number;
  falhas: number;
  /** Uma linha de log por ocorrência, no formato do runner. */
  log: string[];
  porInstrutor: { nome: string; excel: number; exportSemBorda: number; borda: number }[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 'dd/mm/yyyy' | 'a a b' | 'a, b' → lista de 'YYYY-MM-DD'. */
export function diasDe(texto: string): string[] {
  const toIso = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
  if (texto.includes(' a ')) {
    const [a, b] = texto.split(' a ').map(toIso);
    return [a, b];
  }
  return texto.split(', ').map(toIso);
}
export function atravessaBorda(texto: string, start: string, end: string): boolean {
  return diasDe(texto).some(d => d < start || d > end);
}
export function tocaMes(texto: string, start: string, end: string): boolean {
  const ds = diasDe(texto);
  if (texto.includes(' a ')) return !(ds[1] < start || ds[0] > end);
  return ds.some(d => d >= start && d <= end);
}

export function compareExcelWithExport(
  blocks: ExcelBlocoLike[],
  rows: ExportRowLike[],
  start: string,
  end: string
): ReconcileResult {
  const exportPorChave = new Map(rows.map(r => [`${r.demand.id} ${r.instructorId}`, r]));
  const out: ReconcileResult = { iguais: 0, borda: 0, semHoras: 0, foraDoDataset: 0, falhas: 0, log: [], porInstrutor: [] };
  const porInstrutor = new Map<string, { nome: string; excel: number; exportSemBorda: number; borda: number }>();

  for (const b of blocks) {
    const acc = porInstrutor.get(b.instructorId) ?? { nome: b.nome, excel: 0, exportSemBorda: 0, borda: 0 };
    for (const linha of b.linhas) {
      const k = `${linha.demandId} ${b.instructorId}`;
      const ex = exportPorChave.get(k);

      // Acompanhante sem horas: a linha existe no Excel para a pessoa não sumir,
      // mas não tem horas a comparar. O export tem de concordar que não há
      // horas de pagamento E dizer o motivo certo — senão é divergência real.
      if (linha.horasInformadas === false) {
        if (ex && ex.horasPagamento === null && ex.origemHoras === ORIGEM_ACOMPANHANTE_SEM_HORAS) {
          out.semHoras++;
          out.log.push(`  sem-horas (ok)   ${k} — acompanhante sem horas informadas nos dois lados`);
        } else if (!ex) {
          out.foraDoDataset++;
          out.log.push(`  fora-do-dataset  ${k} — acompanhante sem horas em demanda sem linha em measurements`);
        } else {
          out.falhas++;
          out.log.push(`  FALHA            ${k} — Excel imprime linha SEM horas × export ${ex.horasPagamento ?? 'EM BRANCO'} (${ex.origemHoras})`);
        }
        continue;
      }

      const horasExcel = linha.horas ?? 0;
      acc.excel += horasExcel;
      if (!ex) {
        // Sem medição aberta a demanda não entra no dataset Medições — mas
        // entra no Excel (o rateio não exige medição). É escopo aprovado
        // (item 2), então conta como "fora do dataset", não como falha.
        out.foraDoDataset++;
        out.log.push(`  fora-do-dataset  ${k} — demanda sem linha em measurements (Excel: ${r2(horasExcel)}h)`);
        continue;
      }
      // Todos os dias de pagamento dentro do mês? Então o Excel não recortou.
      const diasTodosNoMes = ex.diasPagamento !== '' && !atravessaBorda(ex.diasPagamento, start, end);
      if (!diasTodosNoMes) {
        out.borda++;
        acc.borda += horasExcel;
        out.log.push(`  borda (esperado) ${k} — Excel ${r2(horasExcel)}h (recorte do mês) × export ${ex.horasPagamento ?? '—'}h (carga cheia)`);
        continue;
      }
      if (ex.horasPagamento === null || Math.abs(ex.horasPagamento - r2(horasExcel)) > 0.005) {
        out.falhas++;
        out.log.push(`  FALHA            ${k} — Excel ${r2(horasExcel)}h × export ${ex.horasPagamento ?? 'EM BRANCO'} (${ex.origemHoras})`);
      } else {
        out.iguais++;
        acc.exportSemBorda += ex.horasPagamento;
      }
    }
    porInstrutor.set(b.instructorId, acc);
  }

  // O caminho inverso: linha elegível no export, no mês, que o Excel não tem.
  for (const r of rows) {
    if (!r.elegivelPagamento || !r.diasPagamento) continue;
    if (!tocaMes(r.diasPagamento, start, end)) continue;
    const temNoExcel = blocks.some(b => b.instructorId === r.instructorId && b.linhas.some(l => l.demandId === r.demand.id));
    if (!temNoExcel) {
      out.falhas++;
      out.log.push(`  FALHA            ${r.demand.id} ${r.instructorId} — elegível no export (${r.horasPagamento}h) mas sem linha no Excel`);
    }
  }

  out.porInstrutor = [...porInstrutor.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  return out;
}
