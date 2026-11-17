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
  turmasNaoConcluidas,
  medicaoExigeTitular,
  itensNaoConcluidas,
  avisoNaoConcluidas,
  confirmacaoNaoConcluidas,
  LIMITE_LISTA_CONFIRMACAO,
  linhasDaConferenciaDoModelo,
} from '../domain/exports/datasets/medicaoVale';
import { MODALITY_UNSET } from '../domain/modalityOptions';
import { getDemandLastDay } from '../domain/demandDays';
import { normalizeLocationName, resolveCorredorDoLocal } from '../domain/locationCorridor';
import {
  aoEscolherSite,
  aoEscolherCorredor,
  gruposDeSite,
  avisoSiteLimpo,
  AVISO_LOCAL_SEM_CORREDOR,
  GRUPO_SEM_ASSOCIACAO,
} from '../domain/exports/siteCorredor';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { resolveRowsSheet } from '../domain/exports/templates/resolve';
import { SOURCE_FIELDS } from '../domain/exports/templates/sourceFields';
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

/**
 * Fixture da regra "puxar todas as turmas do período" (17/11/2026). PRÓPRIA,
 * de propósito: a compartilhada tem números conferidos à mão no escritor, no
 * painel e no BM. Aqui cada turma é um caso da regra, com tudo o mais
 * preenchido (preço, horário, ID, medição pronta) para que a única pendência
 * e o único amarelo sejam os da regra.
 */
export const TRAININGS_TT: any[] = [
  ...TRAININGS,
  { id: 'T_EAD', name: 'NR 20 Básico EAD', hours: 4, practicalHours: null, modality: 'ONLINE' },
  { id: 'T_AOV', name: 'NR 33 Ao Vivo', hours: 8, practicalHours: null, modality: 'ONLINE_AO_VIVO' },
  { id: 'T_SEM', name: 'Curso sem modalidade', hours: 8, practicalHours: null, modality: null },
];
export function buildTodasTurmasFixture() {
  const base = buildValeFixtureSource();
  const sem = { instructorId: undefined };
  const demands = [
    // EAD pelo TREINAMENTO (a demanda diz presencial), sem titular, conclusão registrada.
    demandaVale({ id: 'DEM-600', trainingId: 'T_EAD', modality: 'PRESENCIAL', status: 'CONCLUIDA', ...sem }),
    // EAD sem titular, data passada, status GRAVADO ainda ALOCADA (ninguém registrou a conclusão).
    demandaVale({ id: 'DEM-601', trainingId: 'T_EAD', ...sem }),
    // EAD COM titular, data passada, gravado ALOCADA: o acréscimo é só para quem não tem titular.
    demandaVale({ id: 'DEM-610', trainingId: 'T_EAD' }),
    demandaVale({ id: 'DEM-602', trainingId: 'T_AOV', ...sem }),                                       // ao vivo sem titular
    demandaVale({ id: 'DEM-603', ...sem }),                                                           // presencial sem titular
    demandaVale({ id: 'DEM-604', trainingId: 'T_HIB', ...sem }),                                       // híbrida sem titular
    demandaVale({ id: 'DEM-605', startDate: '2026-09-14T08:00', endDate: '2026-09-18T17:00' }),        // em andamento, com titular
    demandaVale({ id: 'DEM-606', status: 'CANCELADA', ...sem }),                                       // cancelada sem titular
    demandaVale({ id: 'DEM-607', trainingId: 'T_EAD', startDate: '2026-09-16T08:00', endDate: '2026-09-17T17:00', ...sem }), // EAD futura sem titular
    demandaVale({ id: 'DEM-608', trainingId: 'T_SEM', modality: '', ...sem }),                         // sem modalidade nenhuma
    demandaVale({ id: 'DEM-609', modality: 'ONLINE', ...sem }),                                        // demanda ONLINE, treinamento PRESENCIAL
  ];
  const measurements = demands.map(d =>
    d.id === 'DEM-604' ? medicao(d.id, { attachments: [{ id: 'z1', category: 'ALMOCO', value: 0 }] }) : medicao(d.id)
  );
  return { ...base, trainings: TRAININGS_TT, demands, measurements, instructorAllocations: [], templateValues: indexTemplateValues(TT_VALUE_ROWS) };
}

