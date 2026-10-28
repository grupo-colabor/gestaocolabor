/**
 * SMOKE — Cancelamento de demanda em qualquer status, reativação e No-Show
 *
 * Rodar com:  npm run smoke:cancelamento
 *
 * Prende as regras de domain/demandCancellation.ts e o que depende delas:
 *
 *   [A] Motivos: lista única com os seis motivos; normalização do motivo —
 *       "No-Show", "no show", "noshow", "NO_SHOW", "Nó–Show" são No-Show;
 *       "Outro", vazio e nulo não são.
 *   [B] Regra por status: cancelar vale em NOVA, PENDENTE, ALOCADA,
 *       EM_ANDAMENTO e CONCLUIDA; não em CANCELADA.
 *   [C] Permissão (canCancelDemand): admin e analista em qualquer status;
 *       coordenador e sem perfil não; medição FATURADA nega analista e
 *       libera admin com confirmação extra; a confirmação extra compara o
 *       número da demanda sem caixa nem espaços.
 *   [D] Patches: cancelar toca SÓ os cinco campos (status + quatro) e guarda o
 *       status GRAVADO; reativar devolve o status gravado e limpa os quatro;
 *       cancelada antiga (sem status anterior) cai no fallback ALOCADA/NOVA;
 *       valor inválido também; cancelar o que já está cancelado mantém o
 *       status anterior original. Instrutor nunca muda.
 *   [E] Impacto: total = computeMeasurementTotals, itens contados sem o órfão,
 *       reembolso = itens "pago pelo instrutor", FATURADA detectada, frase
 *       "Nada será apagado…".
 *   [F] Visibilidade na Medição: cancelada vazia some; cancelada com conteúdo
 *       aparece; No-Show aparece mesmo vazia; ativa sempre. Aviso de reembolso:
 *       só com item pago pelo instrutor EM demanda cancelada.
 *   [G] Pendência da Medição Vale: "cancelada em dd/mm, após o término da
 *       turma" só quando cancelled_at > último dia; senão "Demanda cancelada".
 *   [H] Auditoria: a descrição traz motivo, observação e "Status anterior:
 *       Concluída (calculado) / ALOCADA (gravado)"; reativar traz "Volta para".
 *   [I] Guarda de fonte: o domínio não importa react, services, exceljs nem
 *       supabase.
 *   [J] Nada apagado ao cancelar/reativar: os handlers dos dois modais não
 *       chamam remoção de agenda, reset de medição nem delete/remove; gravam
 *       pelo patch do domínio, só fecham o modal se o banco aceitou e auditam
 *       com await. O cancelDemand antigo do App (apagava alocações) não existe.
 *   [K] Vermelho do No-Show: buildTable marca a linha pelo domínio; o XLSX das
 *       Exportações, lido de volta, tem fonte vermelha em TODAS as células da
 *       linha No-Show (sem fundo) e em nenhuma das outras; a composição com o
 *       estilo noturno do Excel de demandas mantém negrito e fundo; as abas de
 *       não reembolsáveis do Dashboard pintam a linha da demanda No-Show.
 *       Grava o Excel das fixtures (No-Show noturna, cancelada por outro
 *       motivo, normal) em C:\tmp para conferência.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import {
  CANCEL_REASONS,
  NO_SHOW_REASON,
  normalizeCancelReason,
  isNoShowReason,
  isNoShowCancellation,
  isCancelledDemand,
  cancelBadgeLabel,
  canCancelByStatus,
  demandJaComecou,
  canCancelDemand,
  canReactivateDemand,
  extraConfirmationMatches,
  buildCancelPatch,
  buildReactivatePatch,
  reactivationTargetStatus,
  summarizeCancellationImpact,
  FRASE_NADA_APAGADO,
  isMeasurementListed,
  measurementHasContent,
  reembolsoForaDoPagamento,
  cancelledAfterEnd,
  cancellationBlockText,
  describeCancellation,
  describeReactivation,
} from '../domain/demandCancellation';
import { computeMeasurementTotals } from '../domain/measurementTotals';
import { buildDemandasRows, DEMANDAS_DATASET } from '../domain/exports/datasets/demandas';
import { buildTable, defaultColumnKeys } from '../domain/exports/buildRows';
import { buildXlsxBuffer } from '../services/exports/xlsxWriter';
import { NO_SHOW_FONT_ARGB, paintNoShowRow } from '../services/exports/xlsxRowStyles';
import { listNonReimbursableByDemand, NR_BY_DEMAND_COLUMNS, NR_BY_ITEM_COLUMNS } from '../domain/nonReimbursableExpenses';
import { addNonReimbursableSheets, NR_SHEET_BY_DEMAND, NR_SHEET_BY_ITEM, NR_HEADER_ROW } from '../services/exports/dashboardXlsx';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
const perto = (nome: string, atual: number, esperado: number) =>
  check(nome, Math.abs(atual - esperado) < 1e-6, `esperado ${esperado}, veio ${atual}`);

/* ────────────────────────────── fixtures ────────────────────────────── */

