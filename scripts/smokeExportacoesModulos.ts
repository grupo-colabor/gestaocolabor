/**
 * SMOKE — Exportações: módulos de 17/09/2026 (Logística, Instrutores, Despesas)
 *
 * Chamado por smokeExportacoes.ts (runner assíncrono, porque cada bloco grava
 * o XLSX das fixtures em C:\tmp quando a pasta existe). Mesmo contrato dos
 * blocos irmãos: recebe as fixtures e os helpers, devolve o nº de falhas.
 *
 *   [L] Logística — uma linha por bloco de `logistic_blocks`; checklist igual
 *       ao do Controle Logístico (a entrada é montada aqui de novo, como a
 *       tela monta, e comparada com a da linha); filtro de modo de transporte
 *       recorta só Locomoção; "só com pendência de documento"; instrutor por
 *       id ou por nome legado; bloco órfão fora.
 *   [I] Instrutores — uma linha por vínculo (titular, participante de interna,
 *       acompanhante), dias = assignmentDays, dias no período e total distinto
 *       por pessoa; guarda anti-sensível no tipo da carga, na fonte e nas colunas.
 *   [D$] Despesas — uma linha por item de `attachments`, dono pelo bloco de
 *       resolvePersonBlocks (sem dono / dono removido → titular; sem pessoa),
 *       órfão de Outros listado e fora do Σ; Σ por pessoa e bucket =
 *       blockExpenseBreakdown e Σ da medição = computePanelExpenseBreakdown,
 *       com e sem itemFilter das flags; filtros de categoria e flags.
 */
import fs from 'fs';
import path from 'path';

import { buildLogisticsChecklist } from '../domain/demandLogisticsStatus';
import { isInternalDemand } from '../domain/demandLabel';
import { assignmentDays } from '../domain/personScheduleConflict';
import { buildLogisticaRows, LOGISTICA_DATASET, type LogisticaRow } from '../domain/exports/datasets/logistica';
import { buildInstrutoresRows, INSTRUTORES_DATASET, type InstrutorRow } from '../domain/exports/datasets/instrutores';
import { buildDespesasRows, DESPESAS_DATASET, type DespesaRow } from '../domain/exports/datasets/despesas';
import { resolveMeasurementPeople } from '../domain/measurementPeople';
import { resolvePersonBlocks } from '../domain/measurementPersonBlocks';
import {
  blockExpenseBreakdown,
  computePanelExpenseBreakdown,
  isNaoReembolsavel,
  isPagoPeloInstrutor,
  type PanelExpenseBucket,
} from '../domain/measurementTotals';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { applyFilters, buildFilterOptions } from '../domain/exports/filters';
import { EMPTY_FILTERS, type DatasetDef, type FilterableRow } from '../domain/exports/types';
import { buildXlsxBuffer } from '../services/exports/xlsxWriter';
import type { SmokeTools } from './smokeExportacoesDatasets';

const TMP = 'C:\\tmp';

/** Grava o XLSX das fixtures (todas as colunas) em C:\tmp, se a pasta existir. */
async function gravarXlsx<Row extends FilterableRow>(dataset: DatasetDef<Row>, rows: Row[], nome: string): Promise<string | null> {
  if (!fs.existsSync(TMP)) return null;
  const table = buildTable(dataset, rows, dataset.columns.map(c => c.key));
  const buf = await buildXlsxBuffer(table, { sheetName: dataset.label, title: `Exportação — ${dataset.label} (fixtures)` });
  const destino = path.join(TMP, nome);
  fs.writeFileSync(destino, Buffer.from(buf));
  return destino;
}

