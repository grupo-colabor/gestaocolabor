/**
 * SMOKE — Bloco "Acompanhantes" da Visualização da Demanda
 *
 * Rodar com:  npm run smoke:acompanhantes
 *
 * O caso real: acompanhante só era alocado pela Orquestração Logística, que só
 * lista demanda SEM instrutor. Depois de alocada, a operação removia o titular,
 * punha o acompanhante e realocava. O bloco novo da visualização adiciona com a
 * demanda já alocada — e a promessa dele é não ser um segundo jeito de gravar.
 *
 * O que este arquivo existe para prender:
 *
 *   [A] A LINHA É A MESMA. O que o bloco grava em `companion_allocations` é
 *       indistinguível do que a Orquestração grava: a montagem que a Logística
 *       fazia inline está CONGELADA aqui como gabarito, e a função de domínio
 *       que as duas telas chamam hoje tem de reproduzi-la campo a campo. É isso
 *       que dispensa código novo na agenda e na medição.
 *
 *   [B] UMA LINHA POR DIA NA TABELA, UMA PESSOA NA TELA. "2 de 5 dias" ou
 *       "período todo"; a lixeira apaga TODAS as linhas da pessoa e nenhuma de
 *       outra; linha num dia que a demanda deixou aparece com aviso.
 *
 *   [C] O BLOCO SÓ EXISTE EM DEMANDA DE CLIENTE, e só escreve fora de
 *       CANCELADA/CONCLUIDA. Interna tem participantes.
 *
 * O card é montado de verdade (react-dom/server) — o texto que o smoke confere
 * é o que a tela mostra. Handlers e wiring ficam em guarda de fonte, porque
 * `Demands.tsx` não importa em Node (supabase, contexto do App).
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AcompanhantesBlock from '../components/demand-form/AcompanhantesBlock';
import {
  buildCompanionRow,
  companionHoursOf,
  summarizeCompanions,
  companionBlockMode,
  type CompanionRowLike,
} from '../domain/companionRows';
import { getDemandDays, isDemandDay } from '../domain/demandDays';
import { hasPersonScheduleConflict } from '../domain/personScheduleConflict';
import { resolveMeasurementPeople } from '../domain/measurementPeople';
import { companionDaysFromRows, companionDefaultHours } from '../domain/measurementOverrides';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);

const ler = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r/g, '');

/** Sem comentários: as guardas procuram CÓDIGO, e os comentários citam os nomes. */
const semComentarios = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // {/* ... */} de JSX
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ────────────────────────────────────────────────────────────────────────────
 * Dataset — demanda de cliente JÁ ALOCADA, vespertina, de segunda a sexta
 * ────────────────────────────────────────────────────────────────────────── */
const SEG = '2026-10-05';
const TER = '2026-10-06';
const QUA = '2026-10-07';
const QUI = '2026-10-08';
const SEX = '2026-10-09';

const DEM: any = {
  id: 'DEM-2001',
  tipo: 'cliente',
  status: 'ALOCADA',
  dateMode: 'CONTINUO',
  startDate: `${SEG}T13:00`,
  endDate: `${SEX}T19:00`,
  instructorId: 'TIT',
};
const ALOC_TIT = [{ id: 'A1', demandId: DEM.id, instructorId: 'TIT', startDate: DEM.startDate, endDate: DEM.endDate }];

/**
 * GABARITO — cópia CONGELADA da montagem que `Logistics.handleConfirmCompanion`
 * fazia inline antes de a função ir para o domínio (splitDateTime/buildDateTime
 * eram helpers locais da tela). Não importar nada aqui: se a função de domínio
 * mudar a convenção, é contra ISTO que ela tem de falhar.
 */
const splitDateTime = (value?: string) => {
  const v = value || '';
  if (!v) return { date: '', time: '' };
  const parts = v.split('T');
  return { date: parts[0] || '', time: (parts[1] || '').slice(0, 5) };
};
const buildDateTime = (date: string, time: string, fallbackTime: string) => {
  if (!date) return '';
  return `${date}T${(time || fallbackTime || '08:00').slice(0, 5)}`;
};
const linhaDaOrquestracao = (demand: any, instructorId: string, day: string) => {
  const startTime = splitDateTime(demand.startDate).time || '08:00';
  const endTime = splitDateTime(demand.endDate).time || '18:00';
  return {
    demandId: demand.id,
    instructorId,
    startDate: buildDateTime(day, startTime, '08:00'),
    endDate: buildDateTime(day, endTime, '18:00'),
  };
};