const DEMANDA_ALOCADA: any = {
  id: 'DEM-1583', tipo: 'cliente', companyId: 'C1', trainingId: 'T1', regionId: 'R1',
  modality: 'PRESENCIAL', dateMode: 'CONTINUO', status: 'ALOCADA', instructorId: 'INS-1',
  startDate: '2026-10-27T08:00:00', endDate: '2026-10-28T17:00:00', trainingLocal: 'Mina X',
  corredor: 'Corredor Sul', demandState: 'MG', observations: 'turma fechada',
  logisticasLocomocao: [{ id: 'L1', transportType: 'Carro' }],
};

// Medição com: hospedagem 300; locomoção "45,90" paga pelo instrutor; almoço 35
// pago pelo instrutor; Outros 100 com linha; Outros 50 ÓRFÃO (linha apagada).
const MEDICAO: any = {
  id: 'MEA-1', demandId: 'DEM-1583', status: 'FATURADA',
  expenses: { classHours: 16, hourRate: 100 },
  attachments: [
    { id: 'a1', name: 'hotel.pdf', url: 'u', category: 'HOSPEDAGEM', value: 300 },
    { id: 'a2', name: 'uber.pdf', url: 'u', category: 'LOCOMOCAO', value: '45,90', pagoPeloInstrutor: true },
    { id: 'a3', name: 'almoco.jpg', url: 'u', category: 'ALMOCO', value: 35, pagoPeloInstrutor: true },
    { id: 'a4', name: 'pedagio.jpg', url: 'u', category: 'OUTROS', value: 100, otherId: 'o1' },
    { id: 'a5', name: 'orfao.jpg', url: 'u', category: 'OUTROS', value: 50, otherId: 'o9' },
  ],
  otherExpenses: [{ id: 'o1', description: 'Pedágio' }],
};
const MEDICAO_VAZIA: any = { id: 'MEA-2', demandId: 'DEM-2', status: 'NAO_INICIADA', attachments: [], otherExpenses: [] };

/* ────────────────────────────── [A] ────────────────────────────── */
console.log('[A] motivos e normalização');
eq('lista única com os seis motivos, na ordem do modal', [...CANCEL_REASONS],
  ['Baixo quórum', 'Falta de instrutor', 'Reagendamento', 'Solicitação do cliente', 'No-Show', 'Outro']);
check('No-Show está na lista', (CANCEL_REASONS as readonly string[]).includes(NO_SHOW_REASON));
for (const v of ['No-Show', 'no show', 'noshow', 'NO_SHOW', 'Nó–Show', '  No-Show  ', 'no.show', 'No—Show']) {
  eq(`normaliza ${JSON.stringify(v)} → "noshow"`, normalizeCancelReason(v), 'noshow');
  check(`${JSON.stringify(v)} é No-Show`, isNoShowReason(v));
}
for (const v of ['Outro', 'Baixo quórum', '', null, undefined, 'Show', 'No Shows']) {
  check(`${JSON.stringify(v)} NÃO é No-Show`, !isNoShowReason(v));
}
check('isNoShowCancellation: cancelada + No-Show', isNoShowCancellation({ status: 'CANCELADA', cancelReason: 'no show' }));
check('isNoShowCancellation: ativa com motivo No-Show NÃO conta', !isNoShowCancellation({ status: 'ALOCADA', cancelReason: 'No-Show' }));
check('isNoShowCancellation: cancelada por outro motivo NÃO conta', !isNoShowCancellation({ status: 'CANCELADA', cancelReason: 'Solicitação do cliente' }));
check('isNoShowCancellation aceita null', !isNoShowCancellation(null));
eq('selo da Medição', cancelBadgeLabel({ cancelReason: 'Solicitação do cliente' }), 'Cancelada · Solicitação do cliente');
eq('selo sem motivo', cancelBadgeLabel({ cancelReason: '' }), 'Cancelada · sem motivo');

