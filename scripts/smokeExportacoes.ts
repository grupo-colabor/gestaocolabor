/**
 * SMOKE — Módulo Exportações (F1)
 *
 * Rodar com:  npm run smoke:exportacoes
 *
 * O motor de exportação NÃO recalcula nada: cada número que ele imprime tem
 * que ser igual ao que o painel, o Dashboard ou o Excel de pagamento já
 * mostram. Este arquivo prende isso:
 *
 *   [A] Σ hora/aula e Σ despesas por bucket das linhas de uma medição fecham
 *       com `computeMeasurementTotals` / `computePanelExpenseBreakdown`; e o
 *       Σ Total geral das internas concluídas fecha com o card "Custo das
 *       Demandas Internas" do Dashboard (`aggregateMeasurements.horaAula +
 *       aggregatePanelExpenseBreakdown.total`).
 *   [B] `Horas pagamento` por (demanda, pessoa) é exatamente a saída de
 *       `applyMeasurementOverrides` sobre o rateio; onde o Excel não gera
 *       linha, a coluna fica EM BRANCO (nunca zero) e `Elegível` é falso.
 *   [C] Medição v1 gera UMA linha de titular com todos os anexos; item sem
 *       dono e item de dono removido caem no titular; cliente dividido por
 *       dias gera uma linha por titular.
 *   [D] Rótulos: 'Colabor (Interna)', modalidade resolvida pelo treinamento,
 *       noturno pela regra do domínio, status calculado com modalidade, data
 *       'dd/mm/yyyy' igual a `formatDateOnlySafe`.
 *   [E] Guarda de fonte: domain/exports/** e os dois módulos de domínio novos
 *       não importam services/, react ou exceljs — é o que deixa este smoke
 *       rodar em Node sem cliente de banco.
 *   [F] CSV: ';', decimal com vírgula, BOM, aspas dobradas, quebra de linha.
 *   [G] Registry/colunas: chave única por dataset, ordem da saída segue a
 *       seleção, chave desconhecida é erro, defaults aprovados (Horas
 *       pagamento e Elegível ligadas; Informadas/Painel/Origem desligadas).
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';

import { EMPTY_FILTERS, type ExportTable } from '../domain/exports/types';
import { applyFilters, buildFilterOptions } from '../domain/exports/filters';
import { buildCsv, escapeCsvField, formatCsvCell } from '../domain/exports/csv';
import { toBrDate, toBrTime, resolveCompanyLabel, resolveCalculatedStatus } from '../domain/exports/shared';
import { resolveMeasurementPeople } from '../domain/measurementPeople';
import { panelDefaultHours } from '../domain/demandDefaultHours';
import { formatDateOnlySafe } from '../components/demand-form/formatters';
import { INTERNAL_COMPANY_LABEL } from '../domain/demandLabel';
import { buildTrainingsById } from '../domain/modalityOptions';

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
    Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`
  );

const perto = (nome: string, atual: number, esperado: number) =>
  check(nome, Math.abs(atual - esperado) < 1e-6, `esperado ${esperado}, veio ${atual}`);

const raiz = process.cwd();
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function listarTs(dir: string): string[] {
  const out: string[] = [];
  for (const nome of fs.readdirSync(path.join(raiz, dir))) {
    const rel = path.join(dir, nome).replace(/\\/g, '/');
    if (fs.statSync(path.join(raiz, rel)).isDirectory()) out.push(...listarTs(rel));
    else if (rel.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/* "Hoje" fixo: as fixtures ficam no passado e o status calculado não muda com o relógio. */
const HOJE = new Date('2026-09-15T12:00:00');

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures compartilhadas (domínio, sem banco)
 * ────────────────────────────────────────────────────────────────────────── */
const TRAININGS: any[] = [
  { id: 'T_PRE', name: 'NR 35 Trabalho em Altura', hours: 16, practicalHours: null, modality: 'PRESENCIAL' },
  // ⚠️ Sem acento de propósito: `normalizeModality` de domain/instructorHours.ts
  // NÃO tira acento, então um treinamento gravado como 'Híbrido' paga a carga
  // cheia (hours) no Excel em vez das práticas. É comportamento anterior à F1,
  // registrado no relatório da entrega; o export reproduz o Excel, não o corrige.
  { id: 'T_HIB', name: 'NR 20 Intermediário', hours: 40, practicalHours: 8, modality: 'HIBRIDO' },
  { id: 'T_EAD', name: 'NR 01 Básico', hours: 4, practicalHours: null, modality: 'EAD' },
];
const trainingsById = buildTrainingsById(TRAININGS);

