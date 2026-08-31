/**
 * SMOKE — Data + hora de início/fim da demanda (round-trip)
 *
 * Rodar com:  npm run smoke:datas
 *
 * Cobre o bug do form de demanda INTERNA: o usuário registrava Início 08:00 /
 * Fim 14:00 e, ao reabrir, via 05:00 / 11:00 — deslocamento de -3h. Causa: o
 * `handleOpenView` do InternalDemands.tsx passava `start_date` por
 * `isoToLocalDTL` (new Date + getHours), reinterpretando como INSTANTE UTC a
 * string que o app grava como HORÁRIO DE PAREDE. Pior: o re-save persistia o
 * 05:00, então cada edição descia mais 3h e derrubava o adicional noturno.
 *
 * O form de CLIENTE (Demands.tsx) já tinha sido corrigido pela metade: pegava a
 * HORA por string (imune) mas a DATA por `new Date()` — o que ainda erra o dia
 * na borda de meia-noite. Agora os dois consomem o MESMO helper,
 * `domain/demandDateTime.ts`, que converte só por string.
 *
 * O ponto central é a REGRESSÃO: a implementação ANTIGA está reproduzida aqui
 * (`isoToLocalDTL_ANTIGO`, `toLocalDateInput_ANTIGO`) e o smoke exige que ela
 * FALHE nos casos abaixo — sem isso o teste ficaria verde sobre qualquer
 * implementação, inclusive a bugada.
 *
 * A seção "guardas de fonte" falha se algum dos dois forms voltar a definir a
 * conversão localmente ou deixar de importar o helper compartilhado.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */

// O bug só aparece num fuso com offset != 0. Fixa antes de qualquer uso de Date.
process.env.TZ = 'America/Sao_Paulo';

