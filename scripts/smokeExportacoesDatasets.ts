/**
 * SMOKE — Exportações: blocos [A] [B] [C] [D] [G] (datasets e registry)
 *
 * Chamado por smokeExportacoes.ts, que passa as fixtures e os helpers. As
 * asserções comparam o dataset com as funções do domínio que alimentam o
 * painel, o Dashboard e o Excel de pagamento — nunca com números digitados à
 * mão, senão o teste fica verde sobre qualquer coisa.
 */
import {
  computeMeasurementTotals,
  computePanelExpenseBreakdown,
  normalizeMeasurementBlocks,
  blockHoraAula,
  aggregateMeasurements,
  aggregatePanelExpenseBreakdown,
} from '../domain/measurementTotals';
import { computeInstructorHoursByDemand, eligibleDemandIdsForPayment } from '../domain/instructorHours';
import { applyMeasurementOverrides } from '../domain/measurementOverrides';
import { formatDias } from '../services/medicaoWorkbook';
import { formatDiasList } from '../domain/exports/shared';
import { buildMedicoesRows, MEDICOES_DATASET, type MedicaoRow } from '../domain/exports/datasets/medicoes';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { buildDemandasRows, DEMANDAS_DATASET, transportLabel, lodgingLabel } from '../domain/exports/datasets/demandas';
import { EXPORT_DATASETS, getDataset, visibleDatasets, isTemplateDataset } from '../domain/exports/registry';
import { EMPTY_FILTERS } from '../domain/exports/types';
import { applyFilters } from '../domain/exports/filters';
import { DEFAULT_OPTIONS } from '../domain/exports/options';
import { INTERNAL_COMPANY_LABEL } from '../domain/demandLabel';

export interface SmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
  ler: (rel: string) => string;
  semComentarios: (src: string) => string;
  fixtures: any;
}