const COMPANIES = [{ id: 'C1', name: 'Vale' }];
const INSTRUCTORS = [
  { id: 'INS-T', name: 'Titular' },
  { id: 'INS-2', name: 'Segundo' },
  { id: 'INS-3', name: 'Terceiro' },
  { id: 'INS-A', name: 'Acompanhante' },
];

const demandaCliente = (over: any = {}): any => ({
  id: 'DEM-100',
  tipo: 'cliente',
  companyId: 'C1',
  trainingId: 'T_PRE',
  regionId: 'MG',
  trainingLocal: 'Itabira',
  demandState: 'MG',
  modality: 'PRESENCIAL',
  dateMode: 'CONTINUO',
  startDate: '2026-08-10T08:00',
  endDate: '2026-08-11T17:00',
  status: 'ALOCADA',
  instructorId: 'INS-T',
  ...over,
});

const demandaInterna = (over: any = {}): any => ({
  id: 'DEM-900',
  tipo: 'interna',
  companyId: '',
  trainingId: '',
  categoriaInterna: 'SIPAT',
  descricaoInterna: 'Palestra de abertura',
  horasPrevistas: 16,
  regionId: 'ES',
  trainingLocal: 'Vitória',
  demandState: 'ES',
  modality: 'PRESENCIAL',
  dateMode: 'CONTINUO',
  startDate: '2026-08-03T08:00',
  endDate: '2026-08-04T18:00',
  status: 'ALOCADA',
  instructorId: 'INS-T',
  ...over,
});