import fs from 'fs';
import path from 'path';
import {
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  toDemandDateInput,
  toDemandTimeInput,
  buildDemandDateTime,
  toDemandDateTimeInput,
} from '../domain/demandDateTime';
import {
  isNightDemand,
  isDayNight,
  getDayHorarioInicio,
  getDayHorarioFim,
  getDemandDays,
} from '../domain/demandDays';
import { formatDateTime } from '../components/demand-form/formatters';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(
    nome,
    Object.is(atual, esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`
  );

/* ────────────────────────────────────────────────────────────────────────────
 * [0] Pré-condição: o fuso precisa mesmo ser -03:00, senão o smoke não prova nada
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[0] Fuso do processo');
eq('offset local = 180 min (UTC-3)', new Date('2026-08-31T12:00:00Z').getTimezoneOffset(), 180);

/* ────────────────────────────────────────────────────────────────────────────
 * Simulação do banco
 *
 * `demands.start_date` é timestamptz. O app grava a string naive
 * "YYYY-MM-DDTHH:mm"; o Postgres (sessão em UTC) a resolve como UTC e o
 * PostgREST devolve "YYYY-MM-DDTHH:mm:00+00:00". Mesma parede, sufixo a mais.
 * ────────────────────────────────────────────────────────────────────────── */
const gravaELe = (valorDoForm: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valorDoForm)) {
    throw new Error(`form deveria mandar "YYYY-MM-DDTHH:mm", mandou ${JSON.stringify(valorDoForm)}`);
  }
  return `${valorDoForm}:00+00:00`;
};

/** O que os dois forms fazem: inputs date+time -> valor gravado. */
const salvaDoForm = (data: string, hora: string, fallback: string) =>
  buildDemandDateTime(data, hora, fallback);

/** O que os dois forms fazem ao reabrir: valor gravado -> inputs date+time. */
const abreNoForm = (gravado: string, fallback: string) => ({
  data: toDemandDateInput(gravado),
  hora: toDemandTimeInput(gravado),
  dtl: toDemandDateTimeInput(gravado, fallback),
});

/** Um ciclo completo: abre o form, salva sem tocar em nada, grava e relê. */
const cicloAbrirSalvar = (gravado: string, fallback: string) => {
  const r = abreNoForm(gravado, fallback);
  return gravaELe(salvaDoForm(r.data, r.hora, fallback));
};

/* ── Implementação ANTIGA, reproduzida para provar a regressão ────────────── */
const pad2 = (n: number) => String(n).padStart(2, '0');

/** InternalDemands.tsx (antes): usado em handleOpenView sobre start_date/end_date. */
const isoToLocalDTL_ANTIGO = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Demands.tsx (antes): data por new Date(), hora por string. */
const toLocalDateInput_ANTIGO = (v: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.includes('T') ? v.split('T')[0] : '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/* ────────────────────────────────────────────────────────────────────────────
 * [1] Round-trip do caso reportado — 08:00 / 14:00
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Round-trip 08:00 -> gravar -> ler -> 08:00 (os dois forms)');
{
  const inicioForm = salvaDoForm('2026-08-31', '08:00', DEFAULT_START_TIME);
  const fimForm = salvaDoForm('2026-08-31', '14:00', DEFAULT_END_TIME);

  eq('form monta início sem offset', inicioForm, '2026-08-31T08:00');
  eq('form monta fim sem offset', fimForm, '2026-08-31T14:00');

  const inicioDb = gravaELe(inicioForm);
  const fimDb = gravaELe(fimForm);

  const inicio = abreNoForm(inicioDb, DEFAULT_START_TIME);
  const fim = abreNoForm(fimDb, DEFAULT_END_TIME);

  eq('reabrir: data de início', inicio.data, '2026-08-31');
  eq('reabrir: hora de início', inicio.hora, '08:00');
  eq('reabrir: datetime de início', inicio.dtl, '2026-08-31T08:00');
  eq('reabrir: hora de fim', fim.hora, '14:00');
  eq('reabrir: datetime de fim', fim.dtl, '2026-08-31T14:00');

  // Visualização (DataViewField "Início"/"Fim") e listagem.
  eq('visualização do gravado', formatDateTime(inicioDb), '31/08/2026 08:00');
  eq('visualização do reaberto', formatDateTime(inicio.dtl), '31/08/2026 08:00');

  // Idempotência: salvar de novo sem tocar em nada não pode mexer no horário.
  eq('re-save não desloca', salvaDoForm(inicio.data, inicio.hora, DEFAULT_START_TIME), inicioForm);

  let v = inicioDb;
  for (let i = 0; i < 3; i++) v = cicloAbrirSalvar(v, DEFAULT_START_TIME);
  eq('3 ciclos abrir/salvar não deslocam', toDemandDateTimeInput(v), '2026-08-31T08:00');

  // REGRESSÃO: a implementação antiga precisa falhar aqui.
  eq('(antigo) isoToLocalDTL deslocava -3h', isoToLocalDTL_ANTIGO(inicioDb), '2026-08-31T05:00');
  check('(antigo) != atual no início', isoToLocalDTL_ANTIGO(inicioDb) !== inicio.dtl);
  eq('(antigo) fim 14:00 virava 11:00', isoToLocalDTL_ANTIGO(fimDb), '2026-08-31T11:00');
}

/* ────────────────────────────────────────────────────────────────────────────
 * [2] Borda de meia-noite — 23:00 até 02:00 do dia seguinte
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[2] Borda de meia-noite (23:00 -> 02:00 do dia seguinte)');
{
  const inicioDb = gravaELe(salvaDoForm('2026-08-31', '23:00', DEFAULT_START_TIME));
  const fimDb = gravaELe(salvaDoForm('2026-09-01', '02:00', DEFAULT_END_TIME));

  const inicio = abreNoForm(inicioDb, DEFAULT_START_TIME);
  const fim = abreNoForm(fimDb, DEFAULT_END_TIME);

  eq('início mantém o dia 31/08', inicio.data, '2026-08-31');
  eq('início mantém 23:00', inicio.hora, '23:00');
  eq('fim mantém o dia 01/09', fim.data, '2026-09-01');
  eq('fim mantém 02:00', fim.hora, '02:00');
  eq('fim: datetime completo', fim.dtl, '2026-09-01T02:00');

  // A demanda continua sendo de 2 dias, não de 1 nem de 3.
  const demanda = { dateMode: 'CONTINUO', startDate: inicioDb, endDate: fimDb };
  eq('dias da demanda', getDemandDays(demanda).join(','), '2026-08-31,2026-09-01');

  // REGRESSÃO: as duas implementações antigas erravam o dia aqui.
  eq('(antigo interno) fim caía para 31/08', isoToLocalDTL_ANTIGO(fimDb), '2026-08-31T23:00');
  eq('(antigo cliente) data do fim caía para 31/08', toLocalDateInput_ANTIGO(fimDb), '2026-08-31');
  check('(antigo cliente) != atual na data do fim', toLocalDateInput_ANTIGO(fimDb) !== fim.data);
}

/* ────────────────────────────────────────────────────────────────────────────
 * [3] Contraprova do adicional noturno — interna com fim 21:00
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[3] Badge noturno de interna sobrevive ao round-trip');
{
  const inicioDb = gravaELe(salvaDoForm('2026-08-31', '13:00', DEFAULT_START_TIME));
  const fimDb = gravaELe(salvaDoForm('2026-08-31', '21:00', DEFAULT_END_TIME));

  const gravada = { dateMode: 'CONTINUO', startDate: inicioDb, endDate: fimDb };
  check('interna 13:00-21:00 é noturna no banco', isNightDemand(gravada));
  eq('horário de fim lido pela medição', getDayHorarioFim(gravada, '2026-08-31'), '21:00');
  eq('horário de início lido pela medição', getDayHorarioInicio(gravada, '2026-08-31'), '13:00');

  // Reabre no form, salva de novo, grava e relê: o badge não pode sumir.
  const reGravada = {
    dateMode: 'CONTINUO',
    startDate: cicloAbrirSalvar(inicioDb, DEFAULT_START_TIME),
    endDate: cicloAbrirSalvar(fimDb, DEFAULT_END_TIME),
  };
  check('continua noturna após abrir+salvar', isNightDemand(reGravada));
  check('isDayNight idem', isDayNight(reGravada, '2026-08-31'));
  eq('fim continua 21:00 após abrir+salvar', getDayHorarioFim(reGravada, '2026-08-31'), '21:00');

  // REGRESSÃO: com o helper antigo o re-save gravava 18:00 e o adicional sumia.
  const reGravadaAntiga = {
    dateMode: 'CONTINUO',
    startDate: gravaELe(isoToLocalDTL_ANTIGO(inicioDb)),
    endDate: gravaELe(isoToLocalDTL_ANTIGO(fimDb)),
  };
  eq('(antigo) fim 21:00 virava 18:00', getDayHorarioFim(reGravadaAntiga, '2026-08-31'), '18:00');
  check('(antigo) demanda deixava de ser noturna', !isNightDemand(reGravadaAntiga));

  // Turno que vira o dia também é noturno — e continua sendo depois do round-trip.
  const viraODia = {
    dateMode: 'CONTINUO',
    startDate: cicloAbrirSalvar(gravaELe(salvaDoForm('2026-08-31', '22:00', DEFAULT_START_TIME)), DEFAULT_START_TIME),
    endDate: cicloAbrirSalvar(gravaELe(salvaDoForm('2026-09-01', '02:00', DEFAULT_END_TIME)), DEFAULT_END_TIME),
  };
  check('turno 22:00->02:00 é noturno após round-trip', isNightDemand(viraODia));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [4] Sanidade dos defaults e de entradas vazias
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[4] Defaults e entradas vazias');
{
  eq('sem data devolve vazio', buildDemandDateTime('', '10:00', DEFAULT_START_TIME), '');
  eq('sem hora usa fallback de início', buildDemandDateTime('2026-08-31', '', DEFAULT_START_TIME), '2026-08-31T08:00');
  eq('sem hora usa fallback de fim', buildDemandDateTime('2026-08-31', '', DEFAULT_END_TIME), '2026-08-31T18:00');
  eq('valor nulo -> data vazia', toDemandDateInput(null), '');
  eq('valor nulo -> hora vazia', toDemandTimeInput(undefined), '');
  eq('valor nulo -> dtl vazio', toDemandDateTimeInput(''), '');
  eq('só data (sem hora) ganha fallback', toDemandDateTimeInput('2026-08-31', DEFAULT_END_TIME), '2026-08-31T18:00');
  eq('ISO com Z também é parede', toDemandDateTimeInput('2026-08-31T08:00:00Z', DEFAULT_START_TIME), '2026-08-31T08:00');
  eq('ISO com milissegundos', toDemandTimeInput('2026-08-31T08:00:00.123+00:00'), '08:00');
}

/* ────────────────────────────────────────────────────────────────────────────
 * [5] Guardas de fonte — nenhuma cópia da conversão pode voltar aos forms
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[5] Guardas de fonte');
{
  const raiz = process.cwd();
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');

  const cliente = ler('components/Demands.tsx');
  const interna = ler('components/InternalDemands.tsx');

  for (const [nome, src] of [['Demands.tsx', cliente], ['InternalDemands.tsx', interna]] as const) {
    check(`${nome} importa de domain/demandDateTime`, src.includes("from '../domain/demandDateTime'"));
    check(`${nome} não redefine buildLocalDateTime`, !/const\s+buildLocalDateTime\s*=/.test(src));
    check(`${nome} não redefine toLocalDateInput`, !/const\s+toLocalDateInput\s*=/.test(src));
    check(`${nome} não redefine toLocalTimeInput`, !/const\s+toLocalTimeInput\s*=/.test(src));
    check(`${nome} não redefine isoToLocalDTL`, !/const\s+isoToLocalDTL\s*=/.test(src));
    check(`${nome} não redefine toIsoFromDateTimeLocalSafe`, !/const\s+toIsoFromDateTimeLocalSafe\s*=/.test(src));
    check(`${nome} não redefine toIsoFromDateInputSafe`, !/const\s+toIsoFromDateInputSafe\s*=/.test(src));
    check(`${nome} não usa Date.UTC/getTimezoneOffset`, !/Date\.UTC|getTimezoneOffset/.test(src));
  }

  // O ponto exato do bug: reabrir a interna tem que usar o helper de parede.
  check(
    'InternalDemands.handleOpenView usa toDemandDateTimeInput em startDate',
    /startDate:\s*toDemandDateTimeInput\(demand\.startDate/.test(interna)
  );
  check(
    'InternalDemands.handleOpenView usa toDemandDateTimeInput em endDate',
    /endDate:\s*toDemandDateTimeInput\(demand\.endDate/.test(interna)
  );
  check(
    'InternalDemands não passa isoToLocalDTL em start/endDate',
    !/(start|end)Date:\s*isoToLocalDTL\(/.test(interna)
  );

  // Os inputs dos dois forms leem pelo helper compartilhado.
  check(
    'inputs da interna usam toDemandDateInput/toDemandTimeInput',
    interna.includes('value={toDemandDateInput(formDemand.startDate)}') &&
      interna.includes('value={toDemandTimeInput(formDemand.endDate)}')
  );
  check(
    'form de cliente usa toDemandDateInput em getDateValue',
    /getDateValue[\s\S]{0,160}toDemandDateInput\(formDemand\[field\]/.test(cliente)
  );

  // O helper compartilhado não pode virar Date-based de novo.
  const helper = ler('domain/demandDateTime.ts');
  const secaoDemanda = helper.slice(0, helper.indexOf('LOGÍSTICA'));
  check(
    'helper de demanda não chama getHours() na trilha ISO',
    !/DATE_TIME_RE[\s\S]{0,200}getHours\(\)/.test(secaoDemanda)
  );
  check(
    'helper de demanda expõe as 4 funções',
    ['toDemandDateInput', 'toDemandTimeInput', 'buildDemandDateTime', 'toDemandDateTimeInput'].every(f =>
      new RegExp(`export const ${f}\\b`).test(helper)
    )
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log(
  falhas === 0 ? '\n✅ SMOKE DATAS DA DEMANDA: OK' : `\n❌ SMOKE DATAS DA DEMANDA: ${falhas} falha(s)`
);
process.exit(falhas === 0 ? 0 : 1);
