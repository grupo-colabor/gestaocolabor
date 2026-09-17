/**
 * SMOKE — BM da Vale: blocos [Σ] dataset, [X] escritor, [Z] zip.
 * Chamado por smokeMedicaoValeBm.ts.
 */
import { buildValeFixtureSource, demandaVale, medicao } from './smokeMedicaoValeDatasets';
import { buildMedicaoValeRows, toRowsSheetInput, type MedicaoValeRow } from '../domain/exports/datasets/medicaoVale';
import {
  buildBm,
  bmRegionRows,
  bmFileName,
  bmZipName,
  bmZipEntryName,
  periodoLabel,
  normalizeTrainingName,
  slug,
  turmasNumeros,
} from '../domain/exports/datasets/medicaoValeBm';
import { VALE_BM_TEMPLATE, VALE_BM_CONSTANTS } from '../domain/exports/templates/vale-bm';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import { resolveRowsSheet } from '../domain/exports/templates/resolve';
import { indexTemplateValues, contextKey, type TemplateValuesIndex } from '../domain/exports/templates/values';

export interface BmSmokeTools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
  perto: (nome: string, atual: number, esperado: number) => void;
}

/**
 * Fixtures do BM: as da Medição Vale mais
 *   • DEM-110 em Brucutu, mesmo treinamento e preço de DEM-100 → agrega;
 *   • DEM-111 em Timbopeba com treinamento de NOME igual e id diferente (T_PRE2),
 *     mesmo preço → agrega por nome, e o cadastro duplicado vira aviso;
 *   • DEM-112 em Brucutu com preço sobrescrito → linha separada;
 *   • DEM-113 sem local → fora, contado;
 *   • DEM-114 no corredor Ferrovia/MG, mina Vitória → só entra com corredor
 *     "Todos" (segunda pasta do zip, terceira mina);
 *   • DEM-115 sem corredor na demanda → com "Todos", fora e contada;
 * e o cabeçalho cadastrado só para Sudeste|Brucutu.
 *
 * `recorte` = corredor Sudeste + agosto (o filtro de hoje); `recorteTodos` =
 * agosto com corredor "Todos" (dois corredores, três minas).
 */
