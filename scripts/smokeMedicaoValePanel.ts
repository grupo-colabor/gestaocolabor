/**
 * SMOKE — Medição Vale: bloco [P] painel de pendências
 */
import { buildPendencias, logisticaIndicaViagem, PENDENCIAS_DATASET } from '../domain/exports/pendencias';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { applyFilters } from '../domain/exports/filters';
import { EMPTY_FILTERS } from '../domain/exports/types';
import { buildTrainingsById } from '../domain/modalityOptions';
import type { ValeSmokeTools } from './smokeMedicaoValeDatasets';
import { TRAININGS, HOJE } from './smokeMedicaoValeDatasets';

export function runPanelChecks(t: ValeSmokeTools, ctx: { src: any; rows: any[] }): number {
  let falhas = 0;
  const check: ValeSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: ValeSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };

  console.log('\n[P] Painel de pendências');

  const logisticAllocations = [
    { demand_id: 'DEM-100', transport_mode: 'CARRO_ALUGADO', lodging_mode: 'PRECISA_HOTEL' }, // tem despesa: ok
    { demand_id: 'DEM-101', transport_mode: 'NAO_NECESSARIO', lodging_mode: 'NAO_NECESSARIO' }, // sem viagem
    { demand_id: 'DEM-102', transport_mode: 'TAXI', lodging_mode: null },                       // viagem sem despesa
  ];
  const logisticBlocks = [
    { demand_id: 'DEM-108', block_type: 'HOSPEDAGEM', transport_mode: null, lodging_mode: 'PRECISA_HOTEL' }, // bloco indica hotel
  ];
  const rowsComRepetido = [
    ...ctx.rows,
    // outra demanda com o MESMO ID SAP de DEM-100 (repetido no recorte)
    { ...ctx.rows.find((r: any) => r.demand.id === 'DEM-100'), demand: { ...ctx.rows[0].demand, id: 'DEM-199' }, refs: { trainingId: 'T_PRE', demandId: 'DEM-199' } },
  ];
  const pend = buildPendencias(rowsComRepetido, {
    sheet: VALE_TEMPLATE.sheets[0],
    templateValues: ctx.src.templateValues,
    logisticAllocations,
    logisticBlocks,
  });
  const de = (id: string) => pend.find(p => p.demand.id === id);
  const textos = (id: string) => de(id)?.pendencias.map(p => `${p.tipo}:${p.texto}`) ?? [];

  check('viagem: carro alugado conta', logisticaIndicaViagem('DEM-100', logisticAllocations, []));
  check('viagem: NAO_NECESSARIO não conta', !logisticaIndicaViagem('DEM-101', logisticAllocations, []));
  check('viagem: bloco de hotel conta', logisticaIndicaViagem('DEM-108', [], logisticBlocks));
  check('viagem: sem logística nenhuma não conta', !logisticaIndicaViagem('DEM-999', logisticAllocations, logisticBlocks));

  eq('DEM-100 (pronta, com despesa e ID) só avisa o não reembolsável e o ID repetido',
    textos('DEM-100'), ['aviso:Item não reembolsável fora das colunas da Vale (R$ 30,00)', 'aviso:ID SAP repetido em outra demanda do recorte (SAP-100)']);
  eq('DEM-101: sem ID SAP + medição não pronta (avisos, linha sai)',
    textos('DEM-101'), ['aviso:Sem ID SAP / Pedido Cliente (célula B em branco)', 'aviso:Medição não pronta (Em lançamento de despesas)']);
  eq('DEM-102: sem HH (treinamento sem preço) + medição não iniciada + viagem sem despesa (inferência)',
    textos('DEM-102'), ['aviso:Sem preço unitário HH (célula H em branco)', 'aviso:Medição não iniciada', 'aviso:Logística indica viagem, mas não há despesa lançada (inferência)']);
  eq('DEM-103: futura = fato + sem medição aberta', textos('DEM-103'), ['fato:Demanda não concluída (Alocada)', 'aviso:Sem medição aberta']);
  eq('DEM-104: cancelada = fato', textos('DEM-104')[0], 'fato:Demanda cancelada');
  eq('DEM-105: sem titular = fato', textos('DEM-105')[0], 'fato:Sem instrutor titular');
  eq('DEM-107: interna com empresa Vale = aviso (fora da aba por decisão)', textos('DEM-107')[0], 'aviso:Demanda interna com empresa Vale — não entra na medição da Vale');
  check('DEM-108: sem medição aberta + hotel no bloco sem despesa', textos('DEM-108').includes('aviso:Sem medição aberta') && textos('DEM-108').some(x => /inferência/.test(x)));
  check('inferência nunca é fato', pend.every(p => p.pendencias.filter(x => /inferência/.test(x.texto)).every(x => x.tipo === 'aviso')));
  check('fatos primeiro na ordem', pend[0].fatos > 0 && pend[pend.length - 1].fatos === 0);
  eq('contagens', [de('DEM-103')!.fatos, de('DEM-103')!.avisos], [1, 1]);

  // Demanda sem nenhuma pendência não aparece.
  const limpa = buildPendencias([{ ...ctx.rows.find((r: any) => r.demand.id === 'DEM-100'), naoReembolsavelExcluido: 0 }], {
    sheet: VALE_TEMPLATE.sheets[0], templateValues: ctx.src.templateValues, logisticAllocations, logisticBlocks,
  });
  eq('sem pendência -> fora do painel', limpa.length, 0);

  // Filtro por corredor e export pelo motor da F1.
  const filtrado = applyFilters(pend, { ...EMPTY_FILTERS, corredor: 'Ferrovia/MG' }, ['corredor'], { trainingsById: buildTrainingsById(TRAININGS), now: HOJE, options: { usarValorHH: true, incluirCanceladas: true } });
  eq('painel filtra por corredor', filtrado.map(p => p.demand.id), ['DEM-108']);
  const tabela = buildTable(PENDENCIAS_DATASET, pend, defaultColumnKeys(PENDENCIAS_DATASET));
  eq('tabela do painel: 12 colunas', tabela.columns.length, 12);
  check('coluna Pendências junta os motivos com quebra de linha', String(tabela.rows.find(r => r[0] === 'DEM-102')![11]).includes('\n'));
  check('todas as colunas resolvem', pend.every(p => PENDENCIAS_DATASET.columns.every(c => { c.get(p); return true; })));

  return falhas;
}
