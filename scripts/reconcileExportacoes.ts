/**
 * CONFERÊNCIA — Exportações × Excel de pagamento (contra o BANCO)
 *
 * Rodar com:  npm run reconcile:exportacoes
 *
 * Exige, no ambiente (nunca no repositório):
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (o .env do projeto já serve)
 *   RECONCILE_EMAIL / RECONCILE_PASSWORD        (um usuário admin do app)
 *   RECONCILE_MES=YYYY-MM                       (opcional; default = mês anterior)
 *
 * O runner (scripts/runReconcileExportacoes.cjs) injeta `import.meta.env`
 * para os services do app rodarem em Node; as leituras são as MESMAS do app
 * (fetchAllPaginated, RLS do usuário logado). Só leitura, nenhuma escrita.
 *
 * O que compara, para o mês fechado:
 *   • EXCEL: `fetchMedicaoData(inicio, fim)` — os blocos que alimentam a aba
 *     Resumo (horas por instrutor, recortadas pelos dias dentro do mês);
 *   • EXPORT: `buildMedicoesRows` sobre `loadExportData` — coluna
 *     `Horas pagamento` (carga cheia da pessoa na demanda, sem recorte).
 *
 * Os dois só podem ser iguais quando TODOS os dias de pagamento da pessoa na
 * demanda caem dentro do mês. Demanda que atravessa a borda entra no Excel
 * proporcionalmente e no export inteira — é o comportamento aprovado (o
 * export não rateia), então essas linhas são listadas como "borda (esperado)"
 * e ficam fora da soma comparada. Qualquer outra diferença é FALHA.
 *
 * Sai com código 1 se houver diferença não explicada pela borda.
 */
import { fetchMedicaoData } from '../services/medicaoExportService';
import { loadExportData } from '../services/exports/loadExportData';
import { buildMedicoesRows } from '../domain/exports/datasets/medicoes';
import { monthBounds } from '../services/medicaoWorkbook';
import { supabase } from '../lib/supabase';

function mesAlvo(): { year: number; month: number } {
  const env = process.env.RECONCILE_MES;
  if (env && /^\d{4}-\d{2}$/.test(env)) {
    const [y, m] = env.split('-').map(Number);
    return { year: y, month: m };
  }
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function main() {
  const email = process.env.RECONCILE_EMAIL;
  const password = process.env.RECONCILE_PASSWORD;
  if (!email || !password) {
    console.error('Defina RECONCILE_EMAIL e RECONCILE_PASSWORD no ambiente (usuário admin do app).');
    process.exit(2);
  }

  // Login no MESMO cliente que os services usam (lib/supabase), para as
  // leituras passarem pela RLS do usuário — igual ao navegador.
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error('Falha no login:', authError.message);
    process.exit(2);
  }

  const { year, month } = mesAlvo();
  const { start, end } = monthBounds(year, month);
  console.log(`\nConferência Exportações × Excel de pagamento — ${String(month).padStart(2, '0')}/${year} (${start} a ${end})\n`);

  const [blocks, data] = await Promise.all([
    fetchMedicaoData(start, end),
    loadExportData({ includeLogistics: false }),
  ]);
  const rows = buildMedicoesRows(data);
  const exportPorChave = new Map(rows.map(r => [`${r.demand.id} ${r.instructorId}`, r]));

  let falhas = 0;
  let borda = 0;
  let iguais = 0;
  const porInstrutor = new Map<string, { nome: string; excel: number; exportSemBorda: number; borda: number }>();

  for (const b of blocks) {
    const acc = porInstrutor.get(b.instructorId) ?? { nome: b.nome, excel: 0, exportSemBorda: 0, borda: 0 };
    for (const linha of b.linhas) {
      acc.excel += linha.horas;
      const k = `${linha.demandId} ${b.instructorId}`;
      const ex = exportPorChave.get(k);
      if (!ex) {
        // Sem medição aberta a demanda não entra no dataset Medições — mas
        // entra no Excel (o rateio não exige medição). É escopo aprovado
        // (item 2), então conta como "fora do dataset", não como falha.
        console.log(`  fora-do-dataset  ${k} — demanda sem linha em measurements (Excel: ${r2(linha.horas)}h)`);
        continue;
      }
      // Todos os dias de pagamento dentro do mês? Então o Excel não recortou.
      const diasTodosNoMes = ex.diasPagamento !== '' && !atravessaBorda(ex.diasPagamento, start, end);
      if (!diasTodosNoMes) {
        borda++;
        acc.borda += linha.horas;
        console.log(`  borda (esperado) ${k} — Excel ${r2(linha.horas)}h (recorte do mês) × export ${ex.horasPagamento ?? '—'}h (carga cheia)`);
        continue;
      }
      if (ex.horasPagamento === null || Math.abs(ex.horasPagamento - r2(linha.horas)) > 0.005) {
        falhas++;
        console.log(`  FALHA            ${k} — Excel ${r2(linha.horas)}h × export ${ex.horasPagamento ?? 'EM BRANCO'} (${ex.origemHoras})`);
      } else {
        iguais++;
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
      falhas++;
      console.log(`  FALHA            ${r.demand.id} ${r.instructorId} — elegível no export (${r.horasPagamento}h) mas sem linha no Excel`);
    }
  }

  console.log('\nResumo por instrutor (Σ horas; export só das linhas sem borda):');
  for (const [, a] of [...porInstrutor.entries()].sort((x, y) => x[1].nome.localeCompare(y[1].nome, 'pt-BR'))) {
    console.log(`  ${a.nome.padEnd(34)} Excel ${r2(a.excel).toString().padStart(8)}h   export ${r2(a.exportSemBorda).toString().padStart(8)}h   (borda: ${r2(a.borda)}h)`);
  }
  console.log(`\n  iguais: ${iguais}   borda (esperado): ${borda}   falhas: ${falhas}`);
  console.log(falhas === 0 ? '\n✅ RECONCILE EXPORTACOES: OK' : `\n❌ RECONCILE EXPORTACOES: ${falhas} diferença(s) não explicada(s)`);
  await supabase.auth.signOut();
  process.exit(falhas === 0 ? 0 : 1);
}

/** 'dd/mm/yyyy' | 'a a b' | 'a, b' → lista de 'YYYY-MM-DD'. */
function diasDe(texto: string): string[] {
  const toIso = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
  if (texto.includes(' a ')) {
    const [a, b] = texto.split(' a ').map(toIso);
    return [a, b];
  }
  return texto.split(', ').map(toIso);
}
function atravessaBorda(texto: string, start: string, end: string): boolean {
  return diasDe(texto).some(d => d < start || d > end);
}
function tocaMes(texto: string, start: string, end: string): boolean {
  const ds = diasDe(texto);
  if (texto.includes(' a ')) return !(ds[1] < start || ds[0] > end);
  return ds.some(d => d >= start && d <= end);
}

main().catch(e => {
  console.error('Erro inesperado:', e);
  process.exit(2);
});