/* ────────────────────────────────────────────────────────────────────────────
 * [E] GUARDA DE FONTE — domínio de exportação isolado de I/O e de UI
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[E] Guarda de fonte — domain/exports sem services, react ou exceljs');
{
  const arquivos = [
    ...listarTs('domain/exports'),
    'domain/measurementPeople.ts',
    'domain/demandDefaultHours.ts',
  ];
  check('há arquivos em domain/exports', arquivos.length >= 5);
  for (const rel of arquivos) {
    const src = semComentarios(ler(rel));
    check(`${rel} não importa services/`, !/from\s+['"][^'"]*\/services\//.test(src));
    check(`${rel} não importa react`, !/from\s+['"]react(-dom)?['"]/.test(src));
    check(`${rel} não importa exceljs`, !/exceljs/.test(src));
    check(`${rel} não toca supabase`, !/supabase/i.test(src));
    check(`${rel} não importa de components/`, !/from\s+['"][^'"]*\/components\//.test(src));
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * [D-parcial] Resoluções compartilhadas (as demais entram com os datasets)
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[D] Resoluções compartilhadas');
{
  for (const v of ['2026-08-10', '2026-08-10T00:30', '2026-08-10T23:59:00+00:00', '2025-12-31T18:00']) {
    eq(`toBrDate(${v}) == formatDateOnlySafe`, toBrDate(v), formatDateOnlySafe(v));
  }
  eq('toBrDate vazio -> vazio (não "---")', toBrDate(''), '');
  eq('toBrTime pega HH:mm', toBrTime('2026-08-10T18:30:00'), '18:30');
  eq('toBrTime sem hora -> vazio', toBrTime('2026-08-10'), '');

  eq('interna sem empresa -> rótulo do app', resolveCompanyLabel(demandaInterna(), COMPANIES), INTERNAL_COMPANY_LABEL);
  eq('interna com empresa -> nome dela', resolveCompanyLabel(demandaInterna({ companyId: 'C1' }), COMPANIES), 'Vale');
  eq('cliente sem empresa -> visível', resolveCompanyLabel(demandaCliente({ companyId: '' }), COMPANIES), '(sem empresa)');
  eq('cliente com empresa que não veio -> visível', resolveCompanyLabel(demandaCliente({ companyId: 'C9' }), COMPANIES), '(empresa não encontrada)');

  // Status calculado COM modalidade: EAD sem instrutor no passado é CONCLUÍDA,
  // nunca PENDENTE (a variante sem modalidade do Export Modal erraria aqui).
  const ead = demandaCliente({ id: 'DEM-EAD', trainingId: 'T_EAD', instructorId: undefined });
  eq('EAD concluída sem instrutor -> CONCLUIDA', resolveCalculatedStatus(ead, trainingsById, HOJE), 'CONCLUIDA');
  eq('presencial no passado -> CONCLUIDA', resolveCalculatedStatus(demandaCliente(), trainingsById, HOJE), 'CONCLUIDA');
  eq('cancelada ganha sempre', resolveCalculatedStatus(demandaCliente({ status: 'CANCELADA' }), trainingsById, HOJE), 'CANCELADA');

  eq('carga padrão interna = horasPrevistas', panelDefaultHours(demandaInterna(), undefined), 16);
  eq('carga padrão cliente = training.hours (não practicalHours)', panelDefaultHours(demandaCliente(), TRAININGS[1]), 40);
  eq('carga padrão sem treinamento = 0', panelDefaultHours(demandaCliente(), undefined), 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pessoas por demanda — a lista sem o gate do painel
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[C0] resolveMeasurementPeople');
{
  const alocs = [
    { id: 'A1', demandId: 'DEM-100', instructorId: 'INS-T', startDate: '2026-08-10T08:00', endDate: '2026-08-10T17:00' },
    { id: 'A2', demandId: 'DEM-100', instructorId: 'INS-2', startDate: '2026-08-11T08:00', endDate: '2026-08-11T17:00' },
  ];
  const semSegunda = resolveMeasurementPeople(demandaCliente(), alocs, [], []);
  eq('cliente dividido por dias -> dois titulares (o painel devolveria vazio)',
    semSegunda.map(p => `${p.instructorId}:${p.papel}`), ['INS-T:TITULAR', 'INS-2:TITULAR']);

  const mono = resolveMeasurementPeople(demandaCliente(), [], [], []);
  eq('sem alocação -> fallback no instructor_id principal', mono.map(p => p.instructorId + ':' + p.vinculo), ['INS-T:principal']);

  const comAcomp = resolveMeasurementPeople(demandaCliente(), alocs, [], [
    { demandId: 'DEM-100', instructorId: 'INS-A' },
    { demandId: 'DEM-100', instructorId: 'INS-A' }, // uma linha por dia
    { demandId: 'DEM-100', instructorId: 'INS-T' }, // titular também acompanhante: não duplica
    { demandId: 'DEM-999', instructorId: 'INS-3' }, // outra demanda
  ]);
  eq('acompanhante distinto, sem duplicar titular nem dia',
    comAcomp.map(p => `${p.instructorId}:${p.papel}`), ['INS-T:TITULAR', 'INS-2:TITULAR', 'INS-A:ACOMPANHANTE']);

  const interna = resolveMeasurementPeople(demandaInterna(), [], [
    { demandId: 'DEM-900', instructorId: 'INS-2' },
    { demandId: 'DEM-900', instructorId: 'INS-T' }, // coincide com o titular
  ], [{ demandId: 'DEM-900', instructorId: 'INS-A' }]);
  eq('interna: titular + participante; acompanhante ignorado; participante==titular não duplica',
    interna.map(p => `${p.instructorId}:${p.papel}`), ['INS-T:TITULAR', 'INS-2:PARTICIPANTE']);

  eq('sem ninguém -> lista vazia (o dataset cria a linha sem pessoa)',
    resolveMeasurementPeople(demandaCliente({ instructorId: undefined }), [], [], []), []);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Filtros
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[FILTROS] applyFilters só aplica o que o dataset permite');
{
  const rows: any[] = [
    { demand: demandaCliente(), instructorId: 'INS-T', papel: 'TITULAR' },
    { demand: demandaCliente({ id: 'DEM-101', demandState: 'es', startDate: '2026-09-01T08:00', endDate: '2026-09-02T17:00' }), instructorId: 'INS-2', papel: 'ACOMPANHANTE' },
    { demand: demandaInterna(), instructorId: 'INS-T', papel: 'TITULAR' },
    { demand: demandaCliente({ id: 'DEM-EAD', trainingId: 'T_EAD', instructorId: undefined }) },
  ];
  const ctx = { trainingsById, now: HOJE };
  const todos: any = ['periodo', 'status', 'modalidade', 'tipo', 'uf', 'cliente', 'instrutor', 'papel'];

  eq('sem filtro -> tudo', applyFilters(rows, EMPTY_FILTERS, todos, ctx).length, 4);
  eq('período por interseção (11-20/08 pega DEM-100 e DEM-EAD, não DEM-101 nem a interna)',
    applyFilters(rows, { ...EMPTY_FILTERS, dataInicio: '2026-08-11', dataFim: '2026-08-20' }, todos, ctx).map(r => r.demand.id), ['DEM-100', 'DEM-EAD']);
  eq('UF case-insensitive', applyFilters(rows, { ...EMPTY_FILTERS, uf: 'ES' }, todos, ctx).map(r => r.demand.id), ['DEM-101', 'DEM-900']);
  eq('tipo interna', applyFilters(rows, { ...EMPTY_FILTERS, tipo: 'interna' }, todos, ctx).map(r => r.demand.id), ['DEM-900']);
  eq('cliente por company_id', applyFilters(rows, { ...EMPTY_FILTERS, companyId: 'C1' }, todos, ctx).length, 3);
  eq('modalidade resolvida pelo treinamento (EAD -> ONLINE)',
    applyFilters(rows, { ...EMPTY_FILTERS, modalidade: 'ONLINE' }, todos, ctx).map(r => r.demand.id), ['DEM-EAD']);
  eq('status calculado', applyFilters(rows, { ...EMPTY_FILTERS, status: 'CONCLUIDA' }, todos, ctx).length, 4);
  eq('papel', applyFilters(rows, { ...EMPTY_FILTERS, papel: 'ACOMPANHANTE' }, todos, ctx).map(r => r.demand.id), ['DEM-101']);
  eq('instrutor', applyFilters(rows, { ...EMPTY_FILTERS, instructorId: 'INS-T' }, todos, ctx).length, 2);
  eq('filtro de instrutor NÃO zera dataset que não o declara',
    applyFilters(rows, { ...EMPTY_FILTERS, instructorId: 'INS-T' }, ['periodo', 'status'], ctx).length, 4);

  const opts = buildFilterOptions(rows, TRAININGS, COMPANIES, INSTRUCTORS);
  eq('UFs presentes, maiúsculas, ordenadas', opts.uf, ['ES', 'MG']);
  eq('instrutores presentes por nome', opts.instrutores.map(i => i.name), ['Segundo', 'Titular']);
  eq('clientes presentes', opts.clientes.map(c => c.name), ['Vale']);
  check('modalidade inclui PRESENCIAL e ONLINE', opts.modalidade.some(m => m.value === 'PRESENCIAL') && opts.modalidade.some(m => m.value === 'ONLINE'));
}

/* ────────────────────────────────────────────────────────────────────────────
 * [F] CSV
 * ────────────────────────────────────────────────────────────────────────── */
