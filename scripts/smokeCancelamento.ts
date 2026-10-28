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

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
