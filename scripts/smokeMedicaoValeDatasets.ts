/**
 * SMOKE — Medição Vale: blocos [D] dataset, [X] escritor, [P] painel.
 * Chamado por smokeMedicaoVale.ts.
 */
import { computePanelExpenseBreakdown, isNaoReembolsavel } from '../domain/measurementTotals';
import {
  buildMedicaoValeRows,
  toRowsSheetInput,
  matchesTemplateCompany,
  turmasComecaramAntes,
  avisoComecaramAntes,
  avisoTurmaComecouAntes,
} from '../domain/exports/datasets/medicaoVale';
import { getDemandLastDay } from '../domain/demandDays';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { resolveRowsSheet } from '../domain/exports/templates/resolve';
import { indexTemplateValues, emptyTemplateValuesIndex } from '../domain/exports/templates/values';
import { applyFilters, buildFilterOptions, MEDICAO_STATUS_OPTIONS } from '../domain/exports/filters';
import { EMPTY_FILTERS, SEM_MEDICAO } from '../domain/exports/types';
import { DEFAULT_OPTIONS } from '../domain/exports/options';
import { buildTrainingsById } from '../domain/modalityOptions';

export interface ValeSmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
  ler: (rel: string) => string;
  semComentarios: (src: string) => string;
  fixtures: any;
}

/* ────────────────────────── fixtures compartilhadas ────────────────────────── */
export const HOJE = new Date('2026-09-15T12:00:00');
export const TRAININGS: any[] = [
  { id: 'T_PRE', name: 'NR 35 Trabalho em Altura', hours: 16, practicalHours: null, modality: 'PRESENCIAL' },
  { id: 'T_HIB', name: 'NR 20 Intermediário', hours: 40, practicalHours: 8, modality: 'HIBRIDO' },
];
export const COMPANIES = [
  { id: 'C_VALE', name: 'Vale S.A.' },
  { id: 'C_NEXA', name: 'NEXA' },
];
export const INSTRUCTORS = [
  { id: 'INS-T', name: 'Titular' },
  { id: 'INS-2', name: 'Segundo' },
];
export const demandaVale = (over: any = {}): any => ({
  id: 'DEM-100', tipo: 'cliente', companyId: 'C_VALE', trainingId: 'T_PRE', regionId: 'MG',
  trainingLocal: 'Brucutu', demandState: 'MG', corredor: 'Sudeste', clientDemandId: 'SAP-' + String(over.id ?? 'DEM-100').replace('DEM-', ''),
  modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00',
  status: 'ALOCADA', instructorId: 'INS-T', ...over,
});
export const medicao = (demandId: string, over: any = {}): any => ({
  id: `MEA-${demandId}`, demandId, status: 'PRONTA_FATURAMENTO', updatedAt: '2026-08-12',
  expenses: { classHours: 16, hourRate: 100 }, attachments: [], otherExpenses: [], ...over,
});

