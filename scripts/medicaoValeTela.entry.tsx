/**
 * Corpo do smoke:medicao-vale-tela (ver scripts/smokeMedicaoValeTela.ts).
 * A fixture é a [TT] do smoke da Medição Vale (scripts/smokeMedicaoValeDatasets.ts):
 * turmas Vale de cada caso da regra "todas as turmas do período" — duas não
 * concluídas (DEM-605 em andamento, DEM-607 EAD futura) e uma cancelada.
 */
import { win } from './telaDom';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MedicaoTemplateView from '../components/exportacoes/MedicaoTemplateView';
import { MEDICAO_VALE_DATASET, VALE_BM_DATASET } from '../domain/exports/registry';
import { DEFAULT_OPTIONS, type ExportOptions } from '../domain/exports/options';
import { buildMedicaoValeRows, confirmacaoNaoConcluidas } from '../domain/exports/datasets/medicaoVale';
import { buildTodasTurmasFixture, TT_VALUE_ROWS, HOJE } from './smokeMedicaoValeDatasets';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);

/* ────────────────────────── carga da tela ────────────────────────── */
const src = buildTodasTurmasFixture();
function cargaDe(over: Record<string, unknown> = {}): any {
  return {
    demands: src.demands,
    measurements: src.measurements,
    trainings: src.trainings,
    instructors: src.instructors.map((i: any) => ({ ...i, uf: 'MG' })),
    companies: src.companies,
    instructorAllocations: src.instructorAllocations,
    participants: [], companions: [], logisticBlocks: [], documentFlags: [], logisticAllocations: [],
    locationAssociations: [],
    templateValues: TT_VALUE_ROWS,
    templateIds: ['vale-v1'],
    // O relógio da fixture (15/09/2026): é por ele que 605 e 607 ainda não concluíram.
    now: HOJE,
    ...over,
  };
}

/* ────────────────────────── harness ────────────────────────── */
const container = win.document.createElement('div');
win.document.body.appendChild(container);
const root = createRoot(container as any);
const notificacoes: [string, string][] = [];
let confirmacoes: string[] = [];
let respostas: boolean[] = [];
(win as any).confirm = (msg: string) => { confirmacoes.push(msg); return respostas.shift() ?? false; };

function render(dataset: any, carga: any, options: ExportOptions = DEFAULT_OPTIONS) {
  act(() => {
    root.render(
      <MedicaoTemplateView
        // Trocar de módulo monta a tela do zero (estado de erro/geração não vaza de um teste para o outro).
        key={dataset.key}
        dataset={dataset}
        carga={carga}
        options={options}
        onOptionsChange={() => {}}
        corredoresBase={[]}
        regionNameById={new Map()}
        onNotify={(m, t) => notificacoes.push([t, m])}
      />
    );
  });
}
const texto = () => (container.textContent ?? '').replace(/\s+/g, ' ');
const barra = (rotulo: string) => {
  const el = Array.from(container.querySelectorAll('span')).find(s => s.textContent === rotulo);
  return (el?.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
};
const botaoGerar = () => Array.from(container.querySelectorAll('button')).find(b => /^Gerar /.test((b.textContent ?? '').trim())) as any;
async function clicarGerar() {
  await act(async () => { botaoGerar()?.click(); await new Promise(r => setTimeout(r, 0)); });
}
/** Linhas da prévia da planilha: [marca, A, B, …] — a 1ª célula é a coluna só da tela. */
const linhasPrevia = () =>
  Array.from(container.querySelectorAll('table tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')) as any[]);

