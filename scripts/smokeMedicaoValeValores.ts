/**
 * SMOKE — Medição Vale: bloco [W] gravação dos valores manuais (upsert × delete)
 *
 * Chamado por smokeMedicaoVale.ts. Campo esvaziado que tinha valor salvo vira
 * DELETE da linha (mesma chave); campo que nunca existiu e continua vazio não
 * toca o banco. Roda o plano do domínio contra um gateway em MEMÓRIA que
 * imita a tabela (chave única, upsert, delete) e conta as chamadas. Vale para
 * os três escopos: por treinamento, por turma e cabeçalho do BM.
 */
import {
  applyTemplateValueWrites,
  indexTemplateValues,
  isTemplateValueEmpty,
  planTemplateValueWrites,
  getTemplateValue,
  contextKey,
  type TemplateValueEdit,
  type TemplateValueGateway,
  type TemplateValueLike,
} from '../domain/exports/templates/values';
import type { ValeSmokeTools } from './smokeMedicaoValeDatasets';

type Row = TemplateValueLike & { id: string; template_id: string };

/** Tabela em memória com a mesma chave da UNIQUE NULLS NOT DISTINCT da 018. */
function bancoFake(templateId: string) {
  const linhas = new Map<string, Row>();
  const chamadas = { upsert: 0, deleteByKey: 0 };
  const chave = (k: { scope: string; refId: string; columnKey: string }) => `${templateId}:${k.scope}:${k.refId}:${k.columnKey}`;
  const gateway: TemplateValueGateway<Row> = {
    upsert: async items => {
      chamadas.upsert += 1;
      return items.map(i => {
        const row: Row = {
          id: chave(i), template_id: templateId, scope: i.scope, column_key: i.columnKey,
          training_id: i.scope === 'training' ? i.refId : null,
          demand_id: i.scope === 'demand' ? i.refId : null,
          context_key: i.scope === 'context' ? i.refId : null,
          value: i.value,
        };
        linhas.set(chave(i), row);
        return row;
      });
    },
    deleteByKey: async key => {
      chamadas.deleteByKey += 1;
      if (!linhas.delete(chave(key))) throw new Error('nenhuma linha excluída (fake)');
    },
  };
  return { gateway, chamadas, rows: () => [...linhas.values()], index: () => indexTemplateValues([...linhas.values()]) };
}