/* ────────────────────────────── [B] ────────────────────────────── */
console.log('\n[B] regra por status');
for (const s of ['NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA']) {
  check(`pode cancelar em ${s}`, canCancelByStatus(s));
}
check('NÃO pode cancelar o que já está CANCELADA', !canCancelByStatus('CANCELADA'));
eq('já começou: EM_ANDAMENTO e CONCLUIDA', ['NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA'].map(demandJaComecou), [false, false, false, true, true]);

/* ────────────────────────────── [C] ────────────────────────────── */
console.log('\n[C] permissão');
for (const role of ['admin', 'analista']) {
  for (const s of ['NOVA', 'ALOCADA', 'EM_ANDAMENTO', 'CONCLUIDA']) {
    const d = canCancelDemand(role, s, 'CONFERENCIA');
    check(`${role} cancela em ${s} sem confirmação extra`, d.allowed && !d.extraConfirmation);
  }
}
check('coordenador não cancela', !canCancelDemand('coordenador', 'ALOCADA').allowed);
check('sem perfil não cancela', !canCancelDemand(undefined, 'ALOCADA').allowed);
check('ninguém cancela o que já está cancelado', !canCancelDemand('admin', 'CANCELADA').allowed);
const analistaFaturada = canCancelDemand('analista', 'CONCLUIDA', 'FATURADA');
check('FATURADA nega analista', !analistaFaturada.allowed);
check('FATURADA nega analista com motivo legível', analistaFaturada.allowed === false && /administrador/i.test(analistaFaturada.reason));
const adminFaturada = canCancelDemand('admin', 'CONCLUIDA', 'FATURADA');
check('FATURADA libera admin COM confirmação extra', adminFaturada.allowed && adminFaturada.extraConfirmation);
check('sem medição: analista cancela concluída', canCancelDemand('analista', 'CONCLUIDA', null).allowed);
check('confirmação extra: "dem-1583 " bate com DEM-1583', extraConfirmationMatches(' dem-1583 ', 'DEM-1583'));
check('confirmação extra: "DEM-1538" não bate', !extraConfirmationMatches('DEM-1538', 'DEM-1583'));
check('confirmação extra: vazio não bate', !extraConfirmationMatches('', 'DEM-1583'));
eq('reativar: admin e analista sim, coordenador não', ['admin', 'analista', 'coordenador', undefined].map(canReactivateDemand), [true, true, false, false]);

/* ────────────────────────────── [D] ────────────────────────────── */
console.log('\n[D] patches de cancelar e reativar');
const NOW = '2026-10-29T14:35:00.000Z';
const cancelada = buildCancelPatch(DEMANDA_ALOCADA, { reason: 'No-Show', note: '  ninguém apareceu  ', now: NOW });
eq('status vira CANCELADA', cancelada.status, 'CANCELADA');
eq('motivo gravado', cancelada.cancelReason, 'No-Show');
eq('observação gravada sem espaços', cancelada.cancelNote, 'ninguém apareceu');
eq('data do cancelamento = now do chamador', cancelada.cancelledAt, NOW);
eq('status anterior = status GRAVADO (ALOCADA), não o calculado', cancelada.statusBeforeCancel, 'ALOCADA');
eq('instrutor intacto', cancelada.instructorId, 'INS-1');
{
  const { status, cancelReason, cancelNote, cancelledAt, statusBeforeCancel, ...restoDepois } = cancelada;
  const { status: s0, cancelReason: r0, cancelNote: n0, cancelledAt: c0, statusBeforeCancel: b0, ...restoAntes } = DEMANDA_ALOCADA;
  void status; void cancelReason; void cancelNote; void cancelledAt; void statusBeforeCancel; void s0; void r0; void n0; void c0; void b0;
  eq('cancelar não toca em NENHUM outro campo (datas, logística, observações…)', restoDepois, restoAntes);
  check('objeto de entrada não é mutado', DEMANDA_ALOCADA.status === 'ALOCADA' && DEMANDA_ALOCADA.cancelReason === undefined);
}
eq('observação vazia vira undefined', buildCancelPatch(DEMANDA_ALOCADA, { reason: 'Outro', note: '   ', now: NOW }).cancelNote, undefined);
const recancelada = buildCancelPatch(cancelada, { reason: 'Outro', note: 'de novo', now: '2026-10-30T10:00:00.000Z' });
eq('cancelar o que já está cancelado mantém o status anterior original', recancelada.statusBeforeCancel, 'ALOCADA');