/** O que `addCompanionAllocation` (App.tsx) manda para o insert. */
const paraOBanco = (row: { demandId: string; instructorId: string; startDate: string; endDate: string }) => ({
  demand_id: row.demandId,
  instructor_id: row.instructorId,
  start_date: row.startDate,
  end_date: row.endDate,
});

/** Linhas com id, como o estado do App as guarda depois do insert. */
const gravar = (demand: any, instructorId: string, dias: string[], prefixo: string): CompanionRowLike[] =>
  dias.map((d, i) => ({ id: `${prefixo}-${i + 1}`, ...buildCompanionRow(demand, instructorId, d) }));

const demandsSrc = ler('components/Demands.tsx');
const demandsCode = semComentarios(demandsSrc);
const logisticaCode = semComentarios(ler('components/Logistics.tsx'));
const internaCode = semComentarios(ler('components/InternalDemands.tsx'));
const appCode = semComentarios(ler('App.tsx'));

const trecho = (src: string, de: string, ate: string) => {
  const i = src.indexOf(de);
  const f = src.indexOf(ate, i + de.length);
  return i < 0 ? '' : src.slice(i, f < 0 ? i + 3000 : f);
};

/* ────────────────────────────────────────────────────────────────────────────
 * [1] A LINHA DO BLOCO É A LINHA DA ORQUESTRAÇÃO
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[1] Adicionar em demanda alocada grava a mesma linha que a Orquestração');
{
  const dias = [TER, QUI];
  const doBloco = dias.map(d => paraOBanco(buildCompanionRow(DEM, 'ACOMP', d)));
  const daOrquestracao = dias.map(d => paraOBanco(linhaDaOrquestracao(DEM, 'ACOMP', d)));

  eq('demanda ALOCADA 13h–19h: payload idêntico, campo a campo', doBloco, daOrquestracao);
  eq('uma linha por dia escolhido', doBloco.length, 2);
  eq('com o horário da demanda, não 08–18', [doBloco[0].start_date, doBloco[0].end_date], [`${TER}T13:00`, `${TER}T19:00`]);
  eq('e nada além das quatro colunas', Object.keys(doBloco[0]), ['demand_id', 'instructor_id', 'start_date', 'end_date']);

  // CONTRAPROVA: o literal que o Drawer gravava NÃO é a linha da Orquestração
  // nesta demanda — se fosse, o gabarito não estaria medindo horário nenhum.
  const literal = dias.map(d => paraOBanco({ demandId: DEM.id, instructorId: 'ACOMP', startDate: `${d}T08:00`, endDate: `${d}T18:00` }));
  check('(contraprova) T08:00/T18:00 literais dariam OUTRA linha', JSON.stringify(literal) !== JSON.stringify(daOrquestracao));

  // Os formatos de startDate que a demanda pode ter no estado do App.
  const casos: [string, any][] = [
    ['sem hora gravada -> fallback 08:00 / 18:00', { ...DEM, startDate: SEG, endDate: SEX }],
    ['timestamptz cru do banco (segundos e offset) -> só HH:mm', { ...DEM, startDate: `${SEG}T13:00:00+00:00`, endDate: `${SEX}T19:00:00+00:00` }],
    ['demanda noturna que vira o dia', { ...DEM, startDate: `${SEG}T22:00`, endDate: `${SEX}T02:00` }],
    ['dias específicos: a hora é a da demanda em todos os dias', {
      ...DEM, dateMode: 'DIAS_ESPECIFICOS', startDate: `${SEG}T07:30`, endDate: `${QUI}T16:30`,
      specificDates: [
        { data: SEG, horarioInicio: '07:30', horarioFim: '11:30' },
        { data: QUI, horarioInicio: '13:00', horarioFim: '16:30' },
      ],
    }],
    ['demanda PENDENTE, sem instrutor', { ...DEM, status: 'PENDENTE', instructorId: undefined }],
  ];
  for (const [nome, demanda] of casos) {
    eq(nome, paraOBanco(buildCompanionRow(demanda, 'ACOMP', QUI)), paraOBanco(linhaDaOrquestracao(demanda, 'ACOMP', QUI)));
  }

  eq('sem hora: 08:00 e 18:00', companionHoursOf({ id: 'X', startDate: SEG, endDate: SEX }), { horaInicio: '08:00', horaFim: '18:00' });
  check(
    'a linha é string de parede montada por concatenação (sem Z, sem segundos)',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(doBloco[0].start_date) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(doBloco[0].end_date)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [2] AS DUAS TELAS CHAMAM A MESMA FUNÇÃO, PELO MESMO SERVIÇO
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[2] Bloco e Orquestração gravam pelo mesmo caminho (fonte)');
{
  const hBloco = trecho(demandsCode, 'const handleConfirmCompanion', 'const handleRemoveCompanion');
  const hLog = trecho(logisticaCode, 'const handleConfirmCompanion', 'const handleRemoveCompanion');

  check('Orquestração monta a linha por buildCompanionRow', hLog.includes('...buildCompanionRow(selectedDemand, instructorId, day)'));
  check('o bloco monta a linha por buildCompanionRow', hBloco.includes('...buildCompanionRow(companionDemand, instructorId, day)'));
  check(
    'a demanda do bloco é a do estado do App, como na Orquestração (não o formulário aberto)',
    /const companionDemand = useMemo\(\s*\(\) => \(formDemand\.id \? demands\.find\(d => d\.id === formDemand\.id\) \?\? null : null\)/.test(demandsCode)
  );

  for (const [nome, h] of [['Orquestração', hLog], ['bloco', hBloco]] as const) {
    check(`${nome}: uma linha POR DIA, pelo addCompanionAllocation do App`, h.includes('dias.forEach(day => {') && h.includes('addCompanionAllocation({'));
    check(`${nome}: mesmo id provisório`, h.includes('id: `CA-${Date.now()}-${day}`,'));
    check(`${nome}: nenhum horário literal`, !/T08:00|T18:00|'08:00'|'18:00'/.test(h));
    check(
      `${nome}: bloco de logística UMA vez, fora do laço`,
      (h.match(/ensureLogisticBlocksForPerson\(/g) ?? []).length === 1 &&
        h.indexOf('});') < h.indexOf('ensureLogisticBlocksForPerson(')
    );
    check(`${nome}: recusa quem já acompanha a demanda`, /some\(\(?\w+(: any)?\)? => \w+\.instructorId === instructorId\)/.test(h));
  }

  check(
    'o bloco não escreve direto na tabela (insert/delete moram no serviço)',
    !/\.from\('companion_allocations'\)[\s\S]{0,120}\.(insert|delete)\(/.test(demandsCode)
  );

  const add = trecho(appCode, 'const addCompanionAllocation', 'const removeCompanionAllocation');
  check(
    'o App insere exatamente as quatro colunas da linha',
    add.includes('insertCompanionAllocation({') &&
      add.includes('demand_id: a.demandId') && add.includes('instructor_id: a.instructorId') &&
      add.includes('start_date: a.startDate') && add.includes('end_date: a.endDate')
  );

  // A logística do modal é relida depois que os blocos da pessoa nascem: o save
  // do formulário regrava os blocos a partir do estado do formulário.
  check('o bloco ESPERA os blocos de logística', hBloco.includes('await ensureLogisticBlocksForPerson(companionDemand.id, instructorId)'));
  check('e relê a logística do modal em seguida', hBloco.indexOf('setLogisticsReloadKey(') > hBloco.indexOf('await ensureLogisticBlocksForPerson('));
  check(
    'pela leitura que já existia (o contador só redispara o efeito)',
    demandsCode.includes('}, [isModalOpen, modalMode, modalSubMode, formDemand.id, logisticsReloadKey]);')
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [3] UMA PESSOA NA TELA — "2 de 5 dias" / "período todo"
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[3] A lista mostra pessoas, com os dias acompanhados');
const diasDaDemanda = getDemandDays(DEM);
const linhasParcial = gravar(DEM, 'ACOMP', [TER, QUI], 'P');
const linhasTudo = gravar(DEM, 'TODO', [SEG, TER, QUA, QUI, SEX], 'T');
{
  eq('a demanda tem 5 dias', diasDaDemanda.length, 5);

  const resumo = summarizeCompanions([...linhasParcial, ...linhasTudo], diasDaDemanda);
  eq('7 linhas viram 2 pessoas', resumo.length, 2);

  const parcial = resumo.find(r => r.instructorId === 'ACOMP')!;
  const tudo = resumo.find(r => r.instructorId === 'TODO')!;
  eq('acompanha 2 dos 5', parcial.rotuloDias, '2 de 5 dias');
  eq('e os dias são os escolhidos', parcial.diasDentro, [TER, QUI]);
  eq('acompanha todos', tudo.rotuloDias, 'período todo');
  check('período todo', tudo.periodoTodo && !parcial.periodoTodo);
  eq('dentro do período: sem aviso', [parcial.cobertura, tudo.cobertura], ['DENTRO', 'DENTRO']);
  eq('a entrada carrega TODAS as linhas da pessoa', [parcial.rowIds, tudo.rowIds.length], [['P-1', 'P-2'], 5]);

  eq('demanda de 1 dia: singular', summarizeCompanions(
    [{ id: 'X', instructorId: 'A', startDate: '2026-11-03T08:00', endDate: '2026-11-03T18:00' }], [SEG]
  )[0].rotuloDias, '0 de 1 dia');

  // Duas linhas no MESMO dia (dado que a reescrita antiga deixou) contam um dia.
  const dup = summarizeCompanions([...linhasParcial, { ...linhasParcial[0], id: 'P-dup' }], diasDaDemanda)[0];
  eq('linha duplicada no mesmo dia não vira um dia a mais', dup.rotuloDias, '2 de 5 dias');
  eq('mas entra na lixeira', dup.rowIds.length, 3);

  const html = renderToStaticMarkup(
    <AcompanhantesBlock
      mode="EDICAO"
      entries={resumo}
      getInstructorName={id => (id === 'ACOMP' ? 'Ana Acompanha' : 'Tiago Todo')}
      onAdd={() => {}}
      onRemove={() => {}}
    />
  );
  check('o card se chama Acompanhantes', html.includes('Acompanhantes'));
  check('mostra o nome uma vez só', (html.match(/Ana Acompanha/g) ?? []).length === 1);
  check('com "2 de 5 dias"', html.includes('2 de 5 dias'));
  check('e os dias escolhidos', html.includes('06/10, 08/10'));
  check('e "período todo"', html.includes('período todo'));
  check('uma lixeira por pessoa', (html.match(/title="Remover acompanhante"/g) ?? []).length === 2);
  check('botão Adicionar', html.includes('Adicionar'));
  check('sem aviso de período', !html.includes('ora do período da demanda'));

  const vazio = renderToStaticMarkup(
    <AcompanhantesBlock mode="EDICAO" entries={[]} getInstructorName={() => ''} onAdd={() => {}} onRemove={() => {}} />
  );
  check('sem ninguém: diz que não há acompanhante, e o Adicionar continua lá', vazio.includes('Nenhum acompanhante alocado.') && vazio.includes('Adicionar'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [4] REMOVER APAGA
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[4] Remover apaga todas as linhas da pessoa, e só as dela');
{
  let estado: CompanionRowLike[] = [...linhasParcial, ...linhasTudo];
  // removeCompanionAllocation do App, como ele mexe no estado.
  const removeCompanionAllocation = (id: string) => { estado = estado.filter(x => x.id !== id); };

  const alvo = summarizeCompanions(estado, diasDaDemanda).find(r => r.instructorId === 'ACOMP')!;
  alvo.rowIds.forEach(id => removeCompanionAllocation(id));

  const depois = summarizeCompanions(estado, diasDaDemanda);
  check('a pessoa some da lista', !depois.some(r => r.instructorId === 'ACOMP'));
  eq('nenhuma linha dela sobra', estado.filter(r => r.instructorId === 'ACOMP').length, 0);
  eq('as linhas do outro acompanhante ficam intactas', estado.filter(r => r.instructorId === 'TODO').length, 5);

  check(
    'e a agenda dela volta a ficar livre',
    !hasPersonScheduleConflict({ instructorId: 'ACOMP', startDate: TER, endDate: TER, assignments: estado as any, demands: [DEM] })
  );

  const hRem = trecho(demandsCode, 'const handleRemoveCompanion', 'return (');
  check('a lixeira apaga cada linha pelo removeCompanionAllocation do App', hRem.includes('entry.rowIds.forEach(id => removeCompanionAllocation(id))'));
  check(
    'libera os blocos de logística vazios pela rotina compartilhada',
    hRem.includes('await releaseLogisticBlocksForPerson(demandId, entry.instructorId)')
  );
  check(
    'menos quando a pessoa também ministra a demanda (os blocos são do titular)',
    hRem.includes('const continuaVinculado = companionTitularIds.includes(entry.instructorId)') &&
      /if \(!continuaVinculado\) \{\s*await releaseLogisticBlocksForPerson\(/.test(hRem)
  );
  check('e relê a logística do modal', hRem.includes('setLogisticsReloadKey('));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [5] DIAS FORA DO PERÍODO AVISAM
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[5] Dias que não batem mais com a demanda avisam');
{
  // A demanda encolheu para seg–qua: a quinta do acompanhante ficou de fora.
  const encolhida = { ...DEM, endDate: `${QUA}T19:00` };
  const parcial = summarizeCompanions(linhasParcial, getDemandDays(encolhida))[0];
  eq('um dia dentro, um fora', [parcial.diasDentro, parcial.diasFora], [[TER], [QUI]]);
  eq('cobertura parcial', parcial.cobertura, 'PARCIAL');
  eq('o rótulo conta só o que ainda é dia da demanda', parcial.rotuloDias, '1 de 3 dias');

  // A demanda foi para a semana seguinte: nada do que está gravado sobrou.
  const movida = { ...DEM, startDate: '2026-10-12T13:00', endDate: '2026-10-16T19:00' };
  const fora = summarizeCompanions(linhasParcial, getDemandDays(movida))[0];
  eq('tudo fora', [fora.cobertura, fora.diasDentro.length, fora.diasFora], ['FORA', 0, [TER, QUI]]);
  eq('rótulo de quem não acompanha dia nenhum', fora.rotuloDias, '0 de 5 dias');

  // Dias específicos: tirar o dia do MEIO não muda início nem fim da demanda —
  // o reagendamento não roda, e a linha daquele dia fica para trás.
  const especifica = {
    ...DEM, dateMode: 'DIAS_ESPECIFICOS',
    specificDates: [SEG, SEX].map(data => ({ data, horarioInicio: '13:00', horarioFim: '19:00' })),
  };
  const buraco = summarizeCompanions(gravar(DEM, 'ACOMP', [SEG, QUA], 'E'), getDemandDays(especifica))[0];
  eq('dia específico removido do meio: parcial', [buraco.cobertura, buraco.diasFora], ['PARCIAL', [QUA]]);

  // O mesmo critério da medição: dia fora da demanda não é dia de trabalho.
  eq(
    'os dias "dentro" são os que a medição conta',
    parcial.diasDentro,
    companionDaysFromRows(linhasParcial.map(l => ({ demandId: DEM.id, instructorId: l.instructorId, startDate: l.startDate })), getDemandDays(encolhida))
  );

  const html = renderToStaticMarkup(
    <AcompanhantesBlock mode="EDICAO" entries={[parcial]} getInstructorName={() => 'Ana Acompanha'} onAdd={() => {}} onRemove={() => {}} />
  );
  check('o card avisa "parcialmente fora"', html.includes('Parcialmente fora do período da demanda'));
  check('em âmbar, como o bloco Instrutores da interna', html.includes('bg-amber-50 border-amber-300'));
  check('dizendo qual dia ficou de fora', html.includes('08/10'));
  check('e com a lixeira sempre visível', html.includes('opacity-100') && !html.includes('group-hover:opacity-100'));

  const htmlFora = renderToStaticMarkup(
    <AcompanhantesBlock mode="EDICAO" entries={[fora]} getInstructorName={() => 'Ana Acompanha'} onAdd={() => {}} onRemove={() => {}} />
  );
  check('tudo fora: "Fora do período da demanda"', htmlFora.includes('Fora do período da demanda') && !htmlFora.includes('Parcialmente'));

  check(
    'a tela calcula a cobertura contra os dias reais da demanda',
    demandsCode.includes('summarizeCompanions(companionRowsOfDemand, getDemandDays(base as any))')
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [6] SÓ DEMANDA DE CLIENTE, E SÓ ESCREVE FORA DE CANCELADA/CONCLUIDA
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[6] Interna não mostra o bloco; cancelada e concluída só leem');
{
  eq('interna: oculto, em qualquer status', ['NOVA', 'ALOCADA', 'CONCLUIDA'].map(s => companionBlockMode({ tipo: 'interna' }, s, true)), ['OCULTO', 'OCULTO', 'OCULTO']);
  eq(
    'cliente: escreve em todo status que não é final — com ou sem instrutor',
    ['NOVA', 'PENDENTE', 'ALOCADA', 'EM_ANDAMENTO'].map(s => companionBlockMode({ tipo: 'cliente' }, s, true)),
    ['EDICAO', 'EDICAO', 'EDICAO', 'EDICAO']
  );
  eq('cancelada e concluída: só leitura', ['CANCELADA', 'CONCLUIDA'].map(s => companionBlockMode({ tipo: 'cliente' }, s, true)), ['LEITURA', 'LEITURA']);
  eq('perfil sem edição: só leitura', companionBlockMode({ tipo: 'cliente' }, 'ALOCADA', false), 'LEITURA');
  eq('demanda antiga sem tipo é de cliente', companionBlockMode({}, 'ALOCADA', true), 'EDICAO');

  const resumo = summarizeCompanions(linhasParcial, diasDaDemanda);
  const render = (mode: any) =>
    renderToStaticMarkup(
      <AcompanhantesBlock mode={mode} entries={resumo} getInstructorName={() => 'Ana Acompanha'} onAdd={() => {}} onRemove={() => {}} />
    );

  eq('interna: o card não renderiza nada', render(companionBlockMode({ tipo: 'interna' }, 'ALOCADA', true)), '');
  const leitura = render(companionBlockMode({ tipo: 'cliente' }, 'CONCLUIDA', true));
  check('concluída: a lista aparece', leitura.includes('Ana Acompanha') && leitura.includes('2 de 5 dias'));
  check('sem Adicionar', !leitura.includes('Adicionar'));
  check('e sem lixeira', !leitura.includes('Remover acompanhante'));

  check(
    'a tela decide o modo pela função pura, com o status calculado do modal',
    demandsCode.includes('mode={companionBlockMode(formDemand, currentStatus, canEditDemand)}')
  );
  check('o bloco entra uma vez, na visualização de cliente', (demandsCode.match(/<AcompanhantesBlock/g) ?? []).length === 1);
  check('a tela de cliente não recebe interna', demandsCode.includes("allDemands.filter(d => d.tipo !== 'interna')"));
  check('a tela de interna não tem o bloco', !internaCode.includes('AcompanhantesBlock'));
  check('nem o seletor de acompanhante', !internaCode.includes('CompanionPicker'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [7] O SELETOR É O MESMO, E O CONFLITO AVISA
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[7] CompanionPicker reaproveitado; conflito avisa e deixa alocar');
{
  const uso = trecho(demandsCode, '<CompanionPicker', '/>');
  check('o bloco abre o CompanionPicker', uso.length > 0 && demandsCode.includes("import CompanionPicker from './CompanionPicker'"));
  check('com o hasScheduleConflict do App (que já conta acompanhante)', uso.includes('hasScheduleConflict={hasScheduleConflict}'));
  check('gravando pelo handler do bloco', uso.includes('onConfirm={handleConfirmCompanion}'));
  check('sem quem já acompanha e sem quem ministra', uso.includes('alreadyCompanionIds={companionPickerExcludedIds}'));
  check(
    'titulares = alocações da demanda + instrutor principal',
    /const companionTitularIds = useMemo\(\(\) => \{[\s\S]{0,200}allInstructorsByDemandId\[formDemand\.id\][\s\S]{0,200}formDemand\.instructorId/.test(demandsCode)
  );
  check('nenhum seletor novo nesta tela', (demandsCode.match(/<CompanionPicker/g) ?? []).length === 1);

  const picker = ler('components/CompanionPicker.tsx');
  const card = ler('components/InstructorCard.tsx');
  check('os três grupos continuam no picker', ["grupo('QUALIFICADOS'", "grupo('EXCEÇÃO'", "grupo('DEMAIS ATIVOS'"].every(g => picker.includes(g)));
  check('aviso "Já alocado neste dia"', card.includes("'Já alocado neste dia'"));
  check('e "Alocar mesmo assim"', card.includes("hasConflict ? 'Alocar mesmo assim' : actionLabel"));

  // A linha gravada pelo bloco ocupa a agenda da pessoa — é o que acende o aviso
  // no picker de OUTRA demanda no mesmo dia.
  const OUTRA: any = { ...DEM, id: 'DEM-2002', startDate: `${TER}T08:00`, endDate: `${QUA}T17:00`, instructorId: undefined, status: 'PENDENTE' };
  const base = { instructorId: 'ACOMP', assignments: linhasParcial as any, demands: [DEM, OUTRA], excludeDemandId: OUTRA.id };
  check('terça (dia acompanhado): conflito', hasPersonScheduleConflict({ ...base, startDate: TER, endDate: TER }));
  check('quarta (dia NÃO acompanhado): livre', !hasPersonScheduleConflict({ ...base, startDate: QUA, endDate: QUA }));
  check(
    'na própria demanda não há conflito consigo mesmo',
    !hasPersonScheduleConflict({ ...base, startDate: TER, endDate: TER, excludeDemandId: DEM.id })
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * [8] AGENDA E MEDIÇÃO NÃO DISTINGUEM A ORIGEM DA LINHA
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[8] Agenda e medição leem a linha do bloco como leem a da Orquestração');
{
  const dias = [TER, QUI];
  const doBloco = dias.map((d, i) => ({ id: `B-${i}`, ...buildCompanionRow(DEM, 'ACOMP', d) }));
  const daOrquestracao = dias.map((d, i) => ({ id: `B-${i}`, ...linhaDaOrquestracao(DEM, 'ACOMP', d) }));

  // Agenda: o card do acompanhante sai nos dias da linha que são dias da demanda.
  check('agenda: cada linha cai num dia da demanda', doBloco.every(l => isDemandDay(DEM, l.startDate)));

  // Medição (F3): pessoas, dias e a sugestão de horas.
  const leitura = (linhas: typeof doBloco) => ({
    pessoas: resolveMeasurementPeople(DEM, ALOC_TIT, [], linhas),
    dias: companionDaysFromRows(linhas, diasDaDemanda),
    sugestao: companionDefaultHours(40, diasDaDemanda.length, companionDaysFromRows(linhas, diasDaDemanda).length),
  });
  eq('medição: mesma leitura para as duas origens', leitura(doBloco), leitura(daOrquestracao));
  eq('titular + acompanhante', leitura(doBloco).pessoas.map(p => `${p.instructorId}:${p.papel}`), ['TIT:TITULAR', 'ACOMP:ACOMPANHANTE']);
  eq('2 dias', leitura(doBloco).dias, dias);
  eq('sugestão proporcional: 2 de 5 dias de 40h', leitura(doBloco).sugestao, 16);
}

/* ────────────────────────────────────────────────────────────────────────── */
console.log(falhas === 0 ? '\n✅ SMOKE ACOMPANHANTES: OK' : `\n❌ SMOKE ACOMPANHANTES: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