export function buildValeFixtureSource() {
  const demands = [
    demandaVale(),                                                                        // concluída, pronta
    demandaVale({ id: 'DEM-101', clientDemandId: '', trainingLocal: 'Timbopeba', corredor: 'Sudeste' }), // sem ID SAP
    demandaVale({ id: 'DEM-102', trainingId: 'T_HIB', startDate: '2026-08-20T13:00', endDate: '2026-08-22T18:00', dateMode: 'DIAS_ESPECIFICOS',
      specificDates: [{ data: '2026-08-22', horarioInicio: '14:00', horarioFim: '18:00' }, { data: '2026-08-20', horarioInicio: '13:00', horarioFim: '18:00' }] }), // híbrida, dias específicos
    demandaVale({ id: 'DEM-103', startDate: '2026-12-01T08:00', endDate: '2026-12-02T17:00' }),     // futura
    demandaVale({ id: 'DEM-104', status: 'CANCELADA' }),                                            // cancelada
    demandaVale({ id: 'DEM-105', instructorId: undefined }),                                        // sem titular
    demandaVale({ id: 'DEM-106', companyId: 'C_NEXA' }),                                            // outra empresa
    demandaVale({ id: 'DEM-107', tipo: 'interna', trainingId: '', categoriaInterna: 'SIPAT', descricaoInterna: 'Palestra', horasPrevistas: 4 }), // interna Vale
    demandaVale({ id: 'DEM-108', startDate: '2026-09-01T08:00', endDate: '2026-09-02T17:00', corredor: 'Ferrovia/MG' }), // sem medição, setembro
  ];
  const measurements = [
    medicao('DEM-100', { attachments: [
      { id: 'a1', category: 'LOCOMOCAO', value: 80 },
      { id: 'a2', category: 'ALMOCO', value: 50 },
      { id: 'a3', category: 'JANTAR', value: 30, reembolsavel: false },
      { id: 'a4', category: 'HOSPEDAGEM', value: 200 },
      { id: 'a5', category: 'OUTROS', value: 25, otherId: 'O1' },
      { id: 'a6', category: 'OUTROS', value: 5, otherId: 'ZZ' },
    ], otherExpenses: [{ id: 'O1', description: 'Pedágio', value: '' }] }),
    medicao('DEM-101', { status: 'LANCAMENTO' }),
    medicao('DEM-102', { status: 'NAO_INICIADA' }),
    medicao('DEM-104'),
  ];
  const instructorAllocations: any[] = [
    { id: 'A1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
    { id: 'A2', demandId: 'DEM-100', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A3', demandId: 'DEM-101', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A4', demandId: 'DEM-102', instructorId: 'INS-T', startDate: '2026-08-20T13:00', endDate: '2026-08-22T18:00' },
    { id: 'A5', demandId: 'DEM-103', instructorId: 'INS-T', startDate: '2026-12-01T08:00', endDate: '2026-12-02T17:00' },
    { id: 'A6', demandId: 'DEM-108', instructorId: 'INS-T', startDate: '2026-09-01T08:00', endDate: '2026-09-02T17:00' },
  ];
  const templateValues = indexTemplateValues([
    { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120 },
    { scope: 'demand', column_key: 'precoHH', training_id: null, demand_id: 'DEM-101', value: 150 },
    { scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-100', value: 45 },
    { scope: 'demand', column_key: 'observacao', training_id: null, demand_id: 'DEM-100', value: 'Turma extra' },
  ]);
  return {
    template: VALE_TEMPLATE, demands, measurements, trainings: TRAININGS, instructors: INSTRUCTORS,
    companies: COMPANIES, instructorAllocations, templateValues, now: HOJE,
  };
}

export function runValeDatasetChecks(t: ValeSmokeTools): number {
  let falhas = 0;
  const check: ValeSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: ValeSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };
  const perto: ValeSmokeTools['perto'] = (n, a, b) => { if (!(Math.abs(a - b) < 1e-6)) falhas++; t.perto(n, a, b); }; // NaN-safe

  const src = buildValeFixtureSource();
  const rows = buildMedicaoValeRows(src);
  const de = (id: string) => rows.find(r => r.demand.id === id)!;

  /* ────────────────────────────────────────────────────────────────────────
   * [D] Dataset
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n[D] Dataset Medição Vale');
  {
    eq('só demandas da Vale (NEXA fora), inclusive interna com empresa Vale, em ordem de data de início',
      rows.map(r => r.demand.id), ['DEM-100', 'DEM-101', 'DEM-104', 'DEM-105', 'DEM-107', 'DEM-102', 'DEM-108', 'DEM-103']);
    check('NEXA não entra', !rows.some(r => r.demand.id === 'DEM-106'));
    check('interna com empresa Vale entra na lista com bloqueio', de('DEM-107') && de('DEM-107').bloqueios.some(b => /interna/i.test(b)));
    check('empresa casa por nome, como o formulário', matchesTemplateCompany({ nameIncludes: 'VALE' }, { id: 'x', name: 'vale s.a.' }) && !matchesTemplateCompany({ nameIncludes: 'VALE' }, { id: 'y', name: 'NEXA' }));
    check('empresa casa por id quando informado', matchesTemplateCompany({ id: 'C_VALE' }, { id: 'C_VALE', name: 'qualquer' }));
    eq('ordem por data de início', rows.map(r => r.input.dataInicio), [...rows.map(r => r.input.dataInicio)].sort());

    eq('elegíveis para a aba Turmas = concluídas com titular (100, 101, 102)', rows.filter(r => r.elegivelTurmas).map(r => r.demand.id), ['DEM-100', 'DEM-101', 'DEM-102', 'DEM-108']);
    eq('futura -> não concluída', de('DEM-103').bloqueios, ['Demanda não concluída (Alocada)']);
    eq('cancelada -> bloqueio', de('DEM-104').bloqueios, ['Demanda cancelada']);
    eq('sem titular -> bloqueio', de('DEM-105').bloqueios, ['Sem instrutor titular']);
    check('status da medição NÃO bloqueia (LANCAMENTO e NAO_INICIADA entram)', de('DEM-101').elegivelTurmas && de('DEM-102').elegivelTurmas);
    check('sem medição NÃO bloqueia', de('DEM-108').elegivelTurmas && !de('DEM-108').input.temMedicao);

    // Despesas: reembolsáveis por bucket = quebra do painel com itemFilter; jantar não reembolsável fora.
    const m = src.measurements[0];
    const esperado = computePanelExpenseBreakdown(m, { itemFilter: a => !isNaoReembolsavel(a) });
    const d100 = de('DEM-100').input.despesas;
    perto('locomoção reembolsável', d100.locomocao, esperado.locomocao);
    perto('alimentação reembolsável (jantar de 30 fora)', d100.alimentacao, 50);
    perto('hospedagem', d100.hospedagem, 200);
    perto('outros (órfão fora)', d100.outros, 25);
    perto('total reembolsável = soma dos quatro', d100.total, 80 + 50 + 200 + 25);
    perto('excluído por não reembolsável = 30', de('DEM-100').naoReembolsavelExcluido, 30);
    perto('total cheio como o painel', de('DEM-100').despesasTotalTodas, computePanelExpenseBreakdown(m).total);
    eq('sem medição -> despesas zero', de('DEM-108').input.despesas.total, 0);

    eq('consultor: dois titulares', de('DEM-100').input.titulares, ['Titular', 'Segundo']);
    eq('carga = training.hours (híbrida 40, não 8)', de('DEM-102').input.cargaHoraria, 40);
    eq('dias específicos: data = primeiro dia ordenado', de('DEM-102').input.dataInicio, '2026-08-20');
    eq('dias específicos: horário do primeiro dia', de('DEM-102').input.horarioInicio, '13:00');
    eq('contínuo: horário de parede do início', de('DEM-100').input.horarioInicio, '08:00');
    eq('ID SAP vem de clientDemandId', de('DEM-100').input.clientDemandId, 'SAP-100');
    eq('interna: carga = horas previstas', de('DEM-107').input.cargaHoraria, 4);
    eq('medicaoStatus na linha para o filtro', [de('DEM-100').medicaoStatus, de('DEM-108').medicaoStatus], ['PRONTA_FATURAMENTO', '']);

    // Resolução com o template real e os valores manuais.
    const sheet = resolveRowsSheet(VALE_TEMPLATE.sheets[0], toRowsSheetInput(rows), src.templateValues);
    const linhaDe = (id: string) => sheet.rows[rows.filter(r => r.elegivelTurmas).findIndex(r => r.demand.id === id)];
    eq('preço HH por treinamento pré-preenche', linhaDe('DEM-100')[7].value, 120);
    eq('preço HH sobrescrito na demanda vence', linhaDe('DEM-101')[7].value, 150);
    eq('híbrida: treinamento sem preço -> H vazia e amarela', [linhaDe('DEM-102')[7].value, linhaDe('DEM-102')[7].highlight], [null, true]);
    eq('combustível digitado', linhaDe('DEM-100')[10].value, 45);
    eq('combustível não digitado -> 0', linhaDe('DEM-101')[10].value, 0);
    eq('observação por demanda', linhaDe('DEM-100')[17].value, 'Turma extra');
    eq('B vazia e amarela sem ID SAP', [linhaDe('DEM-101')[1].value, linhaDe('DEM-101')[1].highlight], [null, true]);
    eq('J..N vêm das despesas reembolsáveis', [linhaDe('DEM-100')[9].value, linhaDe('DEM-100')[11].value, linhaDe('DEM-100')[12].value, linhaDe('DEM-100')[13].value], [80, 50, 200, 25]);

    // Filtros da tela.
    const ctx = { trainingsById: buildTrainingsById(TRAININGS), now: HOJE };
    const allowed: any = ['periodoFim', 'corredor', 'site', 'statusMedicao'];
    eq('período pela data de TÉRMINO (agosto): 108 fora, 103 fora', applyFilters(rows, { ...EMPTY_FILTERS, dataInicio: '2026-08-01', dataFim: '2026-08-31' }, allowed, ctx).map(r => r.demand.id).sort(), ['DEM-100', 'DEM-101', 'DEM-102', 'DEM-105', 'DEM-107']);
    eq('corredor', applyFilters(rows, { ...EMPTY_FILTERS, corredor: 'Ferrovia/MG' }, allowed, ctx).map(r => r.demand.id), ['DEM-108']);
    eq('site', applyFilters(rows, { ...EMPTY_FILTERS, site: 'Timbopeba' }, allowed, ctx).map(r => r.demand.id), ['DEM-101']);
    eq('status da medição multi (pronta + sem medição)', applyFilters(rows, { ...EMPTY_FILTERS, statusMedicao: ['PRONTA_FATURAMENTO', SEM_MEDICAO] }, allowed, ctx).map(r => r.demand.id).sort(), ['DEM-100', 'DEM-103', 'DEM-105', 'DEM-107', 'DEM-108']);
    eq('canceladas fora por padrão', applyFilters(rows, EMPTY_FILTERS, allowed, ctx).some(r => r.demand.id === 'DEM-104'), false);
    eq('canceladas com a opção ligada', applyFilters(rows, EMPTY_FILTERS, allowed, { ...ctx, options: { ...DEFAULT_OPTIONS, incluirCanceladas: true } }).some(r => r.demand.id === 'DEM-104'), true);
    const opts = buildFilterOptions(rows, TRAININGS, COMPANIES, INSTRUCTORS, ['S11D', 'Sudeste']);
    eq('corredores = base operacional ∪ dados', opts.corredores, ['Ferrovia/MG', 'S11D', 'Sudeste']);
    eq('sites presentes', opts.sites, ['Brucutu', 'Timbopeba']);
    eq('status da medição inclui Sem medição', opts.statusMedicao.map(o => o.value).includes(SEM_MEDICAO) && MEDICAO_STATUS_OPTIONS.length, 6);
  }

  /* ────────────────────────────────────────────────────────────────────────
   * [R] Recorte pela DATA DE TÉRMINO (regra da Micaelle, 23/09/2026)
   *
   * Fixture PRÓPRIA, de propósito: a compartilhada alimenta o escritor, o
   * painel e o BM, e encher ela de turmas de borda faria essas asserções
   * falarem de outra coisa. Aqui só o que a regra do período precisa.
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n[R] Recorte pela data de término da turma');
  {
    const ctx = { trainingsById: buildTrainingsById(TRAININGS), now: HOJE };
    const allowed: any = ['periodoFim', 'corredor', 'site', 'statusMedicao'];

    const demands = [
      // O caso real: dias 19, 20, 21 e 25/08. `endDate` fica em 21/08 DE
      // PROPÓSITO — é o que prova que a seleção resolve os dias da demanda
      // (getDemandDays / getDemandLastDay) em vez de ler o campo de data fim.
      demandaVale({
        id: 'DEM-1418', clientDemandId: '40840', trainingLocal: 'Vargem Grande',
        dateMode: 'DIAS_ESPECIFICOS', startDate: '2026-08-19T08:00', endDate: '2026-08-21T17:00',
        specificDates: [
          { data: '2026-08-19', horarioInicio: '08:00', horarioFim: '17:00' },
          { data: '2026-08-20', horarioInicio: '08:00', horarioFim: '17:00' },
          { data: '2026-08-21', horarioInicio: '08:00', horarioFim: '17:00' },
          { data: '2026-08-25', horarioInicio: '08:00', horarioFim: '17:00' },
        ],
      }),
      // Começa e termina dentro do período — o caso de sempre, não pode regredir.
      demandaVale({ id: 'DEM-2000', startDate: '2026-08-25T08:00', endDate: '2026-08-27T17:00' }),
      // Começa no período e termina depois: vai para a PRÓXIMA medição.
      demandaVale({ id: 'DEM-2001', startDate: '2026-09-18T08:00', endDate: '2026-09-25T17:00' }),
      // Termina no último dia do período — a borda entra.
      demandaVale({ id: 'DEM-2002', startDate: '2026-09-15T08:00', endDate: '2026-09-21T17:00' }),
    ];
    const rowsR = buildMedicaoValeRows({
      ...src, demands,
      instructorAllocations: demands.map((d, i) => ({ id: `R${i}`, demandId: d.id, instructorId: 'INS-T', startDate: d.startDate, endDate: d.endDate })),
      measurements: [],
    });
    const ids = (di: string, df: string) =>
      applyFilters(rowsR, { ...EMPTY_FILTERS, dataInicio: di, dataFim: df }, allowed, ctx).map(r => r.demand.id).sort();

    eq('DEM-1418 termina em 25/08, não no campo endDate (21/08)', getDemandLastDay(demands[0]), '2026-08-25');
    eq('ultimoDia na linha vem dos dias reais', rowsR.find(r => r.demand.id === 'DEM-1418')!.ultimoDia, '2026-08-25');
    eq('a coluna Data continua sendo o primeiro dia', rowsR.find(r => r.demand.id === 'DEM-1418')!.input.dataInicio, '2026-08-19');

    check('DEM-1418 entra em 20/08–21/09 (começou antes, termina dentro)', ids('2026-08-20', '2026-09-21').includes('DEM-1418'));
    check('DEM-1418 NÃO entra em 20/07–19/08 (termina depois)', !ids('2026-07-20', '2026-08-19').includes('DEM-1418'));
    check('DEM-1418 NÃO entra em 20/07–20/08 (termina depois)', !ids('2026-07-20', '2026-08-20').includes('DEM-1418'));

    check('turma inteira dentro do período entra', ids('2026-08-20', '2026-09-21').includes('DEM-2000'));
    check('turma que começa no período e termina depois NÃO entra', !ids('2026-08-20', '2026-09-21').includes('DEM-2001'));
    check('e entra na medição seguinte, onde termina', ids('2026-09-22', '2026-10-21').includes('DEM-2001'));
    check('turma que termina no último dia do período entra', ids('2026-08-20', '2026-09-21').includes('DEM-2002'));

    // Uma turma nunca aparece em dois períodos consecutivos.
    const mes1 = ids('2026-08-22', '2026-09-21');
    const mes2 = ids('2026-09-22', '2026-10-21');
    eq('dois meses seguidos: interseção de IDs vazia', mes1.filter(id => mes2.includes(id)), []);
    check('e os dois meses não são vazios (o teste teria passado à toa)', mes1.length > 0 && mes2.length > 0);

    // Aviso "começaram antes": só DEM-1418 no recorte de 20/08 a 21/09.
    const recorte = applyFilters(rowsR, { ...EMPTY_FILTERS, dataInicio: '2026-08-20', dataFim: '2026-09-21' }, allowed, ctx);
    const antes = turmasComecaramAntes(recorte, '2026-08-20');
    eq('só DEM-1418 começou antes do início do período', antes.map(r => r.demand.id), ['DEM-1418']);
    eq('texto da barra com a contagem certa', avisoComecaramAntes(antes.length, '2026-08-20'), '1 turma(s) começaram antes de 20/08 e terminam neste período — entram nesta medição');
    eq('texto do painel, na linha da turma', avisoTurmaComecouAntes(antes[0]), 'Começou em 19/08, antes do início do período — entra nesta medição porque termina em 25/08');
    eq('sem período no filtro não há aviso', turmasComecaramAntes(recorte, '').length, 0);
  }

  /* ────────────────────────────────────────────────────────────────────────
   * [RT] Tela e textos da regra do período (guarda de fonte)
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n[RT] Tela e textos da regra do período');
  {
    const filtros = t.ler('components/exportacoes/FiltrosExportacao.tsx');
    check('rótulo do filtro fala em data de TÉRMINO', filtros.includes('label="Período (data de término da turma)"'));
    check('e o campo é o do dataset (periodoFim)', filtros.includes("on('periodoFim')") && !filtros.includes("on('periodoInicio')"));

    const nota = t.ler('domain/exports/templates/vale.ts');
    check('nota da Medição Vale: entra onde TERMINA', /A turma entra na medição do período em que TERMINA/.test(nota));
    check('nota da Medição Vale: e por isso nunca em duas', /nunca aparece em duas medições/.test(nota));
    const notaBm = t.ler('domain/exports/templates/vale-bm.ts');
    check('nota do BM: as turmas que TERMINAM no período', /as turmas que TERMINAM no período/.test(notaBm));

    const view = t.ler('components/exportacoes/MedicaoTemplateView.tsx');
    check('tela: conta as herdadas pelo domínio, com o início do período',
      view.includes('turmasComecaramAntes(filtered, filters.dataInicio || undefined)'));
    check('tela: aviso na barra com o texto do domínio',
      view.includes('avisoComecaramAntes(comecaramAntes.length, filters.dataInicio)'));
    check('tela: a mesma informação como aviso na turma, no painel',
      view.includes("texto: avisoTurmaComecouAntes(r)") && view.includes("tipo: 'aviso'"));
    check('tela: o aviso não bloqueia a geração', !/podeGerar[^\n]*comecaramAntes/.test(view));
  }

  return falhas;
}

/** O que os blocos assíncronos ([X] escritor, [P] painel) recebem. */
export function buildValeContext() {
  const src = buildValeFixtureSource();
  return { src, rows: buildMedicaoValeRows(src) };
}