const reativada = buildReactivatePatch(cancelada);
eq('reativar devolve o status gravado', reativada.status, 'ALOCADA');
eq('reativar limpa os quatro campos', [reativada.cancelReason, reativada.cancelNote, reativada.cancelledAt, reativada.statusBeforeCancel], [undefined, undefined, undefined, undefined]);
eq('reativar mantém o instrutor', reativada.instructorId, 'INS-1');
{
  const { cancelReason, cancelNote, cancelledAt, statusBeforeCancel, ...restoReativada } = reativada;
  void cancelReason; void cancelNote; void cancelledAt; void statusBeforeCancel;
  eq('cancelar + reativar = a demanda original', restoReativada, DEMANDA_ALOCADA);
}
eq('cancelada antiga COM instrutor e sem status anterior → ALOCADA',
  reactivationTargetStatus({ status: 'CANCELADA', instructorId: 'INS-1', statusBeforeCancel: null }), 'ALOCADA');
eq('cancelada antiga SEM instrutor e sem status anterior → NOVA',
  reactivationTargetStatus({ status: 'CANCELADA', instructorId: undefined }), 'NOVA');
eq('status anterior inválido ("CANCELADA") → fallback',
  reactivationTargetStatus({ status: 'CANCELADA', instructorId: 'INS-1', statusBeforeCancel: 'CANCELADA' }), 'ALOCADA');
eq('status anterior NOVA é respeitado mesmo com instrutor',
  reactivationTargetStatus({ status: 'CANCELADA', instructorId: 'INS-1', statusBeforeCancel: 'NOVA' }), 'NOVA');
check('demanda sem status anterior gravado: reativar não inventa campo', (buildReactivatePatch({ status: 'CANCELADA' }) as any).statusBeforeCancel === undefined);

/* ────────────────────────────── [E] ────────────────────────────── */
console.log('\n[E] resumo de impacto');
const impacto = summarizeCancellationImpact({
  statusCalculado: 'CONCLUIDA',
  measurement: MEDICAO,
  pessoas: { titulares: 1, acompanhantes: 1, participantes: 0 },
});
check('já começou', impacto.jaComecou);
eq('rótulo do status calculado', impacto.statusCalculadoLabel, 'Concluída');
check('tem medição', impacto.temMedicao);
eq('etapa da medição', impacto.medicaoStatusLabel, 'Faturada');
check('FATURADA detectada', impacto.medicaoFaturada);
perto('total de despesas = 300 + 45,90 + 35 + 100 (órfão fora)', impacto.totalDespesas, 480.9);
perto('total = computeMeasurementTotals', impacto.totalDespesas, computeMeasurementTotals(MEDICAO).total);
eq('itens contados sem o órfão', impacto.qtdItens, 4);
perto('reembolso ao instrutor = itens pagos por ele', impacto.reembolsoInstrutor, 80.9);
eq('pessoas repassadas', impacto.pessoas, { titulares: 1, acompanhantes: 1, participantes: 0 });
check('frase "Nada será apagado"', impacto.frase === FRASE_NADA_APAGADO && /Nada será apagado/.test(impacto.frase));
const semMedicao = summarizeCancellationImpact({ statusCalculado: 'ALOCADA', measurement: null, pessoas: { titulares: 1, acompanhantes: 0, participantes: 0 } });
eq('sem medição: zeros e "Sem medição"', [semMedicao.temMedicao, semMedicao.totalDespesas, semMedicao.qtdItens, semMedicao.reembolsoInstrutor, semMedicao.medicaoStatusLabel, semMedicao.jaComecou],
  [false, 0, 0, 0, 'Sem medição', false]);