/** Os valores manuais da fixture [TT], como linhas do banco (a tela recebe assim). */
export const TT_VALUE_ROWS: any[] = [
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120 },
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHH', training_id: 'T_EAD', demand_id: null, value: 80 },
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHH', training_id: 'T_AOV', demand_id: null, value: 90 },
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHH', training_id: 'T_SEM', demand_id: null, value: 70 },
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
  { template_id: 'vale-v1', scope: 'training', column_key: 'precoHHOnline', training_id: 'T_HIB', demand_id: null, value: 200 },
];

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

    // Regra de 17/11/2026: toda turma Vale entra; fora só cancelada e interna.
    eq('elegíveis para a aba Turmas = todas, fora cancelada (104) e interna (107) — inclusive sem titular (105) e futura (103)', rows.filter(r => r.elegivelTurmas).map(r => r.demand.id), ['DEM-100', 'DEM-101', 'DEM-105', 'DEM-102', 'DEM-108', 'DEM-103']);
    eq('futura: não concluída deixa de ser bloqueio — entra com aviso e naoConcluida',
      [de('DEM-103').bloqueios, de('DEM-103').avisos.map(a => a.texto), de('DEM-103').naoConcluida, de('DEM-103').elegivelTurmas],
      [[], ['Demanda não concluída (Alocada)'], true, true]);
    eq('cancelada -> bloqueio', de('DEM-104').bloqueios, ['Demanda cancelada']);
    check('cancelada continua fora, sem aviso de não concluída', !de('DEM-104').elegivelTurmas && !de('DEM-104').naoConcluida && de('DEM-104').avisos.every(a => !/não concluída/.test(a.texto)));
    eq('presencial sem titular: entra, com aviso que lê o Consultor (vale mesmo sem coluna) e Consultor a conferir',
      [de('DEM-105').bloqueios, de('DEM-105').elegivelTurmas, de('DEM-105').avisos.find(a => a.texto === 'Sem instrutor titular'), de('DEM-105').input.conferir],
      [[], true, { texto: 'Sem instrutor titular', source: 'people.titulares', mesmoSemColuna: true }, ['people.titulares']]);
    eq('concluída com titular: nenhum aviso de turma', [de('DEM-100').naoConcluida, de('DEM-100').avisos.filter(a => /concluída|titular/.test(a.texto)).length], [false, 0]);
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
    eq('carga da LINHA = training.hours (híbrida 40, não 8 — a divisão é na saída para a planilha)', de('DEM-102').input.cargaHoraria, 40);
    eq('modalidade do treinamento na linha (demanda diz PRESENCIAL, treinamento HIBRIDO)', [de('DEM-102').input.modalidade, de('DEM-100').input.modalidade], ['HIBRIDO', 'PRESENCIAL']);
    eq('híbrida 40h/8h: 8 presenciais + 32 online, pelo cadastro', de('DEM-102').hibrida, { ok: true, presencial: 8, online: 32, hours: 40 });
    eq('presencial não tem divisão', de('DEM-100').hibrida, null);
    eq('interna não tem divisão nem modalidade de treinamento', [de('DEM-107').hibrida, de('DEM-107').input.modalidade], [null, '']);
    {
      const semPraticas = buildMedicaoValeRows({
        ...src,
        trainings: [...TRAININGS, { id: 'T_HIB0', name: 'NR 10 Básico', hours: 40, practicalHours: null, modality: 'HIBRIDO' }, { id: 'T_HIB50', name: 'NR 20 Avançado', hours: 40, practicalHours: 50, modality: 'HIBRIDO' }],
        demands: [demandaVale({ id: 'DEM-400', trainingId: 'T_HIB0' }), demandaVale({ id: 'DEM-401', trainingId: 'T_HIB50' })],
      });
      const h = (id: string) => semPraticas.find(r => r.demand.id === id)!;
      eq('híbrida SEM horas práticas: divisão inválida com motivo', [h('DEM-400').hibrida?.ok, (h('DEM-400').hibrida as any).motivo], [false, 'SEM_HORAS_PRATICAS']);
      eq('e vira aviso do painel (a turma continua elegível)', [h('DEM-400').avisos.map(a => a.texto), h('DEM-400').elegivelTurmas], [['Treinamento híbrido sem horas práticas cadastradas'], true]);
      eq('híbrida com práticas >= carga: inválida, nunca online negativa', (h('DEM-401').hibrida as any).motivo, 'HORAS_PRATICAS_INVALIDAS');
      check('com o texto dizendo os números', h('DEM-401').avisos[0].texto.includes('50h de 40h'));
    }
    eq('dias específicos: data = primeiro dia ordenado', de('DEM-102').input.dataInicio, '2026-08-20');
    eq('dias específicos: horário do primeiro dia', de('DEM-102').input.horarioInicio, '13:00');
    eq('contínuo: horário de parede do início', de('DEM-100').input.horarioInicio, '08:00');

    // Data e horário de TÉRMINO: o último dia real (o mesmo do filtro de
    // período) e a hora de parede desse dia — lidos crus, sem inventar.
    eq('contínuo: data fim = último dia', de('DEM-100').input.dataFim, '2026-08-11');
    eq('contínuo: horário de término de parede', de('DEM-100').input.horarioFim, '17:00');
    eq('dias específicos: data fim = maior dia da lista', de('DEM-102').input.dataFim, '2026-08-22');
    eq('dias específicos: horário de término do ÚLTIMO dia', de('DEM-102').input.horarioFim, '18:00');
    eq('data fim da linha é o ultimoDia do filtro', rows.map(r => r.input.dataFim), rows.map(r => r.ultimoDia));
    {
      const semHora = buildMedicaoValeRows({
        ...src,
        demands: [
          demandaVale({ id: 'DEM-300', startDate: '2026-08-10', endDate: '2026-08-11' }),
          demandaVale({ id: 'DEM-301', dateMode: 'DIAS_ESPECIFICOS', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00',
            specificDates: [{ data: '2026-08-10', horarioInicio: '', horarioFim: '' }, { data: '2026-08-11', horarioInicio: '09:00', horarioFim: '' }] }),
        ],
      });
      const h = (id: string) => { const r = semHora.find(x => x.demand.id === id)!; return [r.input.horarioInicio, r.input.horarioFim]; };
      eq('contínuo sem hora gravada: início e fim VAZIOS (nada de 08:00/17:00)', h('DEM-300'), ['', '']);
      eq('dia específico sem hora: vazio onde falta, hora onde há', h('DEM-301'), ['', '']);
      eq('sem hora: o campo do catálogo resolve null (célula vazia), não texto vazio',
        [SOURCE_FIELDS['demand.horarioInicio'].get(semHora[0].input), SOURCE_FIELDS['demand.horarioFim'].get(semHora[0].input)], [null, null]);
    }
    {
      // O carregador da aba pede o mapper SEM o 08:00/18:00 do Excel de pagamento.
      const carga = t.semComentarios(t.ler('services/exports/loadExportData.ts'));
      check('a carga da aba lê os horários crus', carga.includes('mapDemand(row, { horariosCrus: true })'));
      const svc = t.semComentarios(t.ler('services/medicaoExportService.ts'));
      check('o mapper só inventa 08:00/18:00 quando ninguém pede o cru', svc.includes("const inicio = opts.horariosCrus ? '' : '08:00';") && svc.includes("const fim = opts.horariosCrus ? '' : '18:00';"));
      check('e o Excel de pagamento continua chamando sem opção', !/mapDemand\([^)]*horariosCrus/.test(svc));
    }
    eq('ID SAP vem de clientDemandId', de('DEM-100').input.clientDemandId, 'SAP-100');
    eq('interna: carga = horas previstas', de('DEM-107').input.cargaHoraria, 4);
    eq('medicaoStatus na linha para o filtro', [de('DEM-100').medicaoStatus, de('DEM-108').medicaoStatus], ['PRONTA_FATURAMENTO', '']);

    // Resolução com o template real e os valores manuais.
    const sheet = resolveRowsSheet(VALE_TEMPLATE.sheets[0], toRowsSheetInput(rows), src.templateValues);
    const linhaDe = (id: string) => sheet.rows[rows.filter(r => r.elegivelTurmas).findIndex(r => r.demand.id === id)];
    eq('preço HH por treinamento pré-preenche', linhaDe('DEM-100')[9].value, 120);
    eq('preço HH sobrescrito na demanda vence', linhaDe('DEM-101')[9].value, 150);
    eq('híbrida: treinamento sem preço -> J vazia e amarela', [linhaDe('DEM-102')[9].value, linhaDe('DEM-102')[9].highlight], [null, true]);
    eq('combustível digitado', linhaDe('DEM-100')[12].value, 45);
    eq('combustível não digitado -> 0', linhaDe('DEM-101')[12].value, 0);
    eq('observação por demanda', linhaDe('DEM-100')[19].value, 'Turma extra');
    eq('B vazia e amarela sem ID SAP', [linhaDe('DEM-101')[1].value, linhaDe('DEM-101')[1].highlight], [null, true]);
    eq('L..P vêm das despesas reembolsáveis', [linhaDe('DEM-100')[11].value, linhaDe('DEM-100')[13].value, linhaDe('DEM-100')[14].value, linhaDe('DEM-100')[15].value], [80, 50, 200, 25]);
    eq('E..H = início/fim da DEM-102 (dias específicos)', linhaDe('DEM-102').slice(4, 8).map(c => c.value), ['2026-08-20', '2026-08-22', '13:00', '18:00']);

    // Híbrida em DUAS linhas na saída para a planilha (só com o flag do template).
    {
      const semFlag = toRowsSheetInput(rows);
      eq('sem hybridSplit (modelos do banco): uma linha por demanda', semFlag.map(l => l.refs.demandId), ['DEM-100', 'DEM-101', 'DEM-105', 'DEM-102', 'DEM-108', 'DEM-103']);
      const comFlag = toRowsSheetInput(rows, VALE_TEMPLATE);
      eq('com hybridSplit: a híbrida vira duas linhas ADJACENTES, presencial primeiro', comFlag.map(l => `${l.refs.demandId}${l.refs.parte ? ':' + l.refs.parte : ''}`), ['DEM-100', 'DEM-101', 'DEM-105', 'DEM-102:PRESENCIAL', 'DEM-102:ONLINE', 'DEM-108', 'DEM-103']);
      const [pres, onl] = comFlag.filter(l => l.refs.demandId === 'DEM-102');
      eq('Treinamento com o sufixo de cada parte (travessão)', [pres.input.trainingName, onl.input.trainingName], ['NR 20 Intermediário – Presencial', 'NR 20 Intermediário – Online']);
      eq('carga 40h/8h: 8 presenciais + 32 online', [pres.input.cargaHoraria, onl.input.cargaHoraria], [8, 32]);
      eq('despesas ficam na presencial; a online nasce zerada', [pres.input.despesas.total, onl.input.despesas], [rows.find(r => r.demand.id === 'DEM-102')!.input.despesas.total, { locomocao: 0, alimentacao: 0, hospedagem: 0, outros: 0, total: 0 }]);
      check('o resto repete (ID, datas, horários, consultor)', ['clientDemandId', 'dataInicio', 'dataFim', 'horarioInicio', 'horarioFim', 'titulares'].every(k => JSON.stringify((pres.input as any)[k]) === JSON.stringify((onl.input as any)[k])));

      const valoresHib = indexTemplateValues([
        { scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
        { scope: 'training', column_key: 'precoHHOnline', training_id: 'T_HIB', demand_id: null, value: 200 },
        { scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-102', value: 60 },
      ]);
      const planilha = resolveRowsSheet(VALE_TEMPLATE.sheets[0], comFlag, valoresHib);
      const col = (k: string) => planilha.columns.findIndex(c => c.key === k);
      const l = (i: number, k: string) => planilha.rows[i][col(k)];
      // A híbrida DEM-102 está nas linhas de índice 3 e 4 (planilha 5 e 6): a DEM-105 sem titular entra antes.
      eq('anexo: 1, 2, 3, 4, 4, 5, 6 — as partes repetem, a turma seguinte não pula', planilha.rows.map(r => r[0].value), [1, 2, 3, 4, 4, 5, 6]);
      eq('preço HH por parte: presencial 290, online 200', [l(3, 'precoHH').value, l(4, 'precoHH').value], [290, 200]);
      eq('valor total por linha: K = I*J da própria linha', [l(3, 'valorTotal').formula, l(4, 'valorTotal').formula], ['I5*J5', 'I6*J6']);
      eq('combustível digitado sai na presencial e vale 0 na online', [l(3, 'combustivel').value, l(4, 'combustivel').value], [60, 0]);
      eq('demais despesas zeradas na online', ['locacao', 'alimentacao', 'hospedagem', 'outros'].map(k => l(4, k).value), [0, 0, 0, 0]);
      eq('ID, Local, datas e consultor repetem nas duas linhas', ['idTurma', 'local', 'dataInicio', 'dataFim', 'horarioInicio', 'horarioFim', 'consultor'].map(k => l(3, k).value === l(4, k).value), [true, true, true, true, true, true, true]);

      // Sem horas práticas: duas linhas com carga em branco e amarela.
      const semPraticas = buildMedicaoValeRows({ ...src, trainings: [...TRAININGS, { id: 'T_HIB0', name: 'NR 10 Básico', hours: 40, practicalHours: null, modality: 'HIBRIDO' }], demands: [demandaVale({ id: 'DEM-400', trainingId: 'T_HIB0' })] });
      const sp = resolveRowsSheet(VALE_TEMPLATE.sheets[0], toRowsSheetInput(semPraticas, VALE_TEMPLATE), emptyTemplateValuesIndex());
      eq('sem horas práticas: duas linhas, carga vazia e amarela nas duas', sp.rows.map(r => [r[col('cargaHoraria')].value ?? null, r[col('cargaHoraria')].highlight]), [[null, true], [null, true]]);
      eq('e nenhuma delas vira carga cheia', sp.rows.map(r => r[col('cargaHoraria')].value).includes(40), false);
    }

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
   * [TT] Todas as turmas do período (17/11/2026)
   *
   * Não concluída e sem titular deixaram de tirar a linha: entram com aviso.
   * Online EAD sem titular entra sem aviso e sem amarelo; as demais
   * modalidades avisam e pintam o Consultor. Cancelada continua fora.
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n[TT] Todas as turmas do período');
  {
    const srcT = buildTodasTurmasFixture();
    const rowsT = buildMedicaoValeRows(srcT);
    const r = (id: string) => rowsT.find(x => x.demand.id === id)!;
    const daTurma = (id: string) => r(id).avisos.map(a => a.texto).filter(x => /concluída|titular|conclusão/.test(x));

    eq('entram todas, menos a cancelada', rowsT.filter(x => x.elegivelTurmas).map(x => x.demand.id).sort(),
      ['DEM-600', 'DEM-601', 'DEM-602', 'DEM-603', 'DEM-604', 'DEM-605', 'DEM-607', 'DEM-608', 'DEM-609', 'DEM-610']);
    eq('online EAD sem titular (o treinamento ONLINE prevalece sobre a demanda PRESENCIAL), conclusão GRAVADA: sem aviso, nada a conferir',
      [r('DEM-600').input.modalidade, r('DEM-600').demand.status, daTurma('DEM-600'), r('DEM-600').input.conferir ?? null], ['ONLINE', 'CONCLUIDA', [], null]);
    eq('online EAD sem titular que só virou concluída pela data (gravado ALOCADA): aviso "confirme que a turma aconteceu", nada a conferir',
      [r('DEM-601').statusCalculado, r('DEM-601').demand.status, daTurma('DEM-601'), r('DEM-601').input.conferir ?? null, r('DEM-601').elegivelTurmas, r('DEM-601').naoConcluida],
      ['CONCLUIDA', 'ALOCADA', ['Online sem conclusão registrada — confirme que a turma aconteceu'], null, true, false]);
    eq('online EAD COM titular e gravado ALOCADA: sem esse aviso (o acréscimo é do online sem titular)', daTurma('DEM-610'), []);
    eq('online ao vivo sem titular: aviso + Consultor a conferir', [daTurma('DEM-602'), r('DEM-602').input.conferir], [['Sem instrutor titular'], ['people.titulares']]);
    eq('presencial sem titular: aviso + Consultor a conferir', [daTurma('DEM-603'), r('DEM-603').input.conferir], [['Sem instrutor titular'], ['people.titulares']]);
    eq('híbrida sem titular: aviso + Consultor, e a alimentação zerada a conferir junto',
      [daTurma('DEM-604'), r('DEM-604').input.conferir], [['Sem instrutor titular'], ['people.titulares', 'expenses.alimentacao', 'expenses.total']]);
    eq('em andamento com titular: entra, só o aviso de não concluída', [daTurma('DEM-605'), r('DEM-605').naoConcluida, r('DEM-605').elegivelTurmas], [['Demanda não concluída (Em Andamento)'], true, true]);
    eq('cancelada sem titular: fora, só o fato do cancelamento (nem titular nem não concluída)',
      [r('DEM-606').elegivelTurmas, r('DEM-606').bloqueios, daTurma('DEM-606'), r('DEM-606').naoConcluida], [false, ['Demanda cancelada'], [], false]);
    eq('online EAD futura sem titular: só a não concluída (online não exige titular)', daTurma('DEM-607'), ['Demanda não concluída (Alocada)']);
    eq('sem modalidade nenhuma: exige titular (na dúvida avisa)', [r('DEM-608').input.modalidade, daTurma('DEM-608')], [MODALITY_UNSET, ['Sem instrutor titular']]);
    eq('demanda diz ONLINE mas o treinamento é PRESENCIAL: vale o treinamento, exige titular', [r('DEM-609').input.modalidade, daTurma('DEM-609')], ['PRESENCIAL', ['Sem instrutor titular']]);
    eq('medicaoExigeTitular: só ONLINE (EAD) dispensa', ['ONLINE', 'ONLINE_AO_VIVO', 'PRESENCIAL', 'HIBRIDO', 'TUTORIA', MODALITY_UNSET, ''].map(medicaoExigeTitular), [false, true, true, true, true, true, true]);
    eq('turmasNaoConcluidas: as que entram sem estar concluídas, na ordem da planilha', turmasNaoConcluidas(rowsT).map(x => x.demand.id), ['DEM-605', 'DEM-607']);
    eq('turmasNaoConcluidas ignora a que não entra', turmasNaoConcluidas([{ ...r('DEM-605'), elegivelTurmas: false }]).length, 0);

    // Conferência do mapeamento de modelo por empresa (ModelosMedicao): a amostra NÃO segue a regra
    // nova — só as concluídas. A planilha gerada, sim.
    eq('amostra da conferência do modelo: só as concluídas que entram (sem 605/607 não concluídas, sem a cancelada)',
      linhasDaConferenciaDoModelo(rowsT).map(l => l.refs.demandId).sort(),
      ['DEM-600', 'DEM-601', 'DEM-602', 'DEM-603', 'DEM-604', 'DEM-608', 'DEM-609', 'DEM-610']);
    check('e a planilha gerada continua com as não concluídas', ['DEM-605', 'DEM-607'].every(id => toRowsSheetInput(rowsT).some(l => l.refs.demandId === id)));

    // Topo e trava ao gerar: os textos moram no domínio.
    eq('lista do aviso: DEM, treinamento, data de término, status', itensNaoConcluidas(rowsT), [
      { demandId: 'DEM-605', treinamento: 'NR 35 Trabalho em Altura', termino: '18/09/2026', status: 'Em Andamento' },
      { demandId: 'DEM-607', treinamento: 'NR 20 Básico EAD', termino: '17/09/2026', status: 'Alocada' },
    ]);
    eq('título do aviso (plural / singular / BM)', [avisoNaoConcluidas(2), avisoNaoConcluidas(1), avisoNaoConcluidas(3, 'BM')],
      ['2 turmas ainda não concluídas entram nesta planilha', '1 turma ainda não concluída entra nesta planilha', '3 turmas ainda não concluídas entram no BM']);
    eq('confirmação ao gerar lista as turmas e pergunta "gerar mesmo assim?"', confirmacaoNaoConcluidas(rowsT),
      '2 turmas ainda não concluídas entram nesta planilha:\n\nDEM-605 · NR 35 Trabalho em Altura · termina 18/09/2026 · Em Andamento\nDEM-607 · NR 20 Básico EAD · termina 17/09/2026 · Alocada\n\nAinda não concluídas — gerar mesmo assim?');
    {
      const muitas = Array.from({ length: LIMITE_LISTA_CONFIRMACAO + 3 }, (_, i) => ({ ...r('DEM-605'), demand: { ...r('DEM-605').demand, id: `DEM-9${String(i).padStart(2, '0')}` } }));
      const txt = confirmacaoNaoConcluidas(muitas);
      eq('confirmação com muitas: lista o limite e diz quantas faltam', [txt.split('\n').filter(l => l.startsWith('DEM-')).length, txt.includes('… e mais 3 (lista completa no aviso acima da prévia)')], [LIMITE_LISTA_CONFIRMACAO, true]);
    }

    // A tela (guarda de fonte): aviso, marca e confirmação vêm do domínio; o XLSX não recebe nada disso.
    const view = t.semComentarios(t.ler('components/exportacoes/MedicaoTemplateView.tsx'));
    check('tela: confirmação ao gerar a planilha com o texto do domínio', view.includes("window.confirm(confirmacaoNaoConcluidas(naoConcluidas, 'planilha'))"));
    check('tela: aviso acima da prévia com título e lista do domínio', view.includes('avisoNaoConcluidas(listaNaoConcluidas.length') && view.includes('itensNaoConcluidas(naoConcluidas)'));
    check('tela: marca na linha da prévia pela demanda da linha', view.includes('idsNaoConcluidas.has(linhasPlanilha[i]?.refs.demandId)'));
    check('tela: prévia e XLSX saem das MESMAS linhas', view.includes('resolveRowsSheet(sheetTurmas, linhasPlanilha, values)') && view.includes('resolveTemplate(template, linhasPlanilha, values)'));
    check('tela: "de N no recorte" só quando algo fica fora', view.includes('{algoFicaFora && <span') && view.includes('turmasNoDocumento < filtered.length'));
    check('tela: a confirmação não trava o botão (é pergunta, não bloqueio)', !/podeGerar[^\n]*naoConcluidas/.test(view));

    // A planilha: o amarelo do Consultor e nada mais.
    const linhasT = toRowsSheetInput(rowsT, VALE_TEMPLATE);
    const planilhaT = resolveRowsSheet(VALE_TEMPLATE.sheets[0], linhasT, srcT.templateValues);
    const ic = (k: string) => planilhaT.columns.findIndex(c => c.key === k);
    const celulas = (id: string, parte?: string) => planilhaT.rows[linhasT.findIndex(l => l.refs.demandId === id && l.refs.parte === parte)];
    const consultor = (id: string, parte?: string) => { const c = celulas(id, parte)[ic('consultor')]; return [c.value === '' ? null : c.value ?? null, c.highlight]; };
    eq('Consultor da online EAD sem titular: em branco e NÃO amarelo', consultor('DEM-600'), [null, false]);
    check('online EAD sem titular: nenhuma célula amarela na linha', celulas('DEM-600').every(c => !c.highlight));
    check('online sem conclusão registrada: só aviso, nenhuma célula amarela na linha', celulas('DEM-601').every(c => !c.highlight));
    eq('Consultor da online ao vivo sem titular: em branco e amarelo', consultor('DEM-602'), [null, true]);
    eq('Consultor da presencial sem titular: em branco e amarelo', consultor('DEM-603'), [null, true]);
    eq('e é a ÚNICA célula amarela da linha', celulas('DEM-603').filter(c => c.highlight).length, 1);
    eq('híbrida sem titular: Consultor amarelo nas DUAS partes', [consultor('DEM-604', 'PRESENCIAL'), consultor('DEM-604', 'ONLINE')], [[null, true], [null, true]]);
    eq('híbrida: a alimentação a conferir só pinta a presencial (a online vale 0)',
      [celulas('DEM-604', 'PRESENCIAL')[ic('alimentacao')].highlight, celulas('DEM-604', 'ONLINE')[ic('alimentacao')].highlight], [true, false]);
    check('não concluída com tudo preenchido: nenhuma célula amarela na linha', celulas('DEM-605').every(c => !c.highlight));
    eq('e o Consultor dela sai com o titular alocado', celulas('DEM-605')[ic('consultor')].value, 'Titular');
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
    eq('e a Data fim é o dia em que a turma termina (25/08), o mesmo do filtro', rowsR.find(r => r.demand.id === 'DEM-1418')!.input.dataFim, '2026-08-25');

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

  /* ────────────────────────────────────────────────────────────────────────
   * [S] Site/Planta preenche o Corredor pelas Associações
   *
   * O corredor continua sendo quem recorta; o site só o preenche. Por isso o
   * bloco testa as DECISÕES (o par corredor/site que sai de cada escolha),
   * não a seleção de turmas — essa não muda.
   * ────────────────────────────────────────────────────────────────────── */
  console.log('\n[S] Site/Planta preenche o Corredor');
  {
    // Cadastro Locais — Demandas. A linha de 'interna' é isca: mesmo local,
    // outro corredor. Se o conjunto errado vazar, "Brucutu" vira 'Interna/MG'.
    const assocs: any[] = [
      { local: 'Brucutu', corredor: 'Sudeste', uf: 'MG', regiao: 'Minas Gerais', contexto: 'cliente' },
      { local: 'Cauê', corredor: 'Sudeste', uf: 'MG', regiao: 'Minas Gerais', contexto: 'cliente' },
      { local: 'Vitória', corredor: 'Ferrovia/MG', uf: 'ES', regiao: 'Espírito Santo', contexto: 'cliente' },
      { local: 'Brucutu', corredor: 'Interna/MG', uf: 'MG', regiao: 'Minas Gerais', contexto: 'interna' },
    ];
    const vazio = { corredor: '', site: '' };

    // 1) Local associado preenche o corredor.
    eq('site associado preenche o corredor', aoEscolherSite('Brucutu', vazio, assocs), { corredor: 'Sudeste', site: 'Brucutu', aviso: null });
    eq('e troca o corredor que estava lá', aoEscolherSite('Vitória', { corredor: 'Sudeste', site: 'Brucutu' }, assocs), { corredor: 'Ferrovia/MG', site: 'Vitória', aviso: null });

    // 2) Local sem associação: corredor como estava + aviso.
    const semAssoc = aoEscolherSite('Timbopeba', { corredor: 'Sudeste', site: '' }, assocs);
    eq('site sem associação mantém o corredor', [semAssoc.corredor, semAssoc.site], ['Sudeste', 'Timbopeba']);
    eq('e mostra o aviso de cadastro', semAssoc.aviso, 'Este local não tem corredor associado — cadastre em Cadastros → Associações.');
    eq('o aviso é a constante do domínio', semAssoc.aviso, AVISO_LOCAL_SEM_CORREDOR);

    // 3) "Todos" no site não altera o corredor.
    eq('"Todos" no site não mexe no corredor', aoEscolherSite('', { corredor: 'Sudeste', site: 'Brucutu' }, assocs), { corredor: 'Sudeste', site: '', aviso: null });

    // 4) Caixa e acento: "Cauê" = "CAUE" = "  caue  ".
    eq('acento e caixa ignorados no casamento', resolveCorredorDoLocal('CAUE', assocs), 'Sudeste');
    eq('espaço das pontas e espaço repetido ignorados', normalizeLocationName('  Vargem   Grande '), 'vargem grande');
    eq('site "CAUE" preenche o corredor de "Cauê"', aoEscolherSite('CAUE', vazio, assocs).corredor, 'Sudeste');
    check('local fora do cadastro não casa por engano', resolveCorredorDoLocal('Timbopeba', assocs) === '');
    eq('N/A nunca casa', resolveCorredorDoLocal('N/A', [{ local: 'N/A', corredor: 'X' }] as any), '');

    // 5) O conjunto das INTERNAS não é usado.
    eq('associação de contexto "interna" é ignorada', resolveCorredorDoLocal('Brucutu', assocs), 'Sudeste');
    eq('e sozinha não casa com nada', resolveCorredorDoLocal('Brucutu', [assocs[3]]), '');

    // 6) Trocar o corredor com site escolhido.
    eq('corredor novo limpa o site de OUTRO corredor', aoEscolherCorredor('Ferrovia/MG', { corredor: 'Sudeste', site: 'Brucutu' }, assocs), { corredor: 'Ferrovia/MG', site: '', aviso: 'Site limpo: não pertence ao corredor Ferrovia/MG' });
    eq('o aviso é o do domínio', aoEscolherCorredor('Ferrovia/MG', { corredor: '', site: 'Brucutu' }, assocs).aviso, avisoSiteLimpo('Ferrovia/MG'));
    eq('site do MESMO corredor fica', aoEscolherCorredor('Sudeste', { corredor: '', site: 'Cauê' }, assocs), { corredor: 'Sudeste', site: 'Cauê', aviso: null });
    eq('site SEM associação fica (falta de cadastro não é incompatibilidade)', aoEscolherCorredor('Sudeste', { corredor: '', site: 'Timbopeba' }, assocs), { corredor: 'Sudeste', site: 'Timbopeba', aviso: null });
    eq('corredor "Todos" não limpa o site', aoEscolherCorredor('', { corredor: 'Sudeste', site: 'Brucutu' }, assocs), { corredor: '', site: 'Brucutu', aviso: null });

    // 7) A lista de sites agrupa sem esconder ninguém.
    const locais = ['Brucutu', 'Timbopeba', 'Cauê', 'Vitória'];
    const g = gruposDeSite(locais, 'Sudeste', assocs);
    eq('associados ao corredor vêm primeiro', g.associados, ['Brucutu', 'Cauê']);
    eq('os demais ficam no grupo próprio', g.outros, ['Timbopeba', 'Vitória']);
    eq('nenhum local some da lista', [...g.associados, ...g.outros].sort(), [...locais].sort());
    eq('sem corredor escolhido não há grupo', gruposDeSite(locais, '', assocs), { associados: [], outros: locais });
    eq('rótulo do segundo grupo', GRUPO_SEM_ASSOCIACAO, 'Sem associação a este corredor');

    /* ── guarda de fonte: uma leitura só, uma regra só ── */
    const carga = t.ler('services/exports/loadExportData.ts');
    check('a carga lê o conjunto de CLIENTE, pelo service de sempre', carga.includes("fetchLocationAssociations('cliente')"));
    check('e nunca o das internas', !carga.includes("fetchLocationAssociations('interna')"));

    const form = t.semComentarios(t.ler('components/Demands.tsx'));
    check('o formulário de demanda usa a MESMA função de casamento', form.includes('findLocationAssociation(value, locationAssociations)'));
    check('e não sobrou o find por igualdade exata', !/locationAssociations\.find\(a => a\.local === value\)/.test(form));

    const filtros = t.semComentarios(t.ler('components/exportacoes/FiltrosExportacao.tsx'));
    check('o painel delega as duas decisões ao domínio',
      filtros.includes('aoEscolherSite(site, par, vinculo)') && filtros.includes('aoEscolherCorredor(corredor, par, vinculo)'));
    check('e agrupa a lista pelo domínio', filtros.includes('gruposDeSite(sites, value.corredor, vinculo)'));
    const view = t.semComentarios(t.ler('components/exportacoes/MedicaoTemplateView.tsx'));
    check('os módulos de medição passam as associações da carga', view.includes('locationAssociations={carga.locationAssociations}'));
  }

  return falhas;
}

/** O que os blocos assíncronos ([X] escritor, [P] painel) recebem. */
export function buildValeContext() {
  const src = buildValeFixtureSource();
  return { src, rows: buildMedicaoValeRows(src) };
}