console.log('\n[F] CSV para Excel pt-BR');
{
  eq('moeda 2 casas com vírgula', formatCsvCell(1234.5, 'currency'), '1234,50');
  eq('horas até 2 casas', formatCsvCell(2.6666667, 'hours'), '2,67');
  eq('número inteiro', formatCsvCell(3, 'number'), '3');
  eq('null -> vazio (não zero)', formatCsvCell(null, 'currency'), '');
  eq('boolean -> Sim', formatCsvCell(true, 'boolean'), 'Sim');
  eq('texto com ; ganha aspas', escapeCsvField('a;b'), '"a;b"');
  eq('aspas internas dobradas', escapeCsvField('diz "oi"'), '"diz ""oi"""');
  eq('quebra de linha ganha aspas', escapeCsvField('l1\nl2'), '"l1\nl2"');
  eq('texto simples sem aspas', escapeCsvField('Vale'), 'Vale');

  const table: ExportTable = {
    columns: [
      { key: 'a', header: 'Empresa', kind: 'text' },
      { key: 'b', header: 'Total (R$)', kind: 'currency' },
      { key: 'c', header: 'Noturno', kind: 'boolean' },
    ],
    rows: [['Vale; Norte', 10, false], ['Colabor (Interna)', null, true]],
  };
  const csv = buildCsv(table);
  check('começa com BOM', csv.charCodeAt(0) === 0xfeff);
  eq('linhas com ; e CRLF', csv.slice(1), 'Empresa;Total (R$);Noturno\r\n"Vale; Norte";10,00;Não\r\nColabor (Interna);;Sim\r\n');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Datasets — [A] [B] [C] [D] [G] entram nos commits seguintes
 * ────────────────────────────────────────────────────────────────────────── */
export const fixtures = { TRAININGS, trainingsById, COMPANIES, INSTRUCTORS, demandaCliente, demandaInterna, HOJE };
export { check, eq, perto, ler, semComentarios };

/* eslint-disable @typescript-eslint/no-var-requires */
// Os blocos de dataset vivem em arquivos irmãos para este ficar legível; cada
// um recebe as mesmas fixtures e o mesmo contador de falhas.
import { runDatasetChecks } from './smokeExportacoesDatasets';
// ⚠️ NÃO usar `falhas += runDatasetChecks(...)`: o JS lê o operando da esquerda
// ANTES de chamar a função, e os `falhas++` feitos lá dentro (via `check`) eram
// sobrescritos pela soma — o smoke imprimia FALHA e saía com 0. O contador
// local do módulo de datasets é a fonte; o `check` daqui só imprime.
const falhasDatasets = runDatasetChecks({ check, eq, perto, ler, semComentarios, fixtures });
falhas = Math.max(falhas, falhasDatasets);

console.log(falhas === 0 ? '\n✅ SMOKE EXPORTACOES: OK' : `\n❌ SMOKE EXPORTACOES: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