/* ────────────────────────────── [F] ────────────────────────────── */
console.log('\n[F] visibilidade na Medição e aviso de reembolso');
const ativa = { status: 'ALOCADA' };
const canceladaOutro = { status: 'CANCELADA', cancelReason: 'Solicitação do cliente' };
const canceladaNoShow = { status: 'CANCELADA', cancelReason: 'No-Show' };
check('medição vazia: sem conteúdo', !measurementHasContent(MEDICAO_VAZIA));
check('medição com itens: tem conteúdo', measurementHasContent(MEDICAO));
check('medição só com etapa avançada: tem conteúdo', measurementHasContent({ status: 'LANCAMENTO', attachments: [], otherExpenses: [] }));
check('ativa + vazia: listada', isMeasurementListed(ativa, MEDICAO_VAZIA));
check('cancelada por outro motivo + vazia: SOME', !isMeasurementListed(canceladaOutro, MEDICAO_VAZIA));
check('cancelada por outro motivo + com conteúdo: listada', isMeasurementListed(canceladaOutro, MEDICAO));
check('No-Show + vazia: listada (como sempre foi)', isMeasurementListed(canceladaNoShow, MEDICAO_VAZIA));
check('demanda inexistente: não listada', !isMeasurementListed(null, MEDICAO));
perto('aviso: cancelada com item pago pelo instrutor → valor do reembolso', reembolsoForaDoPagamento(canceladaOutro, MEDICAO), 80.9);
perto('aviso: demanda ATIVA → 0 (sem aviso)', reembolsoForaDoPagamento(ativa, MEDICAO), 0);
perto('aviso: cancelada SEM item pago pelo instrutor → 0 (sem aviso)', reembolsoForaDoPagamento(canceladaOutro, MEDICAO_VAZIA), 0);
perto('aviso: cancelada com itens mas nenhum pago pelo instrutor → 0',
  reembolsoForaDoPagamento(canceladaOutro, { attachments: [{ category: 'HOSPEDAGEM', value: 300 }], otherExpenses: [] } as any), 0);

/* ────────────────────────────── [G] ────────────────────────────── */
console.log('\n[G] pendência da Medição Vale');
check('cancelada depois do último dia', cancelledAfterEnd('2026-10-29T14:35:00.000Z', '2026-10-28'));
check('cancelada no próprio último dia: não é "após"', !cancelledAfterEnd('2026-10-28T10:00:00', '2026-10-28'));
check('cancelada antes: não é "após"', !cancelledAfterEnd('2026-10-20T10:00:00', '2026-10-28'));
check('sem data de cancelamento (antiga): não é "após"', !cancelledAfterEnd(undefined, '2026-10-28'));
check('data inválida: não é "após"', !cancelledAfterEnd('abc', '2026-10-28'));
eq('texto após o término', cancellationBlockText('2026-10-29T14:35:00', '2026-10-28'), 'Demanda cancelada em 29/10, após o término da turma');
eq('texto antes do término', cancellationBlockText('2026-10-20T10:00:00', '2026-10-28'), 'Demanda cancelada');
eq('texto sem data (cancelada antiga)', cancellationBlockText(null, '2026-10-28'), 'Demanda cancelada');

/* ────────────────────────────── [H] ────────────────────────────── */
console.log('\n[H] auditoria');
const descr = describeCancellation({
  demandId: 'DEM-1583', empresa: 'Vale', treinamento: 'NR 35', reason: 'No-Show', note: 'ninguém apareceu',
  statusCalculado: 'CONCLUIDA', statusGravado: 'ALOCADA', medicaoStatus: 'FATURADA',
});
eq('descrição do cancelamento', descr,
  'Demanda DEM-1583 cancelada | Empresa: Vale | Treinamento: NR 35 | Motivo: No-Show | Obs: ninguém apareceu | Status anterior: Concluída (calculado) / ALOCADA (gravado) | Medição: Faturada');
eq('descrição da interna', describeCancellation({ demandId: 'DEM-9', interna: true, categoria: 'SIPAT', descricao: 'Palestra', reason: 'Outro', statusCalculado: 'NOVA', statusGravado: 'NOVA' }),
  'Demanda interna DEM-9 cancelada | Categoria: SIPAT | Descrição: Palestra | Motivo: Outro | Status anterior: Nova (calculado) / NOVA (gravado)');