async function main() {
  /* ── Medição Vale ── */
  console.log('\n[TELA] Medição Vale — todas as turmas do período');
  {
    const carga = cargaDe();
    render(MEDICAO_VALE_DATASET, carga);

    // 11 turmas Vale: 606 cancelada (fora do recorte por padrão); as outras 10 entram.
    eq('barra: total na planilha, SEM "de N no recorte" quando nada fica fora', barra('Turmas na planilha'), 'Turmas na planilha10');
    check('nenhum "no recorte" na tela', !/no recorte/.test(texto()));

    check('aviso acima da prévia: "2 turmas ainda não concluídas entram nesta planilha"', texto().includes('2 turmas ainda não concluídas entram nesta planilha'));
    const itens = Array.from(container.querySelectorAll('[role="status"] li')).map(li => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
    eq('lista do aviso: DEM, treinamento, data de término, status', itens, [
      'DEM-605NR 35 Trabalho em Altura· termina 18/09/2026· Em Andamento',
      'DEM-607NR 20 Básico EAD· termina 17/09/2026· Alocada',
    ]);
    const aviso = Array.from(container.querySelectorAll('[role="status"]')).find(e => /ainda não concluídas/.test(e.textContent ?? ''));
    const previa = Array.from(container.querySelectorAll('div')).find(d => /^Prévia — aba/.test((d.textContent ?? '').trim()));
    check('o aviso vem ANTES da prévia na página', !!aviso && !!previa && !!(aviso.compareDocumentPosition(previa as any) & 4 /* FOLLOWING */));

    const linhas = linhasPrevia();
    const marcadas = linhas.filter(tds => /não concluída/.test(tds[0]?.textContent ?? '')).map(tds => tds[2]?.textContent);
    eq('marca na linha da prévia: só as duas não concluídas (pelo ID da coluna B)', marcadas, ['SAP-605', 'SAP-607']);
    const daDemanda = (sap: string) => linhas.find(tds => tds[2]?.textContent === sap)!;
    // Consultor = coluna S = 19ª coluna do modelo → td[19] (a td[0] é a marca).
    check('prévia: Consultor da presencial sem titular (603) amarelo', /bg-yellow-100/.test(daDemanda('SAP-603')[19]?.className ?? ''));
    check('prévia: Consultor da online EAD sem titular (600) NÃO amarelo', !/bg-yellow-100/.test(daDemanda('SAP-600')[19]?.className ?? ''));

    check('painel: "0 fora da planilha" — nada do recorte fica fora', /demandas com pendência — 0 fora da planilha, \d+ na planilha com aviso\./.test(texto()));

    // Gerar: pergunta antes, listando as turmas; "Cancelar" não gera nada.
    confirmacoes = []; respostas = [false];
    await clicarGerar();
    const esperado = confirmacaoNaoConcluidas(buildMedicaoValeRows({ ...src, template: MEDICAO_VALE_DATASET.template }));
    eq('Gerar pede confirmação com a lista das não concluídas', confirmacoes, [esperado]);
    check('e o texto termina em "gerar mesmo assim?"', /Ainda não concluídas — gerar mesmo assim\?$/.test(confirmacoes[0] ?? ''));
    check('cancelar não gera (nenhuma notificação, nenhum erro)', notificacoes.length === 0 && !/Bloqueado/.test(texto()));

    // Com "Incluir canceladas": a cancelada entra no recorte e fica fora da planilha.
    render(MEDICAO_VALE_DATASET, carga, { ...DEFAULT_OPTIONS, incluirCanceladas: true });
    eq('com cancelada no recorte: "10 de 11 no recorte"', barra('Turmas na planilha'), 'Turmas na planilha10 de 11 no recorte');
    check('painel: "1 fora da planilha" (a cancelada)', /— 1 fora da planilha, \d+ na planilha com aviso\./.test(texto()));
    check('a cancelada não entra na prévia', !linhasPrevia().some(tds => tds[2]?.textContent === 'SAP-606'));
  }
  {
    // Sem turma não concluída (relógio depois de tudo): sem aviso, sem marca, sem pergunta.
    render(MEDICAO_VALE_DATASET, cargaDe({ now: new Date('2026-12-31T12:00:00') }));
    check('tudo concluído: sem o aviso de não concluídas', !texto().includes('ainda não concluída'));
    check('tudo concluído: nenhuma marca na prévia', !linhasPrevia().some(tds => /não concluída/.test(tds[0]?.textContent ?? '')));
    confirmacoes = []; respostas = [];
    await clicarGerar();
    eq('tudo concluído: Gerar não pergunta nada', confirmacoes, []);
  }

  /* ── BM ── */
  console.log('\n[TELA] BM Vale — todas as turmas do período');
  {
    const cargaBm = cargaDe({ templateIds: ['vale-v1', 'vale-bm-v1'] });
    render(VALE_BM_DATASET, cargaBm);
    // Todas em Sudeste | Brucutu; corredor "Todos" no filtro.
    eq('barra: total no BM, sem "de N no recorte" quando nada fica fora', barra('Turmas no BM'), 'Turmas no BM10');
    check('aviso acima da prévia: "2 turmas ainda não concluídas entram no BM"', texto().includes('2 turmas ainda não concluídas entram no BM'));
    const itensBm = Array.from(container.querySelectorAll('[role="status"] li')).map(li => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
    eq('lista do aviso do BM', itensBm, [
      'DEM-605NR 35 Trabalho em Altura· termina 18/09/2026· Em Andamento',
      'DEM-607NR 20 Básico EAD· termina 17/09/2026· Alocada',
    ]);
    const marcaMina = Array.from(container.querySelectorAll('span')).find(s => /^\d+ não concluídas?$/.test(s.textContent ?? ''));
    eq('marca na prévia da mina: "2 não concluídas", com os DEM no title', [marcaMina?.textContent, marcaMina?.getAttribute('title')], ['2 não concluídas', 'Ainda não concluídas: DEM-605, DEM-607']);
    check('painel do BM: "0 fora do BM"', /demandas com pendência — 0 fora do BM, \d+ no BM com aviso\./.test(texto()));

    // Gerar: primeiro as não concluídas; cancelar para ali.
    confirmacoes = []; respostas = [false];
    await clicarGerar();
    const turmasBm = buildMedicaoValeRows({ ...src, template: MEDICAO_VALE_DATASET.template });
    eq('Gerar BM pergunta das não concluídas (e para no "Cancelar")', confirmacoes, [confirmacaoNaoConcluidas(turmasBm, 'BM')]);
    // Aceitando: depois vem a pergunta do cabeçalho incompleto (a fixture não tem cabeçalho) — as duas, nesta ordem.
    confirmacoes = []; respostas = [true, false];
    await clicarGerar();
    eq('aceitando, vem a do cabeçalho incompleto — as duas, nesta ordem',
      [confirmacoes.length, /entram no BM/.test(confirmacoes[0] ?? ''), confirmacoes[1]], [2, true, 'Cabeçalho incompleto para Sudeste | Brucutu — gerar mesmo assim?']);
    check('nada gerado (cancelou no cabeçalho)', notificacoes.length === 0);
  }

  act(() => root.unmount());
  console.log(falhas === 0 ? '\n✅ SMOKE MEDIÇÃO VALE — TELA: OK' : `\n❌ SMOKE MEDIÇÃO VALE — TELA: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