export async function runValoresChecks(t: ValeSmokeTools): Promise<number> {
  let falhas = 0;
  const check: ValeSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: ValeSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };

  console.log('\n[W] Valores manuais: campo esvaziado vira DELETE, nunca upsert com null');

  /* ---- vazio ---- */
  eq('null é vazio', isTemplateValueEmpty(null), true);
  eq('"" é vazio', isTemplateValueEmpty(''), true);
  eq('"   " é vazio', isTemplateValueEmpty('   '), true);
  eq('0 NÃO é vazio (preço zero é decisão)', isTemplateValueEmpty(0), false);
  eq('"x" não é vazio', isTemplateValueEmpty('x'), false);

  const CTX = contextKey('Sudeste', 'Brucutu');
  const cenarios: { rotulo: string; scope: TemplateValueEdit['scope']; refId: string; columnKey: string; valor: number | string }[] = [
    { rotulo: 'por treinamento (preço HH)', scope: 'training', refId: 'T_PRE', columnKey: 'precoHH', valor: 120 },
    { rotulo: 'por turma (preço sobrescrito)', scope: 'demand', refId: 'DEM-100', columnKey: 'precoHH', valor: 130 },
    { rotulo: 'cabeçalho do BM (contrato)', scope: 'context', refId: CTX, columnKey: 'contrato', valor: '5900123435' },
  ];

  for (const c of cenarios) {
    const db = bancoFake('tpl');
    const edit = (value: number | string | null): TemplateValueEdit => ({ scope: c.scope, refId: c.refId, columnKey: c.columnKey, value });

    // 1) salvar valor
    const p1 = planTemplateValueWrites([edit(c.valor)], db.index());
    eq(`${c.rotulo}: valor novo → 1 upsert, 0 delete`, [p1.upserts.length, p1.deletes.length, p1.ignorados], [1, 0, 0]);
    const r1 = await applyTemplateValueWrites(p1, db.gateway);
    eq(`${c.rotulo}: gravado (leitura de volta traz a chave)`, getTemplateValue(db.index(), c.scope, c.refId, c.columnKey), c.valor);
    eq(`${c.rotulo}: 1 gravado no resultado`, r1.gravados.length, 1);

    // 2) limpar → salvar: DELETE pela chave
    const p2 = planTemplateValueWrites([edit(null)], db.index());
    eq(`${c.rotulo}: esvaziado com linha salva → 0 upsert, 1 delete`, [p2.upserts.length, p2.deletes.length, p2.ignorados], [0, 1, 0]);
    const r2 = await applyTemplateValueWrites(p2, db.gateway);
    eq(`${c.rotulo}: a leitura de volta NÃO traz mais a chave`, getTemplateValue(db.index(), c.scope, c.refId, c.columnKey), undefined);
    eq(`${c.rotulo}: nenhuma linha com value null ficou para trás`, db.rows().some(r => r.value === null), false);
    eq(`${c.rotulo}: 1 apagado no resultado, chave certa`, r2.apagados[0]?.columnKey, c.columnKey);
    eq(`${c.rotulo}: chamadas ao banco = 1 upsert + 1 delete`, db.chamadas, { upsert: 1, deleteByKey: 1 });

    // 3) limpar algo que nunca existiu: NÃO chama o banco
    const antes = { ...db.chamadas };
    const p3 = planTemplateValueWrites([edit('')], db.index());
    eq(`${c.rotulo}: esvaziar o que nunca existiu → ignorado, sem upsert nem delete`, [p3.upserts.length, p3.deletes.length, p3.ignorados], [0, 0, 1]);
    await applyTemplateValueWrites(p3, db.gateway);
    eq(`${c.rotulo}: e o banco não foi chamado`, db.chamadas, antes);
  }

  /* ---- misto num Salvar só: um valor novo, um esvaziado, um nunca existente, um zero ---- */
  {
    const db = bancoFake('tpl');
    await applyTemplateValueWrites(planTemplateValueWrites([
      { scope: 'training', refId: 'T_A', columnKey: 'precoHH', value: 100 },
      { scope: 'demand', refId: 'DEM-1', columnKey: 'obs', value: 'antiga' },
    ], db.index()), db.gateway);
    const plan = planTemplateValueWrites([
      { scope: 'training', refId: 'T_B', columnKey: 'precoHH', value: 90 },       // novo
      { scope: 'demand', refId: 'DEM-1', columnKey: 'obs', value: '' },           // esvaziado (texto '')
      { scope: 'context', refId: CTX, columnKey: 'gestor', value: null },         // nunca existiu
      { scope: 'training', refId: 'T_A', columnKey: 'precoHH', value: 0 },        // zero: é valor, upsert
    ], db.index());
    eq('misto: 2 upserts (novo e zero), 1 delete (texto esvaziado), 1 ignorado', [plan.upserts.length, plan.deletes.length, plan.ignorados], [2, 1, 1]);
    await applyTemplateValueWrites(plan, db.gateway);
    eq('misto: T_A vale 0, T_B vale 90, DEM-1/obs sumiu', [
      getTemplateValue(db.index(), 'training', 'T_A', 'precoHH'),
      getTemplateValue(db.index(), 'training', 'T_B', 'precoHH'),
      getTemplateValue(db.index(), 'demand', 'DEM-1', 'obs'),
    ], [0, 90, undefined]);
    eq('misto: os 2 upserts numa chamada só + 1 delete', db.chamadas, { upsert: 2, deleteByKey: 1 });
  }

  /* ---- linha legada gravada com null: esvaziar apaga (limpa o legado) ---- */
  {
    const db = bancoFake('tpl');
    await db.gateway.upsert([{ scope: 'demand', refId: 'DEM-9', columnKey: 'precoHH', value: null }]);
    const plan = planTemplateValueWrites([{ scope: 'demand', refId: 'DEM-9', columnKey: 'precoHH', value: null }], db.index());
    eq('legado com value null: esvaziar vira delete (a chave existe no índice)', plan.deletes.length, 1);
  }

  /* ---- erro de delete sobe (banner) e interrompe ---- */
  {
    const gateway: TemplateValueGateway<Row> = {
      upsert: async () => [],
      deleteByKey: async () => { throw new Error('RLS: nenhuma linha excluída'); },
    };
    const plan = { upserts: [], deletes: [{ scope: 'training' as const, refId: 'T', columnKey: 'precoHH' }], ignorados: 0 };
    let erro: string | null = null;
    try { await applyTemplateValueWrites(plan, gateway); } catch (e: any) { erro = String(e?.message ?? e); }
    check('erro de delete propaga (o Salvar mostra no banner, como o upsert)', erro !== null && /RLS/.test(erro!));
  }

  /* ---- guardas de fonte: service e tela ---- */
  const svc = t.ler('services/exports/templateValues.ts');
  check('service: delete pela chave lógica com .is(null) nas referências fora do escopo',
    svc.includes("q.eq('training_id', key.refId) : q.is('training_id', null)") &&
      svc.includes("q.eq('demand_id', key.refId) : q.is('demand_id', null)") &&
      svc.includes("q.eq('context_key', key.refId) : q.is('context_key', null)"));
  check('service: 0 linhas apagadas é erro (RLS), como no upsert', svc.includes('Valor não apagado'));
  check('service: saveTemplateValues recusa valor vazio (nunca upsert com null)', svc.includes('saveTemplateValues recebeu valor vazio'));
  check('service: persistTemplateValueWrites executa o plano do domínio', svc.includes('return applyTemplateValueWrites(plan, supabaseTemplateValueGateway(templateId));'));
  const view = t.ler('components/exportacoes/MedicaoTemplateView.tsx');
  check('tela: o Salvar planeja pelo domínio sobre o que está salvo DESTE template',
    view.includes('const plan = planTemplateValueWrites(items, salvosDoTemplate);') &&
      view.includes('indexTemplateValues(valoresSalvos.filter(r => r.template_id === id))'));
  check('tela: grava pelo persist (upsert + delete), não pelo saveTemplateValues direto',
    view.includes('await persistTemplateValueWrites(id, plan)') && !view.includes('saveTemplateValues('));
  check('tela: apagados saem do estado salvo (a chave some da leitura local)', view.includes('porChave.delete(`${a.templateId}:${a.key.scope}:${a.key.refId}:${a.key.columnKey}`)'));
  check('tela: erro (upsert ou delete) vai para o banner', /catch \(e: any\) \{\s*setErro\(`Falha ao salvar/.test(view));

  return falhas;
}