export async function runModulosChecks(t: SmokeTools): Promise<number> {
  let falhas = 0;
  const check: SmokeTools['check'] = (nome, cond, det) => { if (!cond) falhas++; t.check(nome, cond, det); };
  const eq: SmokeTools['eq'] = (nome, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(nome, a, b); };
  const perto: SmokeTools['perto'] = (nome, a, b) => { if (!(Math.abs(a - b) < 1e-6)) falhas++; t.perto(nome, a, b); };

  const { TRAININGS, COMPANIES, INSTRUCTORS, demandaCliente, demandaInterna, HOJE, trainingsById } = t.fixtures;

  /* ──────────────────────────────────────────────────────────────────────────
   * [L] Logística
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[L] Logística — uma linha por bloco, checklist da tela');
  {
    // DEM-100: dois blocos (locomoção carro alugado do INS-T; hospedagem hotel) +
    //   linha no controle com tudo marcado + docs: lista anexada, liberação N/A → pronta.
    // DEM-101: um bloco de locomoção legado (só nome), SEM linha no controle e
    //   sem docs → cai nos campos legados da demanda; liberação e lista pendentes.
    // DEM-900 (interna): hospedagem; controle sem material; lista não se aplica;
    //   liberação pendente → 1 documento pendente.
    // DEM-XXX: bloco órfão (demanda inexistente) → fora, sem quebrar.
    const D100 = demandaCliente({ corredor: 'Sudeste', logisticsHotel: 'CONFIRMADO' });
    const D101 = demandaCliente({ id: 'DEM-101', startDate: '2026-08-20T08:00', endDate: '2026-08-21T17:00', demandState: 'ES', corredor: 'Ferrovia/MG', logisticsTransport: 'CONFIRMADO', logisticsHotel: 'NAO_NECESSARIO', materialReady: true });
    const D900 = demandaInterna({ corredor: 'Sudeste' });
    const demands = [D100, D101, D900];

    const blocks: any[] = [
      { id: 'B1', demand_id: 'DEM-100', block_type: 'HOSPEDAGEM', block_order: 0, instructor_id: 'INS-T', instructor_name: 'Titular', lodging_mode: 'PRECISA_HOTEL', hotel_name: 'Hotel Itabira', hotel_city: 'Itabira', hotel_check_in: '2026-08-09', hotel_check_out: '2026-08-11', hotel_payment: 'FATURADO', hotel_receipt_urls: ['h1.pdf'] },
      { id: 'B2', demand_id: 'DEM-100', block_type: 'LOCOMOCAO', block_order: 0, instructor_id: 'INS-T', instructor_name: 'Titular', transport_mode: 'CARRO_ALUGADO', rental_company: 'Localiza', rental_agency_location: 'BH Aeroporto', rental_locator: 'ABC123', car_category: 'Econômico', rental_check_in: '2026-08-09T15:00:00-03:00', rental_check_out: '2026-08-11T20:00:00-03:00', receipt_url: ['nf1.pdf', 'nf2.pdf'] },
      { id: 'B3', demand_id: 'DEM-100', block_type: 'LOCOMOCAO', block_order: 1, instructor_id: 'INS-A', instructor_name: 'Acompanhante', transport_mode: 'CARRO_APLICATIVO' },
      { id: 'B4', demand_id: 'DEM-101', block_type: 'LOCOMOCAO', block_order: 0, instructor_id: null, instructor_name: 'Fulano Legado', transport_mode: 'CARRO_PROPRIO' },
      { id: 'B5', demand_id: 'DEM-900', block_type: 'HOSPEDAGEM', block_order: 0, instructor_id: 'INS-2', instructor_name: 'Segundo', lodging_mode: 'NAO_NECESSARIO' },
      { id: 'B9', demand_id: 'DEM-XXX', block_type: 'LOCOMOCAO', block_order: 0, instructor_id: 'INS-T', transport_mode: 'TAXI' },
    ];
    const allocs: any[] = [
      { demand_id: 'DEM-100', transport_mode: 'CARRO_ALUGADO', lodging_mode: 'PRECISA_HOTEL', has_car: true, has_hotel: true, has_material: true, has_release_pdf: false, has_class_list_pdf: false, overall_status: 'PENDENTE' },
      { demand_id: 'DEM-900', transport_mode: 'NAO_NECESSARIO', lodging_mode: 'NAO_NECESSARIO', has_car: false, has_hotel: false, has_material: false, has_release_pdf: false, has_class_list_pdf: false, overall_status: 'PENDENTE' },
    ];
    const flags: any[] = [
      { demand_id: 'DEM-100', doc_type: 'LISTA_TURMA', file_path: 'docs/lista.pdf', is_na: false },
      { demand_id: 'DEM-100', doc_type: 'LIBERACAO_INSTRUTOR', file_path: null, is_na: true },
    ];

    const rows = buildLogisticaRows({
      demands, trainings: TRAININGS, instructors: INSTRUCTORS, companies: COMPANIES,
      logisticBlocks: blocks, logisticAllocations: allocs, documentFlags: flags, now: HOJE,
    });
    const chave = (r: LogisticaRow) => `${r.demand.id}:${r.blocoTipo}:${r.blocoOrdem}`;

    eq('uma linha por bloco com demanda; órfão fora; ordem = data desc, demanda, locomoção antes de hospedagem, ordem do bloco',
      rows.map(chave), ['DEM-101:Locomoção:1', 'DEM-100:Locomoção:1', 'DEM-100:Locomoção:2', 'DEM-100:Hospedagem:1', 'DEM-900:Hospedagem:1']);

    // Checklist igual ao da tela: a entrada montada aqui como o Controle monta (docsMap + checklistFor).
    const esperado = (d: any) => {
      const alloc = allocs.find(a => a.demand_id === d.id);
      const docRows = flags.filter(f => f.demand_id === d.id);
      const docs = docRows.length
        ? {
            has_class_list_pdf: docRows.some(r => r.doc_type === 'LISTA_TURMA' && (!!r.file_path || r.is_na === true)),
            has_release_pdf: docRows.some(r => r.doc_type === 'LIBERACAO_INSTRUTOR' && (!!r.file_path || r.is_na === true)),
          }
        : undefined;
      return buildLogisticsChecklist({
        isInternal: isInternalDemand(d), hasAlloc: !!alloc,
        hasCar: alloc?.has_car, transportMode: alloc?.transport_mode, hasHotel: alloc?.has_hotel, lodgingMode: alloc?.lodging_mode, hasMaterial: alloc?.has_material,
        hasReleasePdf: docs ? docs.has_release_pdf : alloc?.has_release_pdf,
        hasClassListPdf: docs ? docs.has_class_list_pdf : alloc?.has_class_list_pdf,
        legacy: { logisticsHotel: d.logisticsHotel, logisticsTransport: d.logisticsTransport, materialReady: d.materialReady },
      });
    };
    for (const d of demands) {
      const das = rows.filter(r => r.demand.id === d.id);
      check(`${d.id}: checklist da linha = buildLogisticsChecklist com a entrada da tela`, das.every(r => JSON.stringify(r.checklist) === JSON.stringify(esperado(d))));
    }
    const r100 = rows.find(r => r.demand.id === 'DEM-100')!;
    check('DEM-100: pronta (docs anexado/N/A vencem as flags falsas da linha)', r100.checklist.ready && r100.checklist.release === 'OK' && r100.checklist.list === 'OK');
    eq('DEM-100: documentos pendentes 0; status gravado ainda PENDENTE (write-back defasado é visível)', [r100.documentosPendentes, r100.statusGravado, r100.temControle], [0, 'PENDENTE', true]);
    const r101 = rows.find(r => r.demand.id === 'DEM-101')!;
    eq('DEM-101 sem linha no controle: legado resolve carro/hotel/material; liberação e lista pendentes', [r101.temControle, r101.checklist.car, r101.checklist.hotel, r101.checklist.material, r101.documentosPendentes], [false, 'OK', 'OK', 'OK', 2]);
    eq('DEM-101: flags de documento', [r101.listaTurma, r101.liberacaoInstrutor], ['Pendente', 'Pendente']);
    const r900 = rows.find(r => r.demand.id === 'DEM-900')!;
    eq('interna: lista e material NAO_APLICA; liberação pendente conta 1', [r900.checklist.list, r900.checklist.material, r900.documentosPendentes], ['NAO_APLICA', 'NAO_APLICA', 1]);

    // Pessoa do bloco: id → nome do cadastro; legado → nome gravado; filtro só alcança id.
    eq('instrutor por id e por nome legado', rows.map(r => `${r.instructorName}:${r.instrutorOrigem}`), ['Fulano Legado:nome', 'Titular:id', 'Acompanhante:id', 'Titular:id', 'Segundo:id']);
    const ctx = { trainingsById, now: HOJE };
    eq('filtro de instrutor: só blocos com id', applyFilters(rows, { ...EMPTY_FILTERS, instructorId: 'INS-T' }, LOGISTICA_DATASET.filters, ctx).map(chave), ['DEM-100:Locomoção:1', 'DEM-100:Hospedagem:1']);

    // Modo de transporte: só Locomoção tem; Hospedagem sai com o filtro ativo.
    eq('linhas de hospedagem não têm modo; locomoção tem a chave crua', rows.map(r => r.modoTransporte ?? '—'), ['CARRO_PROPRIO', 'CARRO_ALUGADO', 'CARRO_APLICATIVO', '—', '—']);
    eq('filtro modo = CARRO_ALUGADO recorta só a locomoção do DEM-100', applyFilters(rows, { ...EMPTY_FILTERS, modoTransporte: 'CARRO_ALUGADO' }, LOGISTICA_DATASET.filters, ctx).map(chave), ['DEM-100:Locomoção:1']);
    eq('filtro de modo não age em dataset que não o declara', applyFilters(rows, { ...EMPTY_FILTERS, modoTransporte: 'CARRO_ALUGADO' }, ['periodo'], ctx).length, 5);
    const opts = buildFilterOptions(rows, TRAININGS, COMPANIES, INSTRUCTORS);
    eq('opções de modo presentes, com o rótulo da tela', opts.modosTransporte, [
      { value: 'CARRO_ALUGADO', label: 'Carro Alugado' }, { value: 'CARRO_APLICATIVO', label: 'Carro Aplicativo' }, { value: 'CARRO_PROPRIO', label: 'Carro Próprio' },
    ]);

    // Só com pendência de documento.
    eq('só com pendência de documento: DEM-101 (2) e a interna (1)', applyFilters(rows, { ...EMPTY_FILTERS, somentePendenciaDoc: true }, LOGISTICA_DATASET.filters, ctx).map(r => r.demand.id), ['DEM-101', 'DEM-900']);
    eq('período por interseção (20-21/08 pega só DEM-101)', applyFilters(rows, { ...EMPTY_FILTERS, dataInicio: '2026-08-20', dataFim: '2026-08-21' }, LOGISTICA_DATASET.filters, ctx).map(r => r.demand.id), ['DEM-101']);
    eq('corredor', applyFilters(rows, { ...EMPTY_FILTERS, corredor: 'Ferrovia/MG' }, LOGISTICA_DATASET.filters, ctx).map(r => r.demand.id), ['DEM-101']);
    eq('UF da demanda', applyFilters(rows, { ...EMPTY_FILTERS, uf: 'es' }, LOGISTICA_DATASET.filters, ctx).map(r => r.demand.id), ['DEM-101', 'DEM-900']);

    // Colunas: bloco de locomoção imprime as células de locomoção e deixa as de hospedagem em branco, e vice-versa.
    const table = buildTable(LOGISTICA_DATASET, rows, LOGISTICA_DATASET.columns.map(c => c.key));
    const idx = (k: string) => table.columns.findIndex(c => c.key === k);
    const loc = table.rows[1]; // DEM-100 locomoção 1
    const hosp = table.rows[3]; // DEM-100 hospedagem 1
    eq('locomoção: meio, locadora, notas; hospedagem em branco', [loc[idx('transporteMeio')], loc[idx('transporteLocadora')], loc[idx('transporteNotas')], loc[idx('hospedagemTipo')], loc[idx('hospedagemComprovantes')]], ['Carro Alugado', 'Localiza', 2, '', null]);
    eq('hospedagem: hotel, check-in dd/mm/yyyy, comprovantes; locomoção em branco', [hosp[idx('hospedagemTipo')], hosp[idx('hospedagemHotel')], hosp[idx('hospedagemCheckIn')], hosp[idx('hospedagemComprovantes')], hosp[idx('transporteMeio')], hosp[idx('transporteNotas')]], ['Hotel', 'Hotel Itabira', '09/08/2026', 1, '', null]);
    check('retirada do carro em dd/mm/yyyy HH:mm', /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(String(loc[idx('transporteCheckIn')])));
    eq('checks com rótulo; Logística pronta boolean', [loc[idx('checkLiberacao')], loc[idx('checkLista')], loc[idx('logisticaPronta')]], ['OK', 'OK', true]);
    const chaves = defaultColumnKeys(LOGISTICA_DATASET);
    check('defaults: demanda, empresa, bloco, instrutor, meio, hospedagem, liberação, lista, pronta e documentos pendentes ligados',
      ['demandId', 'empresa', 'blocoTipo', 'instrutor', 'transporteMeio', 'hospedagemTipo', 'checkLiberacao', 'checkLista', 'logisticaPronta', 'documentosPendentes'].every(k => chaves.includes(k)));
    check('defaults: ordem do bloco, status gravado e checks de carro/hotel/material desligados',
      ['blocoOrdem', 'statusGravado', 'checkCarro', 'checkHotel', 'checkMaterial'].every(k => !chaves.includes(k)));

    const arquivo = await gravarXlsx(LOGISTICA_DATASET, rows, 'exportacao-logistica-fixtures.xlsx');
    check(`XLSX das fixtures gravado${arquivo ? ` em ${arquivo}` : ' (C:\\tmp ausente — pulado)'}`, arquivo === null || fs.statSync(arquivo).size > 5_000);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [I] Instrutores
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[I] Instrutores — uma linha por vínculo, três papéis, dias no período');
  {
    // DEM-100 (10-11/08): dividida por dias entre INS-T (10) e INS-2 (11);
    //   acompanhante INS-A com uma linha por dia (10, 10 repetido, 11) → 2 dias;
    //   INS-T também gravado como acompanhante → não repete.
    // DEM-101 (20-21/08): sem alocação → principal INS-T nos 2 dias.
    // DEM-900 interna (03-04/08): titular INS-T (principal); participantes INS-2 só
    //   no dia 03 e INS-T (== titular, ignorado); acompanhante em interna é ignorado.
    // DEM-104 cancelada (10-11/08): INS-3 titular — sai pelo filtro e não conta no total.
    const D100 = demandaCliente();
    const D101 = demandaCliente({ id: 'DEM-101', startDate: '2026-08-20T08:00', endDate: '2026-08-21T17:00', demandState: 'ES', companyId: 'C1' });
    const D900 = demandaInterna();
    const D104 = demandaCliente({ id: 'DEM-104', status: 'CANCELADA', instructorId: 'INS-3' });
    const demands = [D100, D101, D900, D104];
    const alocs: any[] = [
      { id: 'A1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
      { id: 'A2', demandId: 'DEM-100', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
      { id: 'A3', demandId: 'DEM-104', instructorId: 'INS-3', startDate: '2026-08-10T08:00', endDate: '2026-08-11T17:00' },
    ];
    const comps: any[] = [
      { id: 'C1', demandId: 'DEM-100', instructorId: 'INS-A', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
      { id: 'C2', demandId: 'DEM-100', instructorId: 'INS-A', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
      { id: 'C3', demandId: 'DEM-100', instructorId: 'INS-A', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
      { id: 'C4', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
      { id: 'C5', demandId: 'DEM-900', instructorId: 'INS-A', startDate: '2026-08-03T08:00', endDate: '2026-08-04T17:00' },
    ];
    const parts: any[] = [
      { id: 'P1', demandId: 'DEM-900', instructorId: 'INS-2', startDate: '2026-08-03', endDate: '2026-08-03' },
      { id: 'P2', demandId: 'DEM-900', instructorId: 'INS-T', startDate: '2026-08-03', endDate: '2026-08-04' },
    ];
    const instrutoresUf = INSTRUCTORS.map((i: any) => ({ ...i, uf: i.id === 'INS-T' ? 'MG' : i.id === 'INS-2' ? 'es' : '' }));
    const periodo = { dataInicio: '2026-08-10', dataFim: '2026-08-20' };
    const src = { demands, trainings: TRAININGS, instructors: instrutoresUf, companies: COMPANIES, instructorAllocations: alocs, participants: parts, companions: comps, now: HOJE, periodo };
    const rows = buildInstrutoresRows(src);
    const chave = (r: InstrutorRow) => `${r.instructorName}:${r.demand.id}:${r.papel}`;

    eq('uma linha por vínculo, três papéis, sem repetir titular como acompanhante/participante; ordem por nome, primeiro dia, demanda',
      rows.map(chave), [
        'Acompanhante:DEM-100:ACOMPANHANTE',
        'Segundo:DEM-900:PARTICIPANTE',
        'Segundo:DEM-100:TITULAR',
        'Terceiro:DEM-104:TITULAR',
        'Titular:DEM-900:TITULAR',
        'Titular:DEM-100:TITULAR',
        'Titular:DEM-101:TITULAR',
      ]);
    const linha = (k: string) => rows.find(r => chave(r) === k)!;

    // Dias = assignmentDays, o mesmo cálculo da checagem de conflito da agenda.
    eq('titular dividido: só o dia da alocação', linha('Titular:DEM-100:TITULAR').dias, assignmentDays({ demandId: 'DEM-100', startDate: alocs[0].startDate, endDate: alocs[0].endDate }, D100));
    eq('acompanhante: união das linhas por dia, sem duplicar', linha('Acompanhante:DEM-100:ACOMPANHANTE').dias, ['2026-08-10', '2026-08-11']);
    eq('principal sem alocação: todos os dias da demanda; vínculo principal', [linha('Titular:DEM-101:TITULAR').dias, linha('Titular:DEM-101:TITULAR').vinculo], [['2026-08-20', '2026-08-21'], 'principal']);
    eq('participante de interna: só o dia dele; vínculo participante', [linha('Segundo:DEM-900:PARTICIPANTE').dias, linha('Segundo:DEM-900:PARTICIPANTE').vinculo], [['2026-08-03'], 'participante']);
    check('acompanhante gravado em interna é ignorado', !rows.some(r => r.demand.id === 'DEM-900' && r.papel === 'ACOMPANHANTE'));

    // Dias no período e total distinto por pessoa (10-20/08).
    eq('dias no período: DEM-100 inteira; DEM-101 só o dia 20; interna zero', [linha('Titular:DEM-100:TITULAR').diasNoPeriodo.length, linha('Titular:DEM-101:TITULAR').diasNoPeriodo.length, linha('Titular:DEM-900:TITULAR').diasNoPeriodo.length], [1, 1, 0]);
    eq('total de dias do INS-T no período = 2 distintos (10/08 e 20/08), igual em todas as linhas dele', rows.filter(r => r.instructorId === 'INS-T').map(r => r.totalDiasInstrutorPeriodo), [2, 2, 2]);
    eq('cancelada não conta no total (INS-3 = 0) e nem entra sem a opção', [linha('Terceiro:DEM-104:TITULAR').totalDiasInstrutorPeriodo, applyFilters(rows, EMPTY_FILTERS, INSTRUTORES_DATASET.filters, { trainingsById, now: HOJE }).some(r => r.demand.id === 'DEM-104')], [0, false]);
    const semPeriodo = buildInstrutoresRows({ ...src, periodo: undefined });
    eq('sem período: dias no período = todos os dias do vínculo', semPeriodo.map(r => r.diasNoPeriodo.length), semPeriodo.map(r => r.dias.length));
    eq('UF do instrutor: do cadastro, maiúscula; vazia quando não há', [linha('Titular:DEM-100:TITULAR').instructorUf, linha('Segundo:DEM-100:TITULAR').instructorUf, linha('Acompanhante:DEM-100:ACOMPANHANTE').instructorUf], ['MG', 'ES', '']);
    eq('carga: cliente = horas do treinamento; interna = horas previstas', [linha('Titular:DEM-100:TITULAR').cargaHoraria, linha('Titular:DEM-900:TITULAR').cargaHoraria], [16, 16]);

    // Filtros: papel com a terceira opção; UF = da demanda; instrutor; período por interseção.
    const ctx = { trainingsById, now: HOJE };
    eq('filtro papel = Participante', applyFilters(rows, { ...EMPTY_FILTERS, papel: 'PARTICIPANTE' }, INSTRUTORES_DATASET.filters, ctx).map(chave), ['Segundo:DEM-900:PARTICIPANTE']);
    eq('filtro UF é o da demanda (ES → DEM-101 e a interna), não o do instrutor', applyFilters(rows, { ...EMPTY_FILTERS, uf: 'ES' }, INSTRUTORES_DATASET.filters, ctx).map(r => r.demand.id), ['Segundo:DEM-900:PARTICIPANTE', 'Titular:DEM-900:TITULAR', 'Titular:DEM-101:TITULAR'].map(k => linha(k).demand.id));
    eq('filtro de instrutor', applyFilters(rows, { ...EMPTY_FILTERS, instructorId: 'INS-2' }, INSTRUTORES_DATASET.filters, ctx).map(chave), ['Segundo:DEM-900:PARTICIPANTE', 'Segundo:DEM-100:TITULAR']);
    const opts = buildFilterOptions(rows, TRAININGS, COMPANIES, instrutoresUf);
    eq('opções de papel trazem os três', opts.papel.map(p => p.value), ['TITULAR', 'PARTICIPANTE', 'ACOMPANHANTE']);

    // Guarda anti-sensível: tipo da fonte, código do dataset, mapeamento do loader e colunas.
    const sensivel = /cpf|e-?mail|address|endere|observations|operationalNotes|tarifa|valorHH|hourRate|R\$/i;
    const fonte = t.semComentarios(t.ler('domain/exports/datasets/instrutores.ts'));
    check('dataset Instrutores não lê nenhum campo sensível do instrutor', !sensivel.test(fonte));
    check('colunas de Instrutores sem chave/cabeçalho sensível', !INSTRUTORES_DATASET.columns.some(c => sensivel.test(c.key) || sensivel.test(c.header)));
    check('nenhuma coluna de Instrutores é moeda', !INSTRUTORES_DATASET.columns.some(c => c.kind === 'currency'));
    const loader = t.semComentarios(t.ler('services/exports/loadExportData.ts'));
    check('loader: instructors da carga é só { id, name, uf } (tipo e mapeamento)',
      loader.includes('instructors: { id: string; name: string; uf: string }[];') &&
      loader.includes('return { id: i.id, name: i.name, uf: String((r as any).residence_location ?? \'\').trim() };'));
    const chaves = defaultColumnKeys(INSTRUTORES_DATASET);
    check('defaults: instrutor, papel, UF do instrutor, demanda, dias alocados no período e carga ligados; total por pessoa desligado',
      ['instrutor', 'papel', 'instrutorUf', 'demandId', 'nDiasNoPeriodo', 'cargaHoraria'].every(k => chaves.includes(k)) && !chaves.includes('totalDiasInstrutorPeriodo'));

    const table = buildTable(INSTRUTORES_DATASET, rows, INSTRUTORES_DATASET.columns.map(c => c.key));
    const idx = (k: string) => table.columns.findIndex(c => c.key === k);
    const ra = table.rows[0];
    eq('célula: papel rotulado, dias do vínculo em dd/mm/yyyy a dd/mm/yyyy', [ra[idx('papel')], ra[idx('diasVinculo')]], ['Acompanhante', '10/08/2026 a 11/08/2026']);
    const arquivo = await gravarXlsx(INSTRUTORES_DATASET, rows, 'exportacao-instrutores-fixtures.xlsx');
    check(`XLSX das fixtures gravado${arquivo ? ` em ${arquivo}` : ' (C:\\tmp ausente — pulado)'}`, arquivo === null || fs.statSync(arquivo).size > 5_000);
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * [D$] Despesas
   * ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[D$] Despesas — uma linha por item, Σ = painel');
  {
    // M1 — INTERNA v2 (DEM-900): titular INS-T + participante INS-2. Itens: sem dono
    //   (→ titular) e pago pelo instrutor; do participante, não reembolsa; de dono
    //   removido INS-9 (→ titular), Outros com linha; ÓRFÃO de Outros; valor avulso.
    // M2 — CLIENTE dividida por dias (DEM-100), medição sem `participantes`: desde
    //   09/2026 a dividida é v2 (um bloco por titular); os itens sem dono vão para o
    //   principal INS-T e o segundo titular INS-2 fica com bloco vazio.
    // M3 — CLIENTE v2 (DEM-101) com acompanhante INS-A: item do acompanhante com
    //   bucket+path sem url (tem anexo pela reconstrução); item sem url nem path
    //   com MIME de arquivo (não vinculado).
    // M4 — medição SEM NINGUÉM (DEM-102, sem instrutor nem alocação): linhas "(sem instrutor)".
    // M5 — medição órfã (demanda inexistente): nenhuma linha, sem quebrar.
    const D900 = demandaInterna();
    const D100 = demandaCliente();
    const D101 = demandaCliente({ id: 'DEM-101', startDate: '2026-08-20T08:00', endDate: '2026-08-21T17:00' });
    const D102 = demandaCliente({ id: 'DEM-102', instructorId: undefined, startDate: '2026-08-25T08:00', endDate: '2026-08-25T17:00' });
    const demands = [D900, D100, D101, D102];
    const alocs: any[] = [
      { id: 'A1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
      { id: 'A2', demandId: 'DEM-100', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
      { id: 'A3', demandId: 'DEM-101', instructorId: 'INS-T', startDate: '2026-08-20T08:00', endDate: '2026-08-21T17:00' },
    ];
    const parts: any[] = [{ id: 'P1', demandId: 'DEM-900', instructorId: 'INS-2', startDate: '2026-08-03', endDate: '2026-08-04' }];
    const comps: any[] = [{ id: 'C1', demandId: 'DEM-101', instructorId: 'INS-A', startDate: '2026-08-20T08:00', endDate: '2026-08-21T17:00' }];
    const M1: any = {
      id: 'MEA-900', demandId: 'DEM-900', status: 'CONFERENCIA', updatedAt: '2026-08-05T10:00:00',
      expenses: { classHours: 16, participantes: [{ instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 }, { instructorId: 'INS-2', papel: 'PARTICIPANTE', horas: 10, valorHH: 80 }] },
      attachments: [
        { id: 'a1', name: 'hotel.pdf', url: 'https://x/hotel.pdf', type: 'application/pdf', date: '2026-08-03', category: 'HOSPEDAGEM', value: 200, pagoPeloInstrutor: true },
        { id: 'a2', name: 'almoco.jpg', url: 'https://x/almoco.jpg', type: 'image/jpeg', date: '2026-08-03', category: 'ALMOCO', value: '50,00', instructorId: 'INS-2', reembolsavel: false },
        { id: 'a3', name: 'pedagio.pdf', url: 'https://x/pedagio.pdf', type: 'application/pdf', date: '2026-08-04', category: 'OUTROS', value: 30, otherId: 'O1', instructorId: 'INS-9' },
        { id: 'a4', name: 'orfao.pdf', url: 'https://x/orfao.pdf', type: 'application/pdf', date: '2026-08-04', category: 'OUTROS', value: 5, otherId: 'ZZ' },
        { id: 'a5', name: 'Valor Avulso', url: '#', type: 'text/plain', date: '2026-08-04', category: 'JANTAR', value: 40, instructorId: 'INS-2', pagoPeloInstrutor: true, reembolsavel: false },
      ],
      otherExpenses: [{ id: 'O1', description: 'Pedágio', value: '' }],
    };
    const M2: any = {
      id: 'MEA-100', demandId: 'DEM-100', status: 'LANCAMENTO', updatedAt: '2026-08-12',
      expenses: { classHours: 16, hourRate: 120 },
      attachments: [
        { id: 'b1', name: 'uber.pdf', url: 'https://x/uber.pdf', type: 'application/pdf', date: '2026-08-10', category: 'LOCOMOCAO', value: 80 },
        { id: 'b2', name: 'cafe.jpg', url: 'https://x/cafe.jpg', type: 'image/jpeg', date: '2026-08-11', category: 'CAFE', value: 12.5, reembolsavel: false },
      ],
      otherExpenses: [],
    };
    const M3: any = {
      id: 'MEA-101', demandId: 'DEM-101', status: 'NAO_INICIADA', updatedAt: '',
      expenses: { classHours: 16, participantes: [{ instructorId: 'INS-T', papel: 'TITULAR', valorHH: 100 }, { instructorId: 'INS-A', papel: 'ACOMPANHANTE', valorHH: 50 }] },
      attachments: [
        { id: 'c1', name: 'hotel-a.pdf', url: '', bucket: 'measurements', path: 'DEM-101/hotel-a.pdf', type: 'application/pdf', date: '2026-08-20', category: 'HOSPEDAGEM', value: 300, instructorId: 'INS-A' },
        { id: 'c2', name: 'perdido.pdf', url: '', type: 'application/pdf', date: '2026-08-20', category: 'JANTAR', value: 25, instructorId: 'INS-T' },
        { id: 'c3', name: 'sem-categoria.pdf', url: 'https://x/s.pdf', type: 'application/pdf', date: '2026-08-21', category: '', value: 7, instructorId: 'INS-T' },
      ],
      otherExpenses: [],
    };
    const M4: any = { id: 'MEA-102', demandId: 'DEM-102', status: 'LANCAMENTO', updatedAt: '2026-08-26', expenses: { classHours: 8 }, attachments: [{ id: 'd1', name: 'taxi.pdf', url: 'https://x/taxi.pdf', type: 'application/pdf', date: '2026-08-25', category: 'LOCOMOCAO', value: 60 }], otherExpenses: [] };
    const M5: any = { id: 'MEA-999', demandId: 'DEM-999', status: 'LANCAMENTO', updatedAt: '', expenses: {}, attachments: [{ id: 'z1', category: 'ALMOCO', value: 999 }], otherExpenses: [] };
    const measurements = [M1, M2, M3, M4, M5];
    const src = { demands, measurements, trainings: TRAININGS, instructors: INSTRUCTORS, companies: COMPANIES, instructorAllocations: alocs, participants: parts, companions: comps, now: HOJE };
    const rows = buildDespesasRows(src);
    const chave = (r: DespesaRow) => `${r.demand.id}:${r.item.id}:${r.instructorName}`;
    const de = (id: string) => rows.find(r => r.item.id === id)!;

    eq('uma linha por item; medição órfã fora; ordem data desc, demanda, pessoa, categoria', rows.map(chave), [
      'DEM-102:d1:(sem instrutor)',
      'DEM-101:c1:Acompanhante', 'DEM-101:c2:Titular', 'DEM-101:c3:Titular',
      'DEM-100:b1:Titular', 'DEM-100:b2:Titular',
      'DEM-900:a2:Segundo', 'DEM-900:a5:Segundo', 'DEM-900:a1:Titular', 'DEM-900:a3:Titular', 'DEM-900:a4:Titular',
    ]);
    // Dono: sem dono → titular; dono removido → titular; gravado → a pessoa; v1 → tudo no principal; sem pessoa → (sem instrutor).
    eq('dono e origem', ['a1', 'a2', 'a3', 'b1', 'd1'].map(id => `${de(id).instructorName}|${de(id).donoOrigem}|${de(id).papel}`), [
      'Titular|Titular (item sem dono)|TITULAR',
      'Segundo|Gravado no item|PARTICIPANTE',
      'Titular|Titular (dono fora da lista)|TITULAR',
      'Titular|Titular (item sem dono)|TITULAR',
      '(sem instrutor)|Titular (item sem dono)|TITULAR',
    ]);
    check('dividida (M2): o segundo titular tem bloco vazio, logo nenhuma linha', !rows.some(r => r.demand.id === 'DEM-100' && r.instructorId === 'INS-2'));
    eq('formato: M1/M3/M2 v2 (participantes ou 2+ pessoas), M4 v1 (sem ninguém)', ['a1', 'c1', 'b1', 'd1'].map(id => de(id).v2), [true, true, true, false]);
    // Categoria, descrição, valor, flags, anexo, órfão.
    eq('categoria rotulada e bucket do painel', ['a1', 'a2', 'a5', 'a3', 'c3'].map(id => `${de(id).categoriaLabel}/${de(id).bucket}`), ['Hospedagem/hospedagem', 'Almoço/alimentacao', 'Jantar/alimentacao', 'Outras despesas/outros', '(sem categoria)/outros']);
    eq('descrição: Outros = linha; demais = nome do item; órfão sem linha = vazia', ['a3', 'a4', 'a1', 'a5'].map(id => de(id).descricao), ['Pedágio', '', 'hotel.pdf', 'Valor Avulso']);
    eq('valor com vírgula parseado', de('a2').valor, 50);
    eq('flags lidas pelo domínio (ausente = não)', ['a1', 'a2', 'a5', 'b1'].map(id => `${de(id).naoReembolsa}/${de(id).pagoPeloInstrutor}`), ['false/true', 'true/false', 'true/true', 'false/false']);
    eq('anexo: url → arquivo; bucket+path → arquivo; avulso; perdido', ['a1', 'c1', 'a5', 'c2'].map(id => `${de(id).temAnexo}/${de(id).anexoTipo}`), ['true/Arquivo', 'true/Arquivo', 'false/Valor avulso', 'false/Arquivo não vinculado']);
    eq('órfão de Outros marcado; o Outros com linha não', [de('a4').orfao, de('a3').orfao], [true, false]);

    // Σ = painel: por pessoa e bucket (blockExpenseBreakdown) e por medição (computePanelExpenseBreakdown), com e sem itemFilter.
    const buckets: PanelExpenseBucket[] = ['hospedagem', 'locomocao', 'alimentacao', 'outros'];
    const soma = (rs: DespesaRow[], b?: PanelExpenseBucket) => Math.round(rs.filter(r => !r.orfao && (!b || r.bucket === b)).reduce((acc, r) => acc + r.valor, 0) * 100) / 100;
    for (const m of [M1, M2, M3, M4]) {
      const demand = demands.find(d => d.id === m.demandId)!;
      const pessoas = resolveMeasurementPeople(demand, alocs, parts, comps);
      const { paraNormalizar, blocos } = resolvePersonBlocks(m, demand, pessoas);
      const das = rows.filter(r => r.measurement.id === m.id);
      const painel = computePanelExpenseBreakdown(paraNormalizar);
      for (const b of buckets) perto(`${m.id}: Σ ${b} das linhas = computePanelExpenseBreakdown`, soma(das, b), painel[b]);
      perto(`${m.id}: Σ total = painel.total`, soma(das), painel.total);
      eq(`${m.id}: itens e órfãos contados como o painel`, [das.filter(r => !r.orfao).length, das.filter(r => r.orfao).length], [painel.itens, painel.itensOrfaos]);
      const nr = computePanelExpenseBreakdown(paraNormalizar, { itemFilter: isNaoReembolsavel });
      const pi = computePanelExpenseBreakdown(paraNormalizar, { itemFilter: isPagoPeloInstrutor });
      perto(`${m.id}: Σ não reembolsa = painel com itemFilter`, soma(das.filter(r => r.naoReembolsa)), nr.total);
      perto(`${m.id}: Σ pago pelo instrutor = painel com itemFilter`, soma(das.filter(r => r.pagoPeloInstrutor)), pi.total);
      for (const bloco of blocos) {
        const daPessoa = das.filter(r => r.instructorId === bloco.instructorId);
        const bb = blockExpenseBreakdown(paraNormalizar, bloco);
        const bpi = blockExpenseBreakdown(paraNormalizar, bloco, { itemFilter: isPagoPeloInstrutor });
        for (const b of buckets) {
          perto(`${m.id}/${bloco.instructorId || '(sem)'}: Σ ${b} da pessoa = blockExpenseBreakdown`, soma(daPessoa, b), bb[b]);
        }
        perto(`${m.id}/${bloco.instructorId || '(sem)'}: Σ pago pelo instrutor da pessoa = blockExpenseBreakdown com itemFilter`, soma(daPessoa.filter(r => r.pagoPeloInstrutor)), bpi.total);
      }
    }

    // Filtros: categoria, as duas flags (sim/não), instrutor = dono efetivo, período.
    const ctx = { trainingsById, now: HOJE };
    const F = DESPESAS_DATASET.filters;
    eq('filtro categoria = OUTROS', applyFilters(rows, { ...EMPTY_FILTERS, categoriaDespesa: 'OUTROS' }, F, ctx).map(r => r.item.id), ['a3', 'a4']);
    eq('filtro não reembolsa = sim', applyFilters(rows, { ...EMPTY_FILTERS, naoReembolsa: 'sim' }, F, ctx).map(r => r.item.id), ['b2', 'a2', 'a5']);
    eq('filtro pago pelo instrutor = não', applyFilters(rows, { ...EMPTY_FILTERS, pagoPeloInstrutor: 'nao' }, F, ctx).map(r => r.item.id), ['d1', 'c1', 'c2', 'c3', 'b1', 'b2', 'a2', 'a3', 'a4']);
    eq('filtro de instrutor pelo dono efetivo (a1 sem dono e a3 removido caem no titular)', applyFilters(rows, { ...EMPTY_FILTERS, instructorId: 'INS-T' }, F, ctx).map(r => r.item.id), ['c2', 'c3', 'b1', 'b2', 'a1', 'a3', 'a4']);
    eq('período por interseção (20-21/08 → DEM-101)', applyFilters(rows, { ...EMPTY_FILTERS, dataInicio: '2026-08-20', dataFim: '2026-08-21' }, F, ctx).map(r => r.demand.id), ['DEM-101', 'DEM-101', 'DEM-101']);
    const opts = buildFilterOptions(rows, TRAININGS, COMPANIES, INSTRUCTORS);
    eq('opções: seis categorias na ordem do painel e Sim/Não', [opts.categoriasDespesa.map(c => c.value), opts.simNao.map(s => s.value)], [['HOSPEDAGEM', 'LOCOMOCAO', 'CAFE', 'ALMOCO', 'JANTAR', 'OUTROS'], ['sim', 'nao']]);

    // Colunas e guarda de fonte: só paraNormalizar/blocos, nunca m.attachments direto.
    const fonte = t.semComentarios(t.ler('domain/exports/datasets/despesas.ts'));
    check('dataset Despesas não percorre m.attachments cru (só os blocos de resolvePersonBlocks)', !/m\.attachments|measurement\.attachments/.test(fonte) && fonte.includes('resolvePersonBlocks(') && fonte.includes('bloco.attachments'));
    check('dataset Despesas usa o predicado único de órfão e o bucket do domínio', fonte.includes('isOrfaoOutros(') && fonte.includes('panelBucketOf('));
    const chaves = defaultColumnKeys(DESPESAS_DATASET);
    check('defaults: demanda, empresa, pessoa, papel, categoria, descrição, valor, flags, anexo, órfão e status da medição ligados',
      ['demandId', 'empresa', 'pessoa', 'papel', 'categoria', 'descricao', 'valor', 'naoReembolsa', 'pagoPeloInstrutor', 'temAnexo', 'orfao', 'medicaoStatus'].every(k => chaves.includes(k)));
    check('defaults: bucket, arquivo, dono-origem e formato desligados', ['bucket', 'arquivo', 'donoOrigem', 'formato'].every(k => !chaves.includes(k)));
    const table = buildTable(DESPESAS_DATASET, rows, DESPESAS_DATASET.columns.map(c => c.key));
    const idx = (k: string) => table.columns.findIndex(c => c.key === k);
    const la2 = table.rows[rows.findIndex(r => r.item.id === 'a2')];
    eq('célula: pessoa, papel rotulado, categoria, valor, flags', [la2[idx('pessoa')], la2[idx('papel')], la2[idx('categoria')], la2[idx('valor')], la2[idx('naoReembolsa')], la2[idx('temAnexo')]], ['Segundo', 'Participante', 'Almoço', 50, true, true]);
    const arquivo = await gravarXlsx(DESPESAS_DATASET, rows, 'exportacao-despesas-fixtures.xlsx');
    check(`XLSX das fixtures gravado${arquivo ? ` em ${arquivo}` : ' (C:\\tmp ausente — pulado)'}`, arquivo === null || fs.statSync(arquivo).size > 5_000);
  }

  return falhas;
}
