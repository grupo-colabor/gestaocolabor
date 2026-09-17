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
 */
import fs from 'fs';
import path from 'path';

import { buildLogisticsChecklist } from '../domain/demandLogisticsStatus';
import { isInternalDemand } from '../domain/demandLabel';
import { buildLogisticaRows, LOGISTICA_DATASET, type LogisticaRow } from '../domain/exports/datasets/logistica';
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

  return falhas;
}
