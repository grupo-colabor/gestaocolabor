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
 * e ficam fora da soma comparada.
 *
 * Linha do Excel com `horasInformadas === false` (acompanhante sem horas): o
 * Excel imprime a pessoa com Horas em branco e amarela; o export tem de dizer
 * `Horas pagamento` em branco com origem "Acompanhante sem horas informadas".
 * É "sem-horas (ok)". Qualquer outra diferença é FALHA.
 *
 * O comparador é puro (reconcileExportacoesCore.ts) e roda também contra
 * fixtures em `npm run smoke:medicao-blocos` [13].
 *
 * Sai com código 1 se houver diferença não explicada pela borda.
 */
import { fetchMedicaoData } from '../services/medicaoExportService';
import { loadExportData } from '../services/exports/loadExportData';
import { buildMedicoesRows } from '../domain/exports/datasets/medicoes';
import { monthBounds } from '../services/medicaoWorkbook';
import { supabase } from '../lib/supabase';
import { compareExcelWithExport } from './reconcileExportacoesCore';

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

  // O comparador é puro (reconcileExportacoesCore.ts) e roda também contra
  // fixtures no smoke; aqui só busca os dois lados e imprime.
  const r = compareExcelWithExport(blocks, rows, start, end);
  for (const linha of r.log) console.log(linha);

  console.log('\nResumo por instrutor (Σ horas; export só das linhas sem borda):');
  for (const a of r.porInstrutor) {
    console.log(`  ${a.nome.padEnd(34)} Excel ${r2(a.excel).toString().padStart(8)}h   export ${r2(a.exportSemBorda).toString().padStart(8)}h   (borda: ${r2(a.borda)}h)`);
  }
  console.log(`\n  iguais: ${r.iguais}   borda (esperado): ${r.borda}   sem-horas (acompanhante): ${r.semHoras}   fora-do-dataset: ${r.foraDoDataset}   falhas: ${r.falhas}`);
  console.log(r.falhas === 0 ? '\n✅ RECONCILE EXPORTACOES: OK' : `\n❌ RECONCILE EXPORTACOES: ${r.falhas} diferença(s) não explicada(s)`);
  await supabase.auth.signOut();
  process.exit(r.falhas === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Erro inesperado:', e);
  process.exit(2);
});
