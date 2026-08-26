/**
 * SMOKE — Prontidão logística (Controle Logístico + Notificações)
 *
 * Rodar com:  npm run smoke:logistica
 *
 * Cobre o bug do checklist semanal: demanda INTERNA com logística resolvida
 * ficava eternamente PENDENTE porque as colunas MATERIAL e LISTA (Documento de
 * Apoio) eram exigidas como em treinamento de cliente.
 *
 * O ponto central é a REGRESSÃO: a regra nova (domain/demandLogisticsStatus.ts)
 * precisa devolver, para demanda de CLIENTE, exatamente o mesmo booleano da
 * implementação ORIGINAL do LogisticsControl — que está reproduzida aqui em
 * `regraOriginalCliente` e é comparada caso a caso sobre as 32 combinações
 * possíveis das 5 colunas.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import { buildLogisticsChecklist, type LogisticsChecklistInput } from '../domain/demandLogisticsStatus';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Logística resolvida: carro alugado + hotel, como o form interno grava. */
const logisticaOk = {
  hasAlloc: true as const,
  hasCar: true,
  transportMode: 'CARRO_ALUGADO',
  hasHotel: true,
  lodgingMode: 'PRECISA_HOTEL',
};

const interna = (over: Partial<LogisticsChecklistInput> = {}) =>
  buildLogisticsChecklist({ isInternal: true, ...logisticaOk, ...over });

const cliente = (over: Partial<LogisticsChecklistInput> = {}) =>
  buildLogisticsChecklist({ isInternal: false, ...logisticaOk, ...over });

console.log('\n— DEM-1509: interna com logística resolvida e liberação anexada');
{
  const c = interna({ hasReleasePdf: true });
  check('fica PRONTO (era PENDENTE: o bug)', c.ready === true);
  check('material aparece neutro, não como pendência', c.material === 'NAO_APLICA');
  check('documento de apoio (lista) aparece neutro', c.list === 'NAO_APLICA');
  check('hotel OK', c.hotel === 'OK');
  check('carro OK', c.car === 'OK');
  check('liberação OK', c.release === 'OK');
}

console.log('\n— Interna: o que AINDA bloqueia');
{
  const semLiberacao = interna({ hasReleasePdf: false });
  check('sem liberação continua pendente', semLiberacao.ready === false);
  check('e a pendência é a liberação', semLiberacao.release === 'PENDENTE');

  const semCarro = interna({ hasReleasePdf: true, hasCar: false, transportMode: null });
  check('sem carro resolvido continua pendente', semCarro.ready === false);

  const semHotel = interna({ hasReleasePdf: true, hasHotel: false, lodgingMode: null });
  check('sem hospedagem resolvida continua pendente', semHotel.ready === false);

  const semMaterial = interna({ hasReleasePdf: true, hasMaterial: false });
  check('material NÃO marcado não bloqueia (não se aplica)', semMaterial.ready === true);

  const semLista = interna({ hasReleasePdf: true, hasClassListPdf: false });
  check('documento de apoio ausente não bloqueia (opcional)', semLista.ready === true);
}

console.log('\n— Cliente: regressão contra a regra ORIGINAL, 32 combinações');
{
  // Cópia literal do cálculo que existia em LogisticsControl.tsx antes do fix.
  const regraOriginalCliente = (i: {
    car: boolean; hotel: boolean; material: boolean; release: boolean; list: boolean;
  }) => i.car && i.hotel && i.material && i.release && i.list;

  let divergencias = 0;
  let combinacoes = 0;
  for (let mask = 0; mask < 32; mask++) {
    const car = !!(mask & 1), hotel = !!(mask & 2), material = !!(mask & 4);
    const release = !!(mask & 8), list = !!(mask & 16);
    combinacoes++;

    const novo = cliente({
      hasCar: car, transportMode: car ? 'CARRO_ALUGADO' : null,
      hasHotel: hotel, lodgingMode: hotel ? 'PRECISA_HOTEL' : null,
      hasMaterial: material, hasReleasePdf: release, hasClassListPdf: list,
    }).ready;

    const original = regraOriginalCliente({ car, hotel, material, release, list });
    if (novo !== original) divergencias++;
  }
  check(`as ${combinacoes} combinações batem com a regra original`, divergencias === 0,
    `${divergencias} divergência(s)`);

  const clienteCompleto = cliente({ hasMaterial: true, hasReleasePdf: true, hasClassListPdf: true });
  check('cliente completo fica PRONTO', clienteCompleto.ready === true);
  check('cliente NUNCA tem coluna neutra (material)', clienteCompleto.material !== 'NAO_APLICA');
  check('cliente NUNCA tem coluna neutra (lista)', clienteCompleto.list !== 'NAO_APLICA');

  const clienteSemLista = cliente({ hasMaterial: true, hasReleasePdf: true, hasClassListPdf: false });
  check('cliente sem lista de turma continua pendente', clienteSemLista.ready === false);
  const clienteSemMaterial = cliente({ hasMaterial: false, hasReleasePdf: true, hasClassListPdf: true });
  check('cliente sem material continua pendente', clienteSemMaterial.ready === false);
}

console.log('\n— Sem linha de logística: fallback nos campos antigos');
{
  const legacyOk = buildLogisticsChecklist({
    isInternal: false, hasAlloc: false,
    legacy: { logisticsHotel: 'CONFIRMADO', logisticsTransport: 'NAO_NECESSARIO', materialReady: true },
    hasReleasePdf: true, hasClassListPdf: true,
  });
  check('campos legados resolvidos → PRONTO', legacyOk.ready === true);

  const legacyPend = buildLogisticsChecklist({
    isInternal: false, hasAlloc: false,
    legacy: { logisticsHotel: null, logisticsTransport: null, materialReady: false },
    hasReleasePdf: true, hasClassListPdf: true,
  });
  check('campos legados vazios → pendente', legacyPend.ready === false);
}

console.log('');
if (falhas > 0) {
  console.log(`❌ ${falhas} check(s) falharam.`);
  process.exit(1);
}
console.log('✅ Todos os checks passaram.');