const descrReativar = describeReactivation({ demandId: 'DEM-1583', voltaPara: 'ALOCADA', cancelledAt: NOW, reason: 'No-Show' });
check('descrição da reativação diz para onde volta', /Volta para: Alocada/.test(descrReativar));
check('descrição da reativação diz quando foi cancelada', /Cancelada em: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(descrReativar));
check('descrição da reativação diz "Nada apagado"', /Nada apagado/.test(descrReativar));

/* ────────────────────────────── [I] ────────────────────────────── */
console.log('\n[I] guarda de fonte');
// O bundle roda de node_modules/.cache: a raiz do projeto é o cwd, não __dirname.
const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
{
  const src = semComentarios(ler('domain/demandCancellation.ts'));
  check('domain/demandCancellation.ts não importa react/services/exceljs/supabase', !/from\s+['"](react|exceljs|@supabase)|\/services\//.test(src));
  const med = semComentarios(ler('components/Measurement.tsx'));
  check('Measurement.tsx não compara o motivo por string solta', !/cancelReason\s*[!=]==\s*['"]No-Show['"]/.test(med));
}

/* ────────────────────────────── [J] ────────────────────────────── */
console.log('\n[J] nada apagado ao cancelar/reativar: guarda de fonte dos handlers');
{
  const bodyOf = (src: string, nome: string): string => {
    const i = src.indexOf(`const ${nome} = async () => {`);
    check(`${nome} existe e é async`, i >= 0);
    if (i < 0) return '';
    // Corpo: até o primeiro "\n  };" (os handlers fecham com dois espaços de indentação).
    const j = src.indexOf('\n  };', i);
    return src.slice(i, j < 0 ? undefined : j);
  };
  const PROIBIDO = [
    /removeAgendaItem\s*\(/, /updateMeasurement\s*\(/, /\bdelete[A-Z]\w*\s*\(/, /\bremove[A-Z]\w*\s*\(/,
    /attachments\s*:\s*\[\]/, /otherExpenses\s*:\s*\[\]/, /instructorId\s*:\s*undefined/, /NAO_INICIADA/,
  ];
  for (const rel of ['components/Demands.tsx', 'components/InternalDemands.tsx']) {
    const src = ler(rel).replace(/\r\n/g, '\n');
    for (const nome of ['handleCancelDemand', 'handleReactivateDemand']) {
      const body = bodyOf(src, nome);
      check(`${rel}: ${nome} não apaga nem reseta nada`, body.length > 0 && !PROIBIDO.some(re => re.test(body)));
      check(`${rel}: ${nome} grava pelo patch do domínio`, (nome === 'handleCancelDemand' ? /buildCancelPatch\(/ : /buildReactivatePatch\(/).test(body));
      check(`${rel}: ${nome} só fecha o modal se o banco aceitou`, /if \(!gravou\.ok\) return;/.test(body));
      check(`${rel}: ${nome} audita com await`, /await logAction\(/.test(body));
    }
  }
  const app = ler('App.tsx');
  check('App.tsx não tem mais o cancelDemand que apagava alocações', !/const cancelDemand = useCallback/.test(app) && !/deleteInstructorAllocationsByDemandId/.test(app));
}

/* ────────────────────────────── [K] ────────────────────────────── */
async function vermelhoNoShow() {
  console.log('\n[K] vermelho do No-Show: marca por linha + fonte lida de volta do XLSX');
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

  // Três demandas: No-Show NOTURNA (fim 23:00), cancelada por outro motivo, normal.
  const base = (o: any): any => ({
    tipo: 'cliente', companyId: 'C1', trainingId: 'T1', regionId: 'R1', modality: 'PRESENCIAL', dateMode: 'CONTINUO',
    trainingLocal: 'Mina X', demandState: 'MG', corredor: 'Corredor Sul', ...o,
  });
  const NOSHOW = base({ id: 'DEM-9001', status: 'CANCELADA', cancelReason: 'no show', instructorId: 'INS-1', startDate: '2026-10-20T19:00:00', endDate: '2026-10-20T23:00:00', cancelledAt: '2026-10-21T09:00:00', statusBeforeCancel: 'ALOCADA' });
  const OUTRO = base({ id: 'DEM-9002', status: 'CANCELADA', cancelReason: 'Solicitação do cliente', instructorId: 'INS-1', startDate: '2026-10-21T08:00:00', endDate: '2026-10-22T17:00:00', cancelledAt: '2026-10-15T09:00:00', statusBeforeCancel: 'ALOCADA' });
  const NORMAL = base({ id: 'DEM-9003', status: 'ALOCADA', instructorId: 'INS-1', startDate: '2026-10-23T08:00:00', endDate: '2026-10-24T17:00:00' });
  const rows = buildDemandasRows({
    demands: [NOSHOW, OUTRO, NORMAL],
    measurements: [],
    trainings: [{ id: 'T1', name: 'NR 35 — Trabalho em Altura', hours: 8, modality: 'PRESENCIAL' } as any],
    instructors: [{ id: 'INS-1', name: 'Instrutor Um' }],
    companies: [{ id: 'C1', name: 'Vale' }],
    instructorAllocations: [], participants: [], companions: [], logisticBlocks: [], documentFlags: [],
    now: new Date('2026-10-28T12:00:00'),
  });
  // O dataset ordena por número desc: localiza as linhas pelo id, não por índice fixo.
  eq('dataset Demandas: três linhas', [...rows.map(r => r.demand.id)].sort(), ['DEM-9001', 'DEM-9002', 'DEM-9003']);
  const idx = (id: string) => rows.findIndex(r => r.demand.id === id);
  const xl = (id: string) => idx(id) + 2; // linha no XLSX (1 = cabeçalho)
  check('No-Show é noturna no dataset (fim 23:00)', rows[idx('DEM-9001')].noturno === true);
  // "Motivo do cancelamento" não nasce ligada; entra aqui para o Excel de fixtures mostrá-la.
  const table = buildTable(DEMANDAS_DATASET, rows, [...defaultColumnKeys(DEMANDAS_DATASET), 'motivoCancelamento']);
  eq('buildTable marca só a No-Show', rows.map((r, i) => [r.demand.id, table.marks?.[i] ?? null]).sort(), [['DEM-9001', 'no-show'], ['DEM-9002', null], ['DEM-9003', null]]);
  check('a marca vem do domínio: "no show" minúsculo conta como No-Show', isNoShowCancellation(NOSHOW));

  const buffer = await buildXlsxBuffer(table, { sheetName: 'Demandas' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Demandas')!;
  const corDaLinha = (n: number) => table.columns.map((_, i) => ws.getRow(n).getCell(i + 1).font?.color?.argb ?? null);
  const temFundo = (n: number) => table.columns.some((_, i) => { const f = ws.getRow(n).getCell(i + 1).fill as any; return !!f && f.type === 'pattern' && !!f.fgColor; });
  check('linha da No-Show: TODAS as células com fonte vermelha', corDaLinha(xl('DEM-9001')).every(c => c === NO_SHOW_FONT_ARGB));
  check('linha da No-Show: sem fundo — só a cor da fonte', !temFundo(xl('DEM-9001')));
  check('linha da cancelada por outro motivo: sem vermelho', corDaLinha(xl('DEM-9002')).every(c => c === null));
  check('linha da normal: sem vermelho', corDaLinha(xl('DEM-9003')).every(c => c === null));
  eq('cabeçalho continua branco em fundo escuro', ws.getRow(1).getCell(1).font?.color?.argb, 'FFFFFFFF');
  {
    const c = table.columns.findIndex(x => x.key === 'motivoCancelamento') + 1;
    check('coluna "Motivo do cancelamento" presente na tabela', c > 0);
    const motivo = (id: string) => String(ws.getRow(xl(id)).getCell(c).value ?? '').trim();
    eq('coluna "Motivo do cancelamento" preenchida só nas canceladas',
      [motivo('DEM-9001'), motivo('DEM-9002'), motivo('DEM-9003')], ['no show', 'Solicitação do cliente', '']);
  }

  // Composição com o estilo noturno do Excel de demandas (ExportDemandsModal):
  // negrito + fundo laranja ficam; só a cor da fonte muda.
  const ws2 = wb.addWorksheet('Noturna + No-Show');
  ws2.addRow(['Demanda', 'Treinamento', 'Status']);
  const row = ws2.addRow(['DEM-9001', 'NR 35 — Trabalho em Altura', 'CANCELADA']);
  row.eachCell({ includeEmpty: true }, (cell: any) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } }; });
  paintNoShowRow(row, 3);
  check('noturna + No-Show: negrito mantido', [1, 2, 3].every(i => row.getCell(i).font?.bold === true));
  check('noturna + No-Show: fundo laranja mantido', [1, 2, 3].every(i => (row.getCell(i).fill as any)?.fgColor?.argb === 'FFFFE0B2'));
  check('noturna + No-Show: fonte vermelha', [1, 2, 3].every(i => row.getCell(i).font?.color?.argb === NO_SHOW_FONT_ARGB));

  // Abas do Dashboard (não reembolsáveis): item de demanda No-Show sai vermelho; o resto não.
  const medNoShow: any = { id: 'MEA-9001', demandId: 'DEM-9001', status: 'LANCAMENTO', attachments: [{ id: 'n1', name: 'uber.pdf', url: 'u', category: 'LOCOMOCAO', value: 30, reembolsavel: false }], otherExpenses: [] };
  const medNormal: any = { id: 'MEA-9003', demandId: 'DEM-9003', status: 'LANCAMENTO', attachments: [{ id: 'n2', name: 'almoco.jpg', url: 'u', category: 'ALMOCO', value: 20, reembolsavel: false }], otherExpenses: [] };
  const lista = listNonReimbursableByDemand({
    demands: [NOSHOW, NORMAL], measurements: [medNoShow, medNormal],
    instructorAllocations: [], participants: [], companions: [],
    instructors: [{ id: 'INS-1', name: 'Instrutor Um' }], companies: [{ id: 'C1', name: 'Vale' }], trainings: [{ id: 'T1', name: 'NR 35' }],
  });
  eq('não reembolsáveis: noShow por demanda vem da demanda', lista.demandas.map(d => [d.demandId, d.noShow]), [['DEM-9001', true], ['DEM-9003', false]]);
  addNonReimbursableSheets(wb, lista, { filtros: 'P1: Todo o período · Sem outros filtros', exportadoEm: '28/10/2026' });

  const bufferFinal = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(bufferFinal);
  for (const [nome, cols] of [[NR_SHEET_BY_DEMAND, NR_BY_DEMAND_COLUMNS], [NR_SHEET_BY_ITEM, NR_BY_ITEM_COLUMNS]] as const) {
    const w = wb2.getWorksheet(nome)!;
    const linhaDe = (id: string) => { let n = 0; w.eachRow((r: any, i: number) => { if (i > NR_HEADER_ROW && String(r.getCell(1).value) === id) n = i; }); return n; };
    const cor = (n: number) => cols.map((_, i) => w.getRow(n).getCell(i + 1).font?.color?.argb ?? null);
    check(`${nome}: linha da No-Show com fonte vermelha`, linhaDe('DEM-9001') > 0 && cor(linhaDe('DEM-9001')).every(c => c === NO_SHOW_FONT_ARGB));
    check(`${nome}: linha normal sem vermelho`, linhaDe('DEM-9003') > 0 && cor(linhaDe('DEM-9003')).every(c => c === null));
  }

  // Excel de fixtures para conferência: aba Demandas (No-Show noturna em vermelho,
  // cancelada por outro motivo, normal), a composição noturna + No-Show e as duas
  // abas de não reembolsáveis.
  const TMP = 'C:\\tmp';
  try { fs.mkdirSync(TMP, { recursive: true }); } catch { /* sem permissão: pula a gravação */ }
  if (fs.existsSync(TMP)) {
    const arquivo = path.join(TMP, 'demandas_fixtures-cancelamento-noshow.xlsx');
    fs.writeFileSync(arquivo, Buffer.from(bufferFinal));
    check(`XLSX das fixtures gravado em ${arquivo}`, fs.statSync(arquivo).size > 5_000);
  } else {
    check('XLSX das fixtures (C:\\tmp ausente — pulado)', true);
  }

  // Guarda de fonte dos escritores novos.
  const semComentarios2 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('services/exports/xlsxRowStyles.ts não importa react nem supabase', !/from\s+['"](react|@supabase)/.test(semComentarios2(ler('services/exports/xlsxRowStyles.ts'))));
  check('domain/exports/buildRows.ts marca a linha pelo domínio (isNoShowCancellation), sem string solta', /isNoShowCancellation\(/.test(ler('domain/exports/buildRows.ts')) && !/No-Show/.test(semComentarios2(ler('domain/exports/buildRows.ts'))));
}

vermelhoNoShow()
  .then(() => {
    console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  })
  .catch(e => { console.error(e); process.exit(1); });