const soma = (ns: (number | null)[]) => ns.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Devolve o nº de falhas acumuladas nos blocos de dataset. */
export function runDatasetChecks(t: SmokeTools): number {
  let falhas = 0;
  const check: SmokeTools['check'] = (nome, cond, det) => {
    if (!cond) falhas++;
    t.check(nome, cond, det);
  };
  const eq: SmokeTools['eq'] = (nome, a, b) => {
    const ok = Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
    if (!ok) falhas++;
    t.eq(nome, a, b);
  };
  const perto: SmokeTools['perto'] = (nome, a, b) => {
    if (Math.abs(a - b) >= 1e-6) falhas++;
    t.perto(nome, a, b);
  };

  const { TRAININGS, COMPANIES, INSTRUCTORS, demandaCliente, demandaInterna, HOJE } = t.fixtures;

  /* ──────────────────────────────────────────────────────────────────────────
   * Fixtures de medição — cada caso do cabeçalho de datasets/medicoes.ts
   * ──────────────────────────────────────────────────────────────────────── */

  // M1 — INTERNA v2: titular sem horas digitadas + participante com 10h.
  // Anexos: sem dono (→ titular), do participante, de dono removido (→ titular)
  // e um órfão de OUTROS (fora do total, contado).
  const D_INT = demandaInterna();
  const M1: any = {
    id: 'MEA-DEM-900', demandId: 'DEM-900', status: 'CONFERENCIA', updatedAt: '2026-08-05T10:00:00',
    expenses: {
      classHours: 16,
      participantes: [
        { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 },
        { instructorId: 'INS-2', papel: 'PARTICIPANTE', horas: 10, valorHH: 80 },
      ],
    },
    attachments: [
      { id: 'a1', category: 'HOSPEDAGEM', value: 200 },
      { id: 'a2', category: 'ALMOCO', value: '50,00', instructorId: 'INS-2', reembolsavel: false },
      { id: 'a3', category: 'OUTROS', value: 30, otherId: 'O1', instructorId: 'INS-9' },
      { id: 'a4', category: 'OUTROS', value: 5, otherId: 'ZZ' },
    ],
    otherExpenses: [{ id: 'O1', description: 'Pedágio', value: '' }],
  };

  // M2 — CLIENTE v1 dividida por dias: dois titulares no rateio, medição mono.
  const D_SPLIT = demandaCliente();
  const M2: any = {
    id: 'MEA-DEM-100', demandId: 'DEM-100', status: 'LANCAMENTO', updatedAt: '2026-08-12',
    expenses: { classHours: 16, hourRate: 120 },
    attachments: [{ id: 'b1', category: 'LOCOMOCAO', value: 80 }],
    otherExpenses: [],
  };

  // M3 — CLIENTE v2 com acompanhante SEM horas: painel 0, Excel sem linha.
  const D_ACOMP = demandaCliente({ id: 'DEM-101' });
  const M3: any = {
    id: 'MEA-DEM-101', demandId: 'DEM-101', status: 'NAO_INICIADA', updatedAt: '',
    expenses: {
      classHours: 16,
      participantes: [
        { instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 },
        { instructorId: 'INS-A', papel: 'ACOMPANHANTE', valorHH: 50 },
      ],
    },
    attachments: [{ id: 'c1', category: 'JANTAR', value: 40, instructorId: 'INS-A' }],
    otherExpenses: [],
  };

  // M4 — HÍBRIDA v2 sem horas digitadas: painel 0; Excel paga as práticas (8h).
  const D_HIB = demandaCliente({ id: 'DEM-102', trainingId: 'T_HIB', modality: 'PRESENCIAL' });
  const M4: any = {
    id: 'MEA-DEM-102', demandId: 'DEM-102', status: 'LANCAMENTO', updatedAt: '2026-08-12',
    expenses: { participantes: [{ instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 }] },
    attachments: [],
    otherExpenses: [],
  };

  // M5 — demanda FUTURA (não concluída) com medição já aberta.
  const D_FUT = demandaCliente({ id: 'DEM-103', startDate: '2026-12-01T08:00', endDate: '2026-12-02T17:00' });
  const M5: any = {
    id: 'MEA-DEM-103', demandId: 'DEM-103', status: 'NAO_INICIADA', updatedAt: '',
    expenses: { classHours: 16, hourRate: 100 },
    attachments: [],
    otherExpenses: [],
  };

  // M6 — medição sem ninguém no cadastro (instructor_id nulo, sem alocação).
  const D_NINGUEM = demandaCliente({ id: 'DEM-104', instructorId: undefined });
  const M6: any = {
    id: 'MEA-DEM-104', demandId: 'DEM-104', status: 'LANCAMENTO', updatedAt: '',
    expenses: { classHours: 16, hourRate: 100 },
    attachments: [{ id: 'd1', category: 'CAFE', value: 12 }],
    otherExpenses: [],
  };

  const demands = [D_INT, D_SPLIT, D_ACOMP, D_HIB, D_FUT, D_NINGUEM];
  const measurements = [M1, M2, M3, M4, M5, M6];
  const instructorAllocations: any[] = [
    { id: 'A0', demandId: 'DEM-900', instructorId: 'INS-T', startDate: '2026-08-03T08:00', endDate: '2026-08-04T18:00' },
    { id: 'A1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
    { id: 'A2', demandId: 'DEM-100', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A3', demandId: 'DEM-101', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A4', demandId: 'DEM-102', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' },
    { id: 'A5', demandId: 'DEM-103', instructorId: 'INS-T', startDate: '2026-12-01T08:00', endDate: '2026-12-02T17:00' },
  ];
  const participants: any[] = [{ id: 'P1', demandId: 'DEM-900', instructorId: 'INS-2', startDate: null, endDate: null }];
  const companions: any[] = [
    { id: 'K1', demandId: 'DEM-101', instructorId: 'INS-A', startDate: '2026-08-10T08:00', endDate: '2026-08-10T18:00' },
  ];

  const src = {
    demands, measurements, trainings: TRAININGS, instructors: INSTRUCTORS, companies: COMPANIES,
    instructorAllocations, participants, companions,
    regionNameById: new Map([['MG', 'Minas Gerais']]),
    now: HOJE,
  };
  const rows = buildMedicoesRows(src);
  const de = (demandId: string, instructorId: string) =>
    rows.find(r => r.demand.id === demandId && r.instructorId === instructorId) as MedicaoRow;
  const daDemanda = (demandId: string) => rows.filter(r => r.demand.id === demandId);

  /* ──────────────────────────────────────────────────────────────────────────
   * [C] Linhas: uma por pessoa; v1 mono; partição dos anexos
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[C] Uma linha por pessoa × demanda');
  {
    eq('total de linhas = 2+2+2+1+1+1', rows.length, 9);
    eq('interna: titular + participante', daDemanda('DEM-900').map(r => `${r.instructorName}:${r.papel}`).sort(), ['Segundo:PARTICIPANTE', 'Titular:TITULAR']);
    eq('cliente dividido: um titular por trecho do rateio', daDemanda('DEM-100').map(r => r.papel), ['TITULAR', 'TITULAR']);
    eq('cliente com acompanhante: titular + acompanhante', daDemanda('DEM-101').map(r => r.papel).sort(), ['ACOMPANHANTE', 'TITULAR']);
    eq('sem ninguém: uma linha "(sem instrutor)"', daDemanda('DEM-104').map(r => r.instructorName), ['(sem instrutor)']);
    eq('e o vínculo dela é sem-pessoa', de('DEM-104', '').vinculo, 'sem-pessoa');

    // v1: o bloco inteiro vai para o titular principal; o segundo titular não tem bloco.
    const t1 = de('DEM-100', 'INS-T');
    const t2 = de('DEM-100', 'INS-2');
    check('v1: titular principal tem o bloco', t1.temBloco);
    check('v1: segundo titular não tem bloco', !t2.temBloco);
    eq('v1: horas informadas do titular = classHours', t1.horasInformadas, 16);
    eq('v1: segundo titular sem horas informadas (null, não 0)', t2.horasInformadas, null);
    eq('v1: hora/aula painel do segundo titular em branco', t2.horaAulaPainel, null);
    perto('v1: despesas todas no titular', t1.despesas.total, 80);
    perto('v1: segundo titular sem despesas', t2.despesas.total, 0);

    // v2: partição — sem dono e dono removido caem no titular; órfão fora, contado.
    const i1 = de('DEM-900', 'INS-T');
    const i2 = de('DEM-900', 'INS-2');
    perto('v2: item sem dono + dono removido caem no titular (200 + 30)', i1.despesas.total, 230);
    eq('v2: órfão de OUTROS contado no titular', i1.despesas.itensOrfaos, 1);
    perto('v2: item do participante fica com ele', i2.despesas.total, 50);
    perto('v2: não reembolsável é recorte por pessoa', i2.naoReembolsavel, 50);
    perto('v2: e continua dentro do total', i2.despesas.total, 50);
    perto('v2: despesas reembolsáveis = total − não reembolsável', i2.despesasReembolsaveis, 0);
    perto('v2: titular não herda o não reembolsável do participante', i1.naoReembolsavel, 0);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [A] Somas por medição fecham com o domínio; Σ Total geral fecha com o card
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[A] Σ por medição = computeMeasurementTotals / computePanelExpenseBreakdown');
  {
    for (const m of measurements) {
      const d = demands.find(x => x.id === m.demandId)!;
      const linhas = daDemanda(d.id);
      const training = TRAININGS.find((x: any) => x.id === d.trainingId);
      const ctx = {
        demandDefaultHours: Number(m.expenses?.classHours) > 0 ? Number(m.expenses.classHours)
          : d.tipo === 'interna' ? Number(d.horasPrevistas) : Number(training?.hours ?? 0),
        hibrida: d.tipo !== 'interna' && String(training?.modality ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() === 'HIBRIDO',
      };
      const esperado = computeMeasurementTotals(m, ctx);
      if (ctx.hibrida) {
        // Divergência CONHECIDA (measurementTotals.ts, tabela "DUAS resoluções"):
        // `computeMeasurementTotals` não recebe `hibrida` e resolve o ausente
        // pela carga cheia; o PAINEL zera até alguém digitar. O export segue o
        // painel — e o smoke prende as duas coisas: igual ao painel, diferente
        // do agregado do Dashboard.
        const painel = normalizeMeasurementBlocks(m, d.instructorId).reduce((acc, b) => acc + blockHoraAula(b, ctx), 0);
        perto(`${d.id} (híbrida): Σ hora/aula painel = fórmula do painel com hibrida`, soma(linhas.map(r => r.horaAulaPainel)), painel);
        check(`${d.id} (híbrida): e difere de computeMeasurementTotals, como documentado`, Math.abs(painel - esperado.horaAula) > 1e-6);
      } else {
        perto(`${d.id}: Σ hora/aula painel = computeMeasurementTotals(m, ctx).horaAula`, soma(linhas.map(r => r.horaAulaPainel)), esperado.horaAula);
      }
      const quebra = computePanelExpenseBreakdown(m);
      perto(`${d.id}: Σ despesas = computePanelExpenseBreakdown(m).total`, soma(linhas.map(r => r.despesas.total)), quebra.total);
      perto(`${d.id}: Σ hospedagem`, soma(linhas.map(r => r.despesas.hospedagem)), quebra.hospedagem);
      perto(`${d.id}: Σ alimentação`, soma(linhas.map(r => r.despesas.alimentacao)), quebra.alimentacao);
      perto(`${d.id}: Σ outros`, soma(linhas.map(r => r.despesas.outros)), quebra.outros);
      eq(`${d.id}: Σ órfãos`, soma(linhas.map(r => r.despesas.itensOrfaos)), quebra.itensOrfaos);
      perto(`${d.id}: Σ não reembolsável = computeMeasurementTotals.naoReembolsavel`, soma(linhas.map(r => r.naoReembolsavel)), esperado.naoReembolsavel);
    }

    // O card "Custo das Demandas Internas" (Dashboard.tsx, ~2859):
    //   aggregateMeasurements(ms).horaAula + aggregatePanelExpenseBreakdown(ms).total
    // sobre as medições das internas do recorte. Aqui: internas concluídas.
    // Invariante que sustenta a igualdade: o painel grava `classHours` com a
    // carga da demanda em toda abertura (measurementTotals.ts ~170), então a
    // resolução do Dashboard (sem contexto) e a do painel coincidem.
    const internasConcluidas = rows.filter(r => r.tipo === 'Interna' && r.statusCalculado === 'CONCLUIDA');
    const msInternas = measurements.filter(m => internasConcluidas.some(r => r.measurement === m));
    const card = aggregateMeasurements(msInternas).horaAula + aggregatePanelExpenseBreakdown(msInternas).total;
    perto('Σ Total geral (internas concluídas) = card Custo das Demandas Internas', soma(internasConcluidas.map(r => r.totalGeral)), card);
    check('e o card não é zero (a fixture tem interna medida)', card > 0);
    perto('Total geral = hora/aula painel + total despesas (linha a linha)',
      soma(rows.map(r => r.totalGeral)), soma(rows.map(r => (r.horaAulaPainel ?? 0) + r.despesas.total)));
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [B] Horas pagamento = applyMeasurementOverrides; em branco onde o Excel cala
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[B] Horas pagamento = a linha do Excel de pagamento');
  {
    const rateio = computeInstructorHoursByDemand({ demands, instructorAllocations, trainings: TRAININGS, measurements } as any);
    const esperado = applyMeasurementOverrides({
      rows: rateio,
      measurements,
      demands,
      participants,
      companions,
      eligibleDemandIds: eligibleDemandIdsForPayment({ demands, trainings: TRAININGS } as any),
    });
    const porChave = new Map(esperado.map(r => [`${r.demandId} ${r.instructorId}`, r]));

    for (const r of rows) {
      const k = `${r.demand.id} ${r.instructorId}`;
      const e = porChave.get(k);
      if (e) {
        perto(`${k}: horas pagamento = override`, r.horasPagamento ?? NaN, Math.round((e.horas + Number.EPSILON) * 100) / 100);
        check(`${k}: elegível`, r.elegivelPagamento);
        eq(`${k}: dias = formatDias do Excel`, r.diasPagamento, formatDias(e.dias));
      } else {
        eq(`${k}: sem linha no Excel -> horas pagamento EM BRANCO`, r.horasPagamento, null);
        check(`${k}: não elegível`, !r.elegivelPagamento);
      }
    }
    eq('todas as linhas do Excel têm linha no export', esperado.length, rows.filter(r => r.elegivelPagamento).length);

    // Casos nomeados — o que cada origem tem que dizer.
    eq('titular v2 sem horas digitadas -> rateio', de('DEM-900', 'INS-T').origemHoras, 'Rateio da alocação');
    eq('participante com horas -> informada', de('DEM-900', 'INS-2').origemHoras, 'Informada na medição');
    perto('participante paga as horas informadas (10), não horas_previstas', de('DEM-900', 'INS-2').horasPagamento ?? NaN, 10);
    eq('cliente dividido -> rateio (dividida)', de('DEM-100', 'INS-2').origemHoras, 'Rateio da alocação (dividida)');
    perto('cliente dividido: 1 de 2 dias de 16h = 8h', de('DEM-100', 'INS-2').horasPagamento ?? NaN, 8);
    eq('acompanhante sem horas -> sem linha, origem explica', de('DEM-101', 'INS-A').origemHoras, 'Acompanhante sem horas informadas');
    eq('acompanhante: horas painel = 0 (manual obrigatório)', de('DEM-101', 'INS-A').horasPainel, 0);
    eq('híbrida sem digitar: painel 0', de('DEM-102', 'INS-T').horasPainel, 0);
    perto('híbrida sem digitar: Excel paga as horas práticas do treinamento (8h)', de('DEM-102', 'INS-T').horasPagamento ?? NaN, 8);
    eq('demanda futura -> não elegível', de('DEM-103', 'INS-T').origemHoras, 'Não elegível: demanda não concluída');
    eq('sem ninguém -> sem alocação', de('DEM-104', '').origemHoras, 'Sem alocação em instructor_allocations');
    perto('hora/aula por horas pagamento = horas × valorHH', de('DEM-900', 'INS-2').horaAulaPagamento ?? NaN, 800);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [D] Rótulos
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[D] Rótulos das linhas');
  {
    eq('interna sem empresa -> Colabor (Interna)', de('DEM-900', 'INS-T').empresa, INTERNAL_COMPANY_LABEL);
    eq('interna: título = categoria — descrição', de('DEM-900', 'INS-T').titulo, 'SIPAT — Palestra de abertura');
    eq('cliente: título = nome do treinamento', de('DEM-100', 'INS-T').titulo, 'NR 35 Trabalho em Altura');
    eq('modalidade resolvida pelo treinamento (demanda diz PRESENCIAL, treinamento HIBRIDO)', de('DEM-102', 'INS-T').modalidade, 'Híbrido');
    check('e a linha sabe que é híbrida', de('DEM-102', 'INS-T').hibrida);
    eq('noturno pela regra do domínio (fim 18:00 -> não)', de('DEM-900', 'INS-T').noturno, false);
    const noturna = buildMedicoesRows({ ...src, demands: [demandaCliente({ id: 'DEM-N', endDate: '2026-08-11T19:00' })], measurements: [{ ...M2, demandId: 'DEM-N' }] });
    eq('noturno: fim 19:00 -> sim', noturna[0].noturno, true);
    eq('status calculado', de('DEM-103', 'INS-T').statusCalculado, 'ALOCADA');
    eq('região pelo mapa do contexto', de('DEM-100', 'INS-T').regiao, 'Minas Gerais');
    eq('região sem mapa -> id', de('DEM-900', 'INS-T').regiao, 'ES');
    eq('data dd/mm/yyyy', de('DEM-900', 'INS-T').medicaoAtualizadaEm, '05/08/2026');
    eq('chave tarifa: participante é Titular', de('DEM-900', 'INS-2').papelTarifa, 'Titular');
    eq('chave tarifa: acompanhante', de('DEM-101', 'INS-A').papelTarifa, 'Acompanhante');
    eq('formatDiasList == formatDias (contíguo)', formatDiasList(['2026-08-10', '2026-08-11']), formatDias(['2026-08-10', '2026-08-11']));
    eq('formatDiasList == formatDias (salteado)', formatDiasList(['2026-08-10', '2026-08-12']), formatDias(['2026-08-10', '2026-08-12']));
    eq('formatDiasList vazio -> "" (o Excel usa —; aqui em branco é não se aplica)', formatDiasList([]), '');
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [G] Colunas do dataset Medições
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[G] Colunas — Medições');
  {
    const keys = MEDICOES_DATASET.columns.map(c => c.key);
    eq('chaves únicas', new Set(keys).size, keys.length);
    const defaults = defaultColumnKeys(MEDICOES_DATASET);
    check('Horas pagamento e Elegível nascem ligadas', defaults.includes('horasPagamento') && defaults.includes('elegivelPagamento'));
    check('Horas informadas, Horas painel e Origem nascem desligadas',
      !defaults.includes('horasInformadas') && !defaults.includes('horasPainel') && !defaults.includes('origemHoras'));
    check('CPF não existe como coluna', !keys.some(k => /cpf/i.test(k)));
    check('todas as colunas resolvem em toda linha sem lançar', rows.every(r => MEDICOES_DATASET.columns.every(c => { c.get(r); return true; })));

    const tabela = buildTable(MEDICOES_DATASET, rows.slice(0, 2), ['instrutor', 'demandId', 'instrutor', 'horasPagamento']);
    eq('ordem da saída segue a seleção; repetida colapsa', tabela.columns.map(c => c.key), ['instrutor', 'demandId', 'horasPagamento']);
    eq('matriz alinhada', tabela.rows[0].length, 3);
    let lancou = false;
    try { buildTable(MEDICOES_DATASET, rows, ['naoExiste']); } catch { lancou = true; }
    check('chave desconhecida é erro', lancou);
    check('dataset Medições exige a view measurement', MEDICOES_DATASET.requiredView === 'measurement');
  }


  /* ──────────────────────────────────────────────────────────────────────────
   * [C2] Dataset Demandas — uma linha por demanda
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[C2] Dataset Demandas');
  {
    const logisticBlocks: any[] = [
      { demand_id: 'DEM-100', block_type: 'LOCOMOCAO', block_order: 1, transport_mode: 'TAXI' },
      { demand_id: 'DEM-100', block_type: 'LOCOMOCAO', block_order: 0, transport_mode: 'CARRO_ALUGADO', rental_company: 'Localiza', rental_check_in: '2026-08-10T11:00:00.000Z', receipt_url: ['a.pdf', 'b.pdf'] },
      { demand_id: 'DEM-100', block_type: 'HOSPEDAGEM', block_order: 0, lodging_mode: 'PRECISA_HOTEL', hotel_name: 'Ibis', hotel_check_in: '2026-08-09' },
      { demand_id: 'DEM-101', block_type: 'LOCOMOCAO', block_order: 0, transport_mode: 'OUTROS', transport_other_description: 'Van' },
    ];
    const documentFlags: any[] = [
      { demand_id: 'DEM-100', doc_type: 'LISTA_TURMA', file_path: 'demands/DEM-100/LISTA_TURMA.pdf', is_na: false },
      { demand_id: 'DEM-100', doc_type: 'LIBERACAO_INSTRUTOR', file_path: null, is_na: true },
    ];
    const dsrc = { ...src, logisticBlocks, documentFlags, demands: [...demands, demandaCliente({ id: 'DEM-SEM', instructorId: undefined })] };
    const drows = buildDemandasRows(dsrc);
    const dde = (id: string) => drows.find(r => r.demand.id === id)!;

    eq('uma linha por demanda', drows.length, dsrc.demands.length);
    eq('titulares do rateio (dividida: dois)', dde('DEM-100').titulares, ['Titular', 'Segundo']);
    eq('participantes só na interna', dde('DEM-900').participantes, ['Segundo']);
    eq('acompanhantes só no cliente', dde('DEM-101').acompanhantes, ['Acompanhante']);
    eq('interna não lista acompanhante', dde('DEM-900').acompanhantes, []);
    eq('sem ninguém -> listas vazias', dde('DEM-SEM').titulares, []);
    eq('bloco primário = block_order 0 (não o primeiro do array)', dde('DEM-100').locomocao?.transport_mode, 'CARRO_ALUGADO');
    eq('hospedagem primária', dde('DEM-100').hospedagem?.hotel_name, 'Ibis');
    eq('blocos contados', dde('DEM-100').nBlocosLogistica, 3);
    eq('lista de turma anexada', dde('DEM-100').listaTurma, 'Anexado');
    eq('liberação N/A', dde('DEM-100').liberacaoInstrutor, 'N/A');
    eq('sem flag -> Pendente', dde('DEM-101').listaTurma, 'Pendente');
    check('tem medição', dde('DEM-100').temMedicao && !dde('DEM-SEM').temMedicao);
    eq('carga horária cliente = training.hours', dde('DEM-100').cargaHoraria, 16);
    eq('carga horária interna = horas previstas', dde('DEM-900').cargaHoraria, 16);
    eq('transporte OUTROS com descrição', transportLabel('OUTROS', 'Van'), 'Outros — Van');
    eq('transporte NA', transportLabel('NA'), 'N/A');
    eq('transporte desconhecido -> vazio', transportLabel(null), '');
    eq('hospedagem PRECISA_HOTEL -> Hotel', lodgingLabel('PRECISA_HOTEL'), 'Hotel');
    eq('empresa na convenção do pagamento', dde('DEM-900').empresa, INTERNAL_COMPANY_LABEL);
    eq('status calculado (futura -> ALOCADA)', dde('DEM-103').statusCalculado, 'ALOCADA');

    const cols = DEMANDAS_DATASET.columns;
    check('todas as colunas resolvem em toda linha', drows.every(r => cols.every(c => { c.get(r); return true; })));
    const tabela = buildTable(DEMANDAS_DATASET, drows, defaultColumnKeys(DEMANDAS_DATASET));
    eq('matriz alinhada ao cabeçalho', tabela.rows[0].length, tabela.columns.length);
    const notas = cols.find(c => c.key === 'locomocaoNotas')!;
    eq('notas fiscais contadas', notas.get(dde('DEM-100')), 2);
    const checkin = cols.find(c => c.key === 'locomocaoCheckIn')!;
    check('check-in de locadora em dd/mm/yyyy HH:mm', /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(String(checkin.get(dde('DEM-100')))));
    const filtrado = applyFilters(drows, { ...EMPTY_FILTERS, instructorId: 'INS-T', tipo: 'interna' }, DEMANDAS_DATASET.filters, { trainingsById: t.fixtures.trainingsById, now: HOJE });
    eq('filtro de instrutor é ignorado em Demandas; tipo aplica', filtrado.map(r => r.demand.id), ['DEM-900']);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [G] Registry
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[G] Registry');
  {
    eq('registry: Medições, Demandas e Medição Vale', EXPORT_DATASETS.map(d => d.key), ['medicoes', 'demandas', 'medicao-vale']);
    const vale = EXPORT_DATASETS.find(d => d.key === 'medicao-vale')!;
    check('Medição Vale é dataset de template e exige a view measurement', isTemplateDataset(vale) && vale.requiredView === 'measurement');
    check('Medição Vale filtra por data de início, corredor, site e status da medição', isTemplateDataset(vale) && ['periodoInicio', 'corredor', 'site', 'statusMedicao'].every(f => vale.filters.includes(f as any)));
    for (const d of EXPORT_DATASETS) {
      if (isTemplateDataset(d)) continue;
      const keys = d.columns.map(c => c.key);
      eq(d.key + ': chaves únicas', new Set(keys).size, keys.length);
      check(d.key + ': tem coluna ligada por padrão', d.columns.some(c => c.defaultOn));
      check(d.key + ': declara requiredView', typeof d.requiredView === 'string' && d.requiredView.length > 0);
      check(d.key + ': sem CPF', !keys.some(k => /cpf/i.test(k)) && !d.columns.some(c => /cpf/i.test(c.header)));
    }
    eq('Demandas exige a view demands', getDataset('demandas').requiredView, 'demands');
    // Simula ROLE_PERMISSIONS: analista sem 'measurement'.
    const analista = new Set(['dashboard', 'demands', 'internal-demands', 'exportacoes']);
    eq('analista vê só Demandas', visibleDatasets(v => analista.has(v)).map(d => d.key), ['demandas']);
    const admin = new Set([...analista, 'measurement']);
    eq('admin vê os três', visibleDatasets(v => admin.has(v)).map(d => d.key), ['medicoes', 'demandas', 'medicao-vale']);
    eq('coordenador não vê nenhum', visibleDatasets(() => false).length, 0);
    let lancou = false;
    try { getDataset('nada' as any); } catch { lancou = true; }
    check('dataset desconhecido é erro', lancou);
    const registry = t.ler('domain/exports/registry.ts');
    check('o registry documenta que é defesa de UI e que RLS por papel fica para a leva de segurança',
      registry.includes('DEFESA DE UI') && /RLS por[\s*]+papel/.test(registry));
  }


  /* ──────────────────────────────────────────────────────────────────────────
   * [A1] Opção usarValorHH e coluna Origem da tarifa
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[A1] usarValorHH / Origem da tarifa');
  {
    // Fixtures: M1 titular valorHH 100 (informada), M2 v1 hourRate 120 (informada),
    // M4 híbrida valorHH 100, M5 v1 hourRate 100, M6 v1 hourRate 100.
    const semTarifa: any = { ...M1, id: 'MEA-DEM-905', demandId: 'DEM-905',
      expenses: { classHours: 16, participantes: [
        { instructorId: 'INS-T', papel: 'TITULAR' },                       // ausente
        { instructorId: 'INS-2', papel: 'PARTICIPANTE', horas: 10, valorHH: 0 }, // zero digitado
      ] } };
    const v1Vazia: any = { ...M2, id: 'MEA-DEM-906', demandId: 'DEM-906', expenses: { classHours: 16, hourRate: '' } };
    const srcT = {
      ...src,
      demands: [...demands, demandaInterna({ id: 'DEM-905' }), demandaCliente({ id: 'DEM-906' })],
      measurements: [...measurements, semTarifa, v1Vazia],
      participants: [...participants, { id: 'P2', demandId: 'DEM-905', instructorId: 'INS-2', startDate: null, endDate: null }],
      instructorAllocations: [...instructorAllocations,
        { id: 'A9', demandId: 'DEM-905', instructorId: 'INS-T', startDate: '2026-08-03T08:00', endDate: '2026-08-04T18:00' },
        { id: 'A10', demandId: 'DEM-906', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' }],
    };
    const ligada = buildMedicoesRows(srcT);
    const l = (d: string, i: string) => ligada.find(r => r.demand.id === d && r.instructorId === i)!;
    eq('tarifa informada -> Tarifa da medição', l('DEM-900', 'INS-T').origemTarifa, 'Tarifa da medição');
    eq('v1 hourRate informado -> Tarifa da medição', l('DEM-100', 'INS-T').origemTarifa, 'Tarifa da medição');
    eq('valorHH ausente -> Sem tarifa na medição', l('DEM-905', 'INS-T').origemTarifa, 'Sem tarifa na medição');
    eq('e o número continua 0 com a opção ligada (comportamento de hoje)', l('DEM-905', 'INS-T').valorHH, 0);
    eq('valorHH 0 digitado -> Tarifa zero (digitada)', l('DEM-905', 'INS-2').origemTarifa, 'Tarifa zero (digitada)');
    eq('v1 hourRate "" -> Sem tarifa na medição', l('DEM-906', 'INS-T').origemTarifa, 'Sem tarifa na medição');
    eq('segundo titular v1 sem bloco -> origem em branco', l('DEM-100', 'INS-2').origemTarifa, '');
    check('default da opção é ligada', DEFAULT_OPTIONS.usarValorHH === true);

    const desligada = buildMedicoesRows({ ...srcT, options: { ...DEFAULT_OPTIONS, usarValorHH: false } });
    const d = (dd: string, i: string) => desligada.find(r => r.demand.id === dd && r.instructorId === i)!;
    eq('desligada: Valor HH em branco', d('DEM-900', 'INS-T').valorHH, null);
    eq('desligada: Hora/aula painel em branco', d('DEM-900', 'INS-T').horaAulaPainel, null);
    eq('desligada: Hora/aula pagamento em branco', d('DEM-900', 'INS-2').horaAulaPagamento, null);
    eq('desligada: Total geral em branco', d('DEM-900', 'INS-T').totalGeral, null);
    eq('desligada: origem explica', d('DEM-900', 'INS-T').origemTarifa, 'Tarifa da medição desativada');
    perto('desligada: despesas continuam', d('DEM-900', 'INS-T').despesas.total, 230);
    perto('desligada: horas pagamento continuam', d('DEM-900', 'INS-2').horasPagamento ?? NaN, 10);
    check('Origem da tarifa nasce ligada', defaultColumnKeys(MEDICOES_DATASET).includes('origemTarifa'));
    eq('Medições oferece as duas opções', MEDICOES_DATASET.options, ['usarValorHH', 'incluirCanceladas']);
    eq('Demandas oferece só canceladas', DEMANDAS_DATASET.options, ['incluirCanceladas']);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [A2] Opção incluirCanceladas
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[A2] incluirCanceladas');
  {
    const cancelada = demandaCliente({ id: 'DEM-CAN', status: 'CANCELADA' });
    const linhas: any[] = [
      { demand: demandaCliente() },
      { demand: cancelada },
    ];
    const ctxBase = { trainingsById: t.fixtures.trainingsById, now: HOJE };
    const todos: any = ['periodo', 'status'];
    check('default da opção é desligada', DEFAULT_OPTIONS.incluirCanceladas === false);
    eq('desligada + status Todos -> cancelada fora', applyFilters(linhas, EMPTY_FILTERS, todos, ctxBase).map(r => r.demand.id), ['DEM-100']);
    eq('desligada + status Cancelada -> força inclusão', applyFilters(linhas, { ...EMPTY_FILTERS, status: 'CANCELADA' }, todos, ctxBase).map(r => r.demand.id), ['DEM-CAN']);
    eq('ligada + status Todos -> as duas', applyFilters(linhas, EMPTY_FILTERS, todos, { ...ctxBase, options: { ...DEFAULT_OPTIONS, incluirCanceladas: true } }).length, 2);
    eq('desligada vale mesmo sem o filtro de status declarado', applyFilters(linhas, EMPTY_FILTERS, ['periodo'], ctxBase).length, 1);
    eq('sem ctx.options -> defaults (F1 chamadores continuam válidos)', applyFilters(linhas, EMPTY_FILTERS, todos, { trainingsById: t.fixtures.trainingsById }).length, 1);
  }

  return falhas;
}