export function buildBmFixture() {
  const base = buildValeFixtureSource();
  const TRAININGS = [
    ...base.trainings,
    { id: 'T_PRE2', name: 'NR 35 Trabalho em Altura', hours: 8, practicalHours: null, modality: 'PRESENCIAL' },
  ];
  const demands = [
    ...base.demands,
    demandaVale({ id: 'DEM-110', trainingLocal: 'Brucutu', startDate: '2026-08-12T08:00', endDate: '2026-08-13T17:00' }),
    demandaVale({ id: 'DEM-111', trainingId: 'T_PRE2', trainingLocal: 'Timbopeba', startDate: '2026-08-14T08:00', endDate: '2026-08-14T17:00' }),
    demandaVale({ id: 'DEM-112', trainingLocal: 'Brucutu', startDate: '2026-08-15T08:00', endDate: '2026-08-16T17:00' }),
    demandaVale({ id: 'DEM-113', trainingLocal: '', startDate: '2026-08-17T08:00', endDate: '2026-08-18T17:00' }),
    demandaVale({ id: 'DEM-114', corredor: 'Ferrovia/MG', trainingLocal: 'Vitória', startDate: '2026-08-19T08:00', endDate: '2026-08-20T17:00' }),
    demandaVale({ id: 'DEM-115', corredor: '', trainingLocal: 'Itabira', startDate: '2026-08-24T08:00', endDate: '2026-08-25T17:00' }),
  ];
  const measurements = [
    ...base.measurements,
    medicao('DEM-110', { attachments: [{ id: 'x1', category: 'LOCOMOCAO', value: 100 }] }),
    medicao('DEM-111', { attachments: [{ id: 'x2', category: 'HOSPEDAGEM', value: 300 }, { id: 'x3', category: 'CAFE', value: 20, reembolsavel: false }] }),
    medicao('DEM-112'),
    medicao('DEM-114', { attachments: [{ id: 'x4', category: 'ALMOCO', value: 60 }, { id: 'x5', category: 'LOCOMOCAO', value: 140 }] }),
    medicao('DEM-115', { attachments: [{ id: 'x6', category: 'HOSPEDAGEM', value: 250 }] }),
  ];
  const instructorAllocations = [
    ...base.instructorAllocations,
    { id: 'B1', demandId: 'DEM-110', instructorId: 'INS-T', startDate: '2026-08-12T08:00', endDate: '2026-08-13T17:00' },
    { id: 'B2', demandId: 'DEM-111', instructorId: 'INS-T', startDate: '2026-08-14T08:00', endDate: '2026-08-14T17:00' },
    { id: 'B3', demandId: 'DEM-112', instructorId: 'INS-2', startDate: '2026-08-15T08:00', endDate: '2026-08-16T17:00' },
    { id: 'B4', demandId: 'DEM-113', instructorId: 'INS-T', startDate: '2026-08-17T08:00', endDate: '2026-08-18T17:00' },
    { id: 'B5', demandId: 'DEM-114', instructorId: 'INS-2', startDate: '2026-08-19T08:00', endDate: '2026-08-20T17:00' },
    { id: 'B6', demandId: 'DEM-115', instructorId: 'INS-T', startDate: '2026-08-24T08:00', endDate: '2026-08-25T17:00' },
  ];
  const brucutu = contextKey('Sudeste', 'Brucutu');
  const templateValues = indexTemplateValues([
    { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE', demand_id: null, value: 120 },
    { scope: 'training', column_key: 'precoHH', training_id: 'T_PRE2', demand_id: null, value: 120 },
    { scope: 'demand', column_key: 'precoHH', training_id: null, demand_id: 'DEM-101', value: 150 },
    { scope: 'demand', column_key: 'precoHH', training_id: null, demand_id: 'DEM-112', value: 130 },
    { scope: 'demand', column_key: 'combustivel', training_id: null, demand_id: 'DEM-100', value: 45 },
    { scope: 'demand', column_key: 'pctDespesa', training_id: null, demand_id: 'DEM-110', value: 0.1 },
    { scope: 'context', column_key: 'gerenciaExecutiva', training_id: null, demand_id: null, context_key: brucutu, value: 'Gerência Executiva de Operações' },
    { scope: 'context', column_key: 'gerencia', training_id: null, demand_id: null, context_key: brucutu, value: 'Gerência de Segurança' },
    { scope: 'context', column_key: 'contrato', training_id: null, demand_id: null, context_key: brucutu, value: '5900123435' },
    { scope: 'context', column_key: 'contratada', training_id: null, demand_id: null, context_key: brucutu, value: 'Colabor Consultoria e Treinamento LTDA' },
    { scope: 'context', column_key: 'objeto', training_id: null, demand_id: null, context_key: brucutu, value: 'Treinamentos Presenciais Corredor Sudeste' },
    { scope: 'context', column_key: 'gestor', training_id: null, demand_id: null, context_key: brucutu, value: 'Soraya Martins' },
    { scope: 'context', column_key: 'local', training_id: null, demand_id: null, context_key: brucutu, value: 'Mina de Brucutu' },
  ]);
  const src = { ...base, trainings: TRAININGS, demands, measurements, instructorAllocations, templateValues };
  const rows = buildMedicaoValeRows(src);
  // Recorte da tela: corredor Sudeste, agosto (data de início), tudo o mais aberto.
  const agosto = (r: MedicaoValeRow) => r.input.dataInicio >= '2026-08-01' && r.input.dataInicio <= '2026-08-31';
  const recorte = rows.filter(r => r.demand.corredor === 'Sudeste' && agosto(r));
  // O mesmo período com corredor "Todos" (o filtro de corredor não age).
  const recorteTodos = rows.filter(agosto);
  return { src, rows, recorte, recorteTodos, brucutu };
}

/**
 * Σ (I + P) da Medição Vale para as turmas elegíveis de `rows`, lida da
 * resolução da aba Turmas do vale-v1 (a mesma que vira XLSX) — independente
 * do dataset do BM. Devolve também a parcela das turmas que o BM deixa fora
 * (sem local ou, com "Todos", sem corredor).
 */
export function sigmaMedicaoVale(rows: MedicaoValeRow[], values: TemplateValuesIndex) {
  const sheet = VALE_TEMPLATE.sheets[0];
  const resolved = resolveRowsSheet(sheet, toRowsSheetInput(rows), values);
  const idx = (key: string) => resolved.columns.findIndex(c => c.key === key);
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
  const elegiveis = rows.filter(r => r.elegivelTurmas);
  let noBm = 0;
  let foraDoBm = 0;
  resolved.rows.forEach((cells, i) => {
    const r = elegiveis[i];
    const I = n(cells[idx('cargaHoraria')].value) * n(cells[idx('precoHH')].value);
    const despesas = ['locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros'].reduce((acc, k) => acc + n(cells[idx(k)].value), 0);
    const P = despesas + despesas * n(cells[idx('pctDespesa')].value);
    if (r.input.local.trim() && String(r.input.corredor ?? '').trim()) noBm += I + P;
    else foraDoBm += I + P;
  });
  const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
  return { noBm: r2(noBm), foraDoBm: r2(foraDoBm), turmas: elegiveis.length };
}

export async function runBmChecks(t: BmSmokeTools): Promise<number> {
  let falhas = 0;
  const check: BmSmokeTools['check'] = (n, c, d) => { if (!c) falhas++; t.check(n, c, d); };
  const eq: BmSmokeTools['eq'] = (n, a, b) => { if (!(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b))) falhas++; t.eq(n, a, b); };
  const perto: BmSmokeTools['perto'] = (n, a, b) => { if (!(Math.abs(a - b) < 1e-6)) falhas++; t.perto(n, a, b); }; // NaN-safe

  const { src, recorte, recorteTodos, brucutu } = buildBmFixture();

  /* ──────────────────────────────────────────────────────────────────────
   * [Σ] Dataset BM
   * ──────────────────────────────────────────────────────────────────── */
  console.log('\n[Σ] Dataset BM — agregação e Σ com a aba Turmas');
  {
    const numeros = turmasNumeros(recorte, src.templateValues);
    const elegiveis = recorte.filter(r => r.elegivelTurmas);
    eq('numeros: um por turma elegível, na ordem', numeros.map(n => n.demandId), elegiveis.map(r => r.demand.id));

    const bm = buildBm(recorte, src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
    eq('um BM por mina, em ordem', bm.minas.map(m => m.mina), ['Brucutu', 'Timbopeba']);
    eq('turma sem local fora, contada', bm.semLocal.map(r => r.demand.id), ['DEM-113']);
    check('sem local não aparece em mina nenhuma', !bm.minas.some(m => m.turmas.some(r => r.demand.id === 'DEM-113')));
    eq('cadastro duplicado (mesmo nome, ids T_PRE e T_PRE2) vira aviso', bm.nomesDuplicados, [{ nome: normalizeTrainingName('NR 35 Trabalho em Altura'), trainingIds: ['T_PRE', 'T_PRE2'] }]);

    const bru = bm.minas[0];
    eq('Brucutu: turmas (inclusive a híbrida DEM-102, em ordem de data)', bru.turmas.map(r => r.demand.id), ['DEM-100', 'DEM-110', 'DEM-112', 'DEM-102']);
    const treinos = bru.linhas.filter(l => l.tipo === 'treinamento');
    eq('Brucutu: NR 35 a 120 agrega DEM-100 + DEM-110 (16h + 16h)', treinos.find(l => l.preco === 120)?.quantidade, 32);
    eq('Brucutu: DEM-112 com preço sobrescrito 130 é linha separada, 16h', treinos.find(l => l.preco === 130)?.quantidade, 16);
    eq('Brucutu: linhas em ordem alfabética, com o prefixo do modelo', treinos.map(l => l.descricao), [
      'Aplicação de Treinamento - NR 20 Intermediário',
      'Aplicação de Treinamento - NR 35 Trabalho em Altura',
      'Aplicação de Treinamento - NR 35 Trabalho em Altura',
    ]);
    eq('Brucutu: unidade com o espaço do arquivo', treinos[0].unidade, 'Hora/Aula ');
    eq('Brucutu: QQP 20 default', treinos[0].qqp, '20');
    const desp = bru.linhas[bru.linhas.length - 1];
    eq('última linha = despesas, QQP 70, unidade 1, preço 1', [desp.tipo, desp.qqp, desp.unidade, desp.preco], ['despesas', '70', 1, 1]);
    check('cabeçalho de Brucutu completo', bru.cabecalhoIncompleto.length === 0);
    check('contexto lido pela chave', bru.contexto?.get('contrato') === '5900123435' && bru.contextKey === brucutu);

    const tim = bm.minas[1];
    eq('Timbopeba: turmas', tim.turmas.map(r => r.demand.id), ['DEM-101', 'DEM-111']);
    eq('Timbopeba: DEM-101 (150) e DEM-111 (120, id T_PRE2) em linhas separadas por preço', tim.linhas.filter(l => l.tipo === 'treinamento').map(l => `${l.preco}:${l.quantidade}`), ['120:8', '150:16']);
    eq('Timbopeba: cabeçalho incompleto (sem cadastro) lista os 7 campos sem default', tim.cabecalhoIncompleto.length, 7);
    check('Timbopeba: QQP continua com default sem cadastro', tim.linhas[0].qqp === '20' && tim.linhas[tim.linhas.length - 1].qqp === '70');

    // Σ linhas 20 = Σ coluna I das turmas da mina; quantidade 70 = Σ P.
    for (const m of bm.minas) {
      const ns = m.turmas.map(r => numeros.find(n => n.demandId === r.demand.id)!);
      const sigmaI = ns.reduce((acc, n) => acc + (n.preco ?? 0) * n.cargaHoraria, 0);
      const sigmaP = ns.reduce((acc, n) => acc + n.p, 0);
      const linhas20 = m.linhas.filter(l => l.tipo === 'treinamento').reduce((acc, l) => acc + (l.preco ?? 0) * l.quantidade, 0);
      perto(`${m.mina}: Σ preço×quantidade das linhas 20 = Σ coluna I das turmas`, linhas20, sigmaI);
      perto(`${m.mina}: quantidade da linha 70 = Σ coluna P`, m.linhas[m.linhas.length - 1].quantidade, sigmaP);
      perto(`${m.mina}: totalTreinamentos coerente`, m.totalTreinamentos, Math.round((sigmaI + Number.EPSILON) * 100) / 100);
    }
    // P respeita o % de cada turma (DEM-110 com 10%): 100 × 1,1 = 110; DEM-100: (80+45+50+200+25) × 1,2 = 480.
    const n110 = numeros.find(n => n.demandId === 'DEM-110')!;
    const n100 = numeros.find(n => n.demandId === 'DEM-100')!;
    perto('P de DEM-110 com 10% = 110', n110.p, 110);
    perto('P de DEM-100 com 20% e combustível 45 = 480', n100.p, 480);
    perto('quantidade 70 de Brucutu = 480 + 110 + 0', bm.minas[0].totalDespesas, 590);

    // Constante despesasComAcrescimo: false → só J..N.
    const semAcr = buildBm(recorte, src.templateValues, { ...VALE_BM_TEMPLATE, constants: { ...VALE_BM_CONSTANTS, despesasComAcrescimo: false } }, { corredor: 'Sudeste' });
    perto('despesasComAcrescimo=false: quantidade 70 de Brucutu = 400 + 100', semAcr.minas[0].totalDespesas, 500);

    // Filtro de mina.
    const soBru = buildBm(recorte, src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste', mina: 'Brucutu' });
    eq('com mina: uma só', soBru.minas.map(m => m.mina), ['Brucutu']);

    // Preço vazio: híbrida DEM-102 (T_HIB sem preço) na mina Brucutu.
    const hib = bm.minas[0].linhas.find(l => l.trainingIds.includes('T_HIB'));
    eq('turma sem preço: linha com preço em branco e horas somadas', hib ? [hib.preco, hib.quantidade] : 'sem linha', [null, 40]);

    // Linhas da região e nomes de arquivo.
    eq('bmRegionRows: campos da região', Object.keys(bmRegionRows(bru)[0]), ['qqp', 'descricao', 'unidade', 'preco', 'quantidade']);
    eq('periodoLabel', periodoLabel('2026-08-01', '2026-08-31'), '01/08/2026 a 31/08/2026');
    eq('periodoLabel vazio', periodoLabel('', ''), '');
    eq('slug', slug('Ferrovia/MG — Mina de Brucutu'), 'ferrovia-mg-mina-de-brucutu');
    eq('nome do xlsx', bmFileName(VALE_BM_TEMPLATE, 'Sudeste', 'Brucutu', '2026-08-01', '2026-08-31'), 'vale-bm-sudeste-brucutu-2026-08-01_2026-08-31.xlsx');
    eq('nome do zip', bmZipName(VALE_BM_TEMPLATE, 'Ferrovia/MG', '2026-08-01', '2026-08-31'), 'vale-bm-ferrovia-mg-2026-08-01_2026-08-31.zip');
    eq('com corredor: resultado traz corredores = [o do filtro] e semCorredor vazio', [bm.corredor, bm.corredores, bm.semCorredor.length], ['Sudeste', ['Sudeste'], 0]);
  }

  /* ──────────────────────────────────────────────────────────────────────
   * [T] Corredor "Todos"
   * ──────────────────────────────────────────────────────────────────── */
  console.log('\n[T] Corredor "Todos" — um BM por (corredor, mina)');
  {
    const soSudeste = buildBm(recorte, src.templateValues, VALE_BM_TEMPLATE, { corredor: 'Sudeste' });
    const todos = buildBm(recorteTodos, src.templateValues, VALE_BM_TEMPLATE, {});
    const [di, df] = ['2026-08-01', '2026-08-31'];

    eq('recorte "Todos" tem mais turmas que o do Sudeste (DEM-114 e DEM-115 entram)', recorteTodos.length - recorte.length, 2);
    eq('corredor vazio no resultado; corredores em ordem pt-BR', [todos.corredor, todos.corredores], ['', ['Ferrovia/MG', 'Sudeste']]);
    eq('um BM por (corredor, mina): dois corredores, três minas, corredor antes de mina', todos.minas.map(m => `${m.corredor}|${m.mina}`), ['Ferrovia/MG|Vitória', 'Sudeste|Brucutu', 'Sudeste|Timbopeba']);
    eq('turma sem corredor fica fora, contada', todos.semCorredor.map(r => r.demand.id), ['DEM-115']);
    check('sem corredor não aparece em mina nenhuma', !todos.minas.some(m => m.turmas.some(r => r.demand.id === 'DEM-115')));
    eq('turma sem local continua fora', todos.semLocal.map(r => r.demand.id), ['DEM-113']);
    eq('contexto (cabeçalho) continua por corredor|mina', todos.minas.map(m => m.contextKey), [contextKey('Ferrovia/MG', 'Vitória'), brucutu, contextKey('Sudeste', 'Timbopeba')]);
    eq('as minas do Sudeste em "Todos" são idênticas ao BM só do Sudeste (turmas, linhas, totais)',
      todos.minas.filter(m => m.corredor === 'Sudeste').map(m => [m.mina, m.turmas.map(r => r.demand.id), m.linhas, m.totalTreinamentos, m.totalDespesas]),
      soSudeste.minas.map(m => [m.mina, m.turmas.map(r => r.demand.id), m.linhas, m.totalTreinamentos, m.totalDespesas]));
    // 16h × 120 = 1920; despesas (60 + 140) × 1,2 (% padrão) = 240.
    eq('Vitória: só DEM-114, com o preço do cadastro e as despesas reembolsáveis', [todos.minas[0].turmas.map(r => r.demand.id), todos.minas[0].totalTreinamentos, todos.minas[0].totalDespesas], [['DEM-114'], 1920, 240]);
    eq('cabeçalho incompleto lista TODAS as minas sem cadastro, de todos os corredores', todos.minas.filter(m => m.cabecalhoIncompleto.length > 0).map(m => `${m.corredor} | ${m.mina}`), ['Ferrovia/MG | Vitória', 'Sudeste | Timbopeba']);

    // Σ dos totais dos BMs = Σ (I + P) da Medição Vale do mesmo recorte (turmas com local e corredor).
    const sigma = sigmaMedicaoVale(recorteTodos, src.templateValues);
    const sigmaBm = todos.minas.reduce((acc, m) => acc + m.totalTreinamentos + m.totalDespesas, 0);
    perto('Σ dos totais dos BMs = Σ (I + P) da Medição Vale do recorte "Todos"', Math.round((sigmaBm + Number.EPSILON) * 100) / 100, sigma.noBm);
    check('o que fica fora do BM (sem local / sem corredor) é exatamente DEM-113 + DEM-115, e não é zero', sigma.foraDoBm > 0 && sigma.turmas === todos.minas.reduce((a, m) => a + m.turmas.length, 0) + todos.semLocal.length + todos.semCorredor.length);
    // O mesmo fecha para o recorte de um corredor só.
    const sigmaSud = sigmaMedicaoVale(recorte, src.templateValues);
    perto('Σ dos totais dos BMs do Sudeste = Σ (I + P) da Medição Vale do recorte Sudeste', Math.round((soSudeste.minas.reduce((acc, m) => acc + m.totalTreinamentos + m.totalDespesas, 0) + Number.EPSILON) * 100) / 100, sigmaSud.noBm);

    // Todos + mina: a mesma mina pode existir em mais de um corredor — o BM filtra a mina e mantém o corredor de cada uma.
    const soVitoria = buildBm(recorteTodos, src.templateValues, VALE_BM_TEMPLATE, { mina: 'Vitória' });
    eq('"Todos" + mina Vitória: uma mina, no corredor da demanda', soVitoria.minas.map(m => `${m.corredor}|${m.mina}`), ['Ferrovia/MG|Vitória']);

    // Nomes: zip "todos", pasta por corredor (slug) com o MESMO nome de arquivo de hoje dentro.
    eq('nome do zip com "Todos"', bmZipName(VALE_BM_TEMPLATE, '', di, df), 'vale-bm-todos-2026-08-01_2026-08-31.zip');
    eq('entrada com pasta por corredor', bmZipEntryName(VALE_BM_TEMPLATE, todos.minas[0], di, df, true), 'ferrovia-mg/vale-bm-ferrovia-mg-vitoria-2026-08-01_2026-08-31.xlsx');
    eq('entrada sem pasta = nome de sempre', bmZipEntryName(VALE_BM_TEMPLATE, todos.minas[1], di, df, false), bmFileName(VALE_BM_TEMPLATE, 'Sudeste', 'Brucutu', di, df));
    eq('corredor vazio explícito = "Todos"', buildBm(recorteTodos, src.templateValues, VALE_BM_TEMPLATE, { corredor: '' }).minas.length, 3);
  }

  // Sequenciado: `falhas += await f()` leria `falhas` antes da chamada e
  // perderia os incrementos do `check` local feitos dentro de f.
  const nw = await runBmWriterChecks({ check, eq, perto }, { src, recorte });
  falhas += nw;
  const nz = await runBmZipChecks({ check, eq, perto }, { src, recorte, recorteTodos });
  falhas += nz;
  return falhas;
}

import { runBmWriterChecks } from './smokeMedicaoValeBmWriter';
import { runBmZipChecks } from './smokeMedicaoValeBmZip';
