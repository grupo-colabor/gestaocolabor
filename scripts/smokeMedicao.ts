/**
 * SMOKE TEST — Exportação de Medição de Instrutores
 *
 * Rodar com:  npm run smoke:medicao
 *
 * O projeto não tem runner de teste; este script é standalone (esbuild + node)
 * e cobre o que quebra em silêncio: o recorte de dias por período, a regra de
 * horas práticas em híbridos, e as fórmulas/proteção do workbook gerado.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import { computeInstructorHours, computeInstructorHoursByDemand } from '../domain/instructorHours';
// Importa a camada PURA (sem Supabase), para o script rodar em Node sem env.
import {
  buildMedicaoWorkbook,
  countDaysInclusive,
  resolvePeriodo,
} from '../services/medicaoWorkbook';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

function checkEq(nome: string, atual: unknown, esperado: unknown) {
  check(nome, Object.is(atual, esperado) || atual === esperado, `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

/* ========================================================================== */
/* 1. Recorte de dias por período                                             */
/* ========================================================================== */

const trainings: any[] = [
  { id: 'T_HIB', name: 'NR 20 Intermediário', hours: 12, practicalHours: 4, modality: 'HIBRIDO' },
  { id: 'T_PRE', name: 'NR 35', hours: 16, practicalHours: null, modality: 'PRESENCIAL' },
  { id: 'T_CIC', name: 'NR 33', hours: 10, practicalHours: null, modality: 'PRESENCIAL' },
];

const semRecorte = { measurements: [] as any[], trainings };

function horasDe(demands: any[], allocations: any[], instructorId: string, periodStart?: string, periodEnd?: string) {
  const map = computeInstructorHours({
    ...semRecorte,
    demands,
    instructorAllocations: allocations,
    periodStart,
    periodEnd,
  } as any);
  return Math.round(((map.get(instructorId)?.horas ?? 0) + Number.EPSILON) * 100) / 100;
}

console.log('\n[1] Recorte de dias por período');

// Ciclo de medição 26/06–25/07 com demanda 24/06–28/06: começou ANTES da borda
// de início, então só os dias 26, 27 e 28 contam — 3 de 5.
{
  const demands = [{ id: 'D_CIC', trainingId: 'T_CIC', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-06-24', endDate: '2026-06-28', status: 'CONCLUIDA' }];
  const allocs = [{ id: 'a', demandId: 'D_CIC', instructorId: 'A', startDate: '2026-06-24', endDate: '2026-06-28' }];

  const linhas = computeInstructorHoursByDemand({ ...semRecorte, demands, instructorAllocations: allocs, periodStart: '2026-06-26', periodEnd: '2026-07-25' } as any);
  checkEq('ciclo 26/06–25/07: dias contados na demanda 24/06–28/06', linhas[0]?.dias.length, 3);
  checkEq('ciclo: dias exatos', linhas[0]?.dias.join(','), '2026-06-26,2026-06-27,2026-06-28');
  checkEq('ciclo: horas = 3/5 × 10h', horasDe(demands, allocs, 'A', '2026-06-26', '2026-07-25'), 6);
  checkEq('sem recorte: horas cheias', horasDe(demands, allocs, 'A'), 10);
}

// Simetria: a mesma demanda recortada pela borda de FIM devolve os outros 2 dias.
{
  const demands = [{ id: 'D_CIC', trainingId: 'T_CIC', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-06-24', endDate: '2026-06-28', status: 'CONCLUIDA' }];
  const allocs = [{ id: 'a', demandId: 'D_CIC', instructorId: 'A', startDate: '2026-06-24', endDate: '2026-06-28' }];
  checkEq('ciclo anterior (…–25/06): horas = 2/5 × 10h', horasDe(demands, allocs, 'A', '2026-05-26', '2026-06-25'), 4);
}

// Bordas inclusivas nas duas pontas: período de 1 dia sobre o dia exato conta 1.
{
  const demands = [{ id: 'D_1D', trainingId: 'T_CIC', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-06-26', endDate: '2026-06-26', status: 'CONCLUIDA' }];
  const allocs = [{ id: 'a', demandId: 'D_1D', instructorId: 'A', startDate: '2026-06-26', endDate: '2026-06-26' }];
  checkEq('borda inicial inclusiva', horasDe(demands, allocs, 'A', '2026-06-26', '2026-06-30'), 10);
  checkEq('borda final inclusiva', horasDe(demands, allocs, 'A', '2026-06-20', '2026-06-26'), 10);
}

/* ========================================================================== */
/* 2. Regras de horas preservadas                                             */
/* ========================================================================== */

console.log('\n[2] Regras de horas (híbrido e split)');

// Caso DEM-359: híbrido com 5 dias cadastrados e só 1 dia alocado -> practicalHours.
{
  const demands = [{ id: 'D_HIB', trainingId: 'T_HIB', modality: 'HIBRIDO', dateMode: 'CONTINUO', startDate: '2026-03-02', endDate: '2026-03-06', status: 'CONCLUIDA' }];
  const allocs = [{ id: 'a', demandId: 'D_HIB', instructorId: 'A', startDate: '2026-03-06', endDate: '2026-03-06' }];
  checkEq('híbrido usa practical_hours (4h), não 1/5 da carga nominal', horasDe(demands, allocs, 'A', '2026-03-01', '2026-03-31'), 4);
}

// Demanda dividida entre dois instrutores: metade dos dias, metade das horas.
{
  const demands = [{ id: 'D_SPL', trainingId: 'T_PRE', modality: 'PRESENCIAL', dateMode: 'CONTINUO', startDate: '2026-03-09', endDate: '2026-03-12', status: 'CONCLUIDA' }];
  const allocs = [
    { id: 'a', demandId: 'D_SPL', instructorId: 'A', startDate: '2026-03-09', endDate: '2026-03-10' },
    { id: 'b', demandId: 'D_SPL', instructorId: 'B', startDate: '2026-03-11', endDate: '2026-03-12' },
  ];
  checkEq('split: instrutor A fica com 8h de 16h', horasDe(demands, allocs, 'A', '2026-03-01', '2026-03-31'), 8);
  checkEq('split: instrutor B fica com 8h de 16h', horasDe(demands, allocs, 'B', '2026-03-01', '2026-03-31'), 8);

  const map = computeInstructorHours({ ...semRecorte, demands, instructorAllocations: allocs, periodStart: '2026-03-01', periodEnd: '2026-03-31' } as any);
  checkEq('split marcado como dividido', map.get('A')?.nDivididas, 1);
}

/* ========================================================================== */
/* 3. Resolução de período (nome de arquivo e rótulo)                         */
/* ========================================================================== */

console.log('\n[3] Resolução de período');

{
  const mes = resolvePeriodo({ modo: 'MES', year: 2026, month: 3 });
  checkEq('mês: dataInicio', mes.dataInicio, '2026-03-01');
  checkEq('mês: dataFim', mes.dataFim, '2026-03-31');
  checkEq('mês: nome do arquivo', mes.fileName, 'Medicao_Instrutores_03-2026.xlsx');

  const fev = resolvePeriodo({ modo: 'MES', year: 2024, month: 2 });
  checkEq('mês bissexto: dataFim', fev.dataFim, '2024-02-29');

  const custom = resolvePeriodo({ modo: 'PERSONALIZADO', dataInicio: '2026-06-26', dataFim: '2026-07-25' });
  checkEq('personalizado: rótulo', custom.label, '26/06/2026 a 25/07/2026');
  checkEq('personalizado: nome do arquivo', custom.fileName, 'Medicao_Instrutores_26-06-2026_a_25-07-2026.xlsx');

  let lancou = false;
  try { resolvePeriodo({ modo: 'PERSONALIZADO', dataInicio: '2026-07-25', dataFim: '2026-06-26' }); } catch { lancou = true; }
  check('personalizado: fim < início lança erro', lancou);

  checkEq('countDaysInclusive 26/06–25/07', countDaysInclusive('2026-06-26', '2026-07-25'), 30);
  checkEq('countDaysInclusive mesmo dia', countDaysInclusive('2026-06-26', '2026-06-26'), 1);
}


/* ========================================================================== */
/* 4. Workbook: layout de colunas, fórmulas de tarifa por empresa, proteção   */
/* ========================================================================== */

console.log('\n[4] Workbook gerado');

(async () => {
  const periodo = resolvePeriodo({ modo: 'PERSONALIZADO', dataInicio: '2026-06-26', dataFim: '2026-07-25' });

  // Ana atende DUAS empresas no mesmo período, com tarifas diferentes.
  // Bruno atende uma empresa que ficará SEM tarifa preenchida.
  const blocks = [
    {
      instructorId: 'i1', nome: 'Ana Maria', cpf: '123.456.789-09',
      linhas: [
        { demandId: 'DEM-100', empresa: 'Vale', trainingName: 'NR 33', dias: ['2026-06-26', '2026-06-27', '2026-06-28'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 6, categoria: '', tipo: 'Treinamento' as const, noturno: false },
        { demandId: 'DEM-101', empresa: 'ArcelorMittal', trainingName: 'NR 35', dias: ['2026-07-02'], local: 'Serra - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false },
        { demandId: 'DEM-102', empresa: 'Vale', trainingName: 'NR 20', dias: ['2026-07-10'], local: 'Vitória - ES', modalidade: 'Híbrido', horas: 4, categoria: '', tipo: 'Treinamento' as const, noturno: false },
      ],
    },
    {
      instructorId: 'i2', nome: 'Bruno Souza', cpf: '',
      linhas: [
        { demandId: 'DEM-103', empresa: 'Samarco', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'Anchieta - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false },
      ],
    },
  ];

  const wb = await buildMedicaoWorkbook(blocks as any, periodo);

  // Round-trip pelo arquivo: só vale o que sobreviveu à serialização.
  const buffer = await wb.xlsx.writeBuffer();
  const ExcelJSModule: any = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const lido = new ExcelJS.Workbook();
  await lido.xlsx.load(buffer);

  const formula = (ws: any, addr: string) => {
    const v = ws.getCell(addr).value;
    return v && typeof v === 'object' && 'formula' in v ? (v as any).formula : null;
  };
  const texto = (ws: any, addr: string) => String(ws.getCell(addr).value ?? '');

  /* ---- ordem das abas ---- */
  checkEq('abas na ordem Resumo, Tarifas, instrutores...', lido.worksheets.map((w: any) => w.name).join(' | '), 'Resumo | Tarifas | Ana Maria | Bruno Souza');

  /* ---- aba Tarifas ---- */
  const tarifas = lido.getWorksheet('Tarifas');
  checkEq(
    'Tarifas: cabeçalho com Tipo e Noturno',
    ['A1', 'B1', 'C1', 'D1', 'E1'].map(a => texto(tarifas, a)).join(' | '),
    'Instrutor | Empresa | Tipo | Noturno | Hora/Aula (R$)'
  );
  checkEq('Tarifas: uma linha por combinação', tarifas.actualRowCount, 4); // 1 cabeçalho + 3 combinações
  checkEq('Tarifas: combinação 1', `${texto(tarifas, 'A2')}/${texto(tarifas, 'B2')}`, 'Ana Maria/ArcelorMittal');
  checkEq('Tarifas: combinação 2 (mesma instrutora, outra empresa)', `${texto(tarifas, 'A3')}/${texto(tarifas, 'B3')}`, 'Ana Maria/Vale');
  checkEq('Tarifas: combinação 3', `${texto(tarifas, 'A4')}/${texto(tarifas, 'B4')}`, 'Bruno Souza/Samarco');
  checkEq('Tarifas: duas demandas da mesma empresa/tipo/turno não duplicam a linha', tarifas.actualRowCount - 1, 3);
  checkEq('Tarifas: tipo preenchido', texto(tarifas, 'C2'), 'Treinamento');
  // Rótulo literal, nunca vazio: célula vazia dos dois lados do SUMIFS
  // zerava a linha diurna em silêncio (ver bloco [8]).
  checkEq('Tarifas: diurno marca Noturno como Não', texto(tarifas, 'D2'), 'Não');
  check('Tarifas: coluna E (valor) destravada', tarifas.getCell('E2').protection?.locked === false);
  check('Tarifas: coluna A travada', tarifas.getCell('A2').protection?.locked !== false);
  check('Tarifas: coluna C (chave) travada', tarifas.getCell('C2').protection?.locked !== false);
  check('Tarifas: coluna D (chave) travada', tarifas.getCell('D2').protection?.locked !== false);
  {
    const nota = tarifas.getCell('E1').note;
    const txt = typeof nota === 'string' ? nota : (nota?.texts || []).map((t: any) => t.text).join('');
    check('Tarifas: nota "PREENCHA AQUI" no cabeçalho da tarifa', txt.startsWith('PREENCHA AQUI'));
    check('Resumo: nota "PREENCHA AQUI" saiu do Resumo', !lido.getWorksheet('Resumo').getCell('B2').note);
  }

  /* ---- aba de detalhe: layout novo ---- */
  const ana = lido.getWorksheet('Ana Maria');
  checkEq(
    'Detalhe: cabeçalho com Empresa em B',
    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'].map(a => texto(ana, a)).join(' | '),
    'Código | Empresa | Treinamento | Data | Local | Modalidade | Horas | Valor (R$) — automático'
  );
  checkEq('Detalhe: empresa da linha 2', texto(ana, 'B2'), 'Vale');
  checkEq('Detalhe: treinamento empurrado para C', texto(ana, 'C2'), 'NR 33');
  checkEq('Detalhe: horas agora em G', ana.getCell('G2').value, 6);
  checkEq('Detalhe: horas com formato de horas', ana.getCell('G2').numFmt, '0.0');

  /* ---- coluna Categoria: acrescentada no FIM, sem mover B/G/H ---- */
  checkEq('Detalhe: Tipo/Categoria/Noturno são I/J/K', ['I1', 'J1', 'K1'].map(a => texto(ana, a)).join(' | '), 'Tipo | Categoria | Noturno');
  checkEq('Detalhe: tipo da demanda de cliente', texto(ana, 'I2'), 'Treinamento');
  checkEq('Detalhe: demanda de cliente não tem categoria', texto(ana, 'J2'), '');
  // Diurno tem que ser rótulo LITERAL: em branco, o SUMIFS da tarifa zerava
  // (critério vindo de célula vazia vira 0 e não casa com texto vazio).
  checkEq('Detalhe: diurno marca Noturno como Não', texto(ana, 'K2'), 'Não');

  /* ---- fórmula de valor: tarifa cruzada por empresa da própria linha ---- */
  checkEq(
    'Detalhe: valor busca tarifa por (instrutor, empresa da linha)',
    formula(ana, 'H2'),
    'G2*SUMIFS(Tarifas!$E:$E,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B2,Tarifas!$C:$C,I2,Tarifas!$D:$D,K2)'
  );
  checkEq(
    'Detalhe: linha de outra empresa referencia a própria coluna B',
    formula(ana, 'H3'),
    'G3*SUMIFS(Tarifas!$E:$E,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B3,Tarifas!$C:$C,I3,Tarifas!$D:$D,K3)'
  );
  check('Detalhe: fórmula usa vírgula (separador do XML, não do Excel PT-BR)', !String(formula(ana, 'H2')).includes(';'));
  checkEq('Detalhe: total de horas em G', formula(ana, 'G5'), 'SUM(G2:G4)');
  checkEq('Detalhe: total de valor em H', formula(ana, 'H5'), 'SUM(H2:H4)');

  /* ---- Resumo: sem Hora/Aula, com pendências ---- */
  const resumo = lido.getWorksheet('Resumo');
  checkEq('Resumo: título traz o período', texto(resumo, 'A1'), 'MEDIÇÃO DE INSTRUTORES — 26/06/2026 a 25/07/2026');
  checkEq(
    'Resumo: cabeçalho sem Hora/Aula e com Tarifas pendentes',
    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2'].map(a => texto(resumo, a)).join(' | '),
    'Instrutor | Total de Horas — automático | Total (R$) — automático | Tarifas pendentes — automático | CPF/CNPJ | Dados Bancários'
  );
  checkEq('Resumo: horas somam a coluna G da aba do instrutor', formula(resumo, 'B3'), "SUM('Ana Maria'!G2:G4)");
  checkEq('Resumo: total soma a coluna Valor da aba (não horas × tarifa)', formula(resumo, 'C3'), "SUM('Ana Maria'!H2:H4)");
  checkEq('Resumo: pendências contam tarifas em branco do instrutor', formula(resumo, 'D3'), 'COUNTIFS(Tarifas!$A:$A,"Ana Maria",Tarifas!$E:$E,"")');
  checkEq('Resumo: TOTAL GERAL de valores', formula(resumo, 'C5'), 'SUM(C3:C4)');
  checkEq('Resumo: TOTAL GERAL de pendências', formula(resumo, 'D5'), 'SUM(D3:D4)');

  /* ---- proteção ---- */
  let formulaDestravada = 0;
  let destravadas = 0;
  for (const ws of lido.worksheets) {
    check(`Aba "${ws.name}" protegida`, ws.sheetProtection?.sheet === true);
    ws.eachRow((row: any) => {
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        const temFormula = cell.value && typeof cell.value === 'object' && 'formula' in cell.value;
        const destravada = cell.protection?.locked === false;
        if (destravada) destravadas++;
        if (temFormula && destravada) formulaDestravada++;
      });
    });
  }
  checkEq('nenhuma célula de fórmula destravada', formulaDestravada, 0);
  // 3 tarifas + 2 dados bancários
  checkEq('destravadas = tarifas + dados bancários', destravadas, 5);

  /* ======================================================================== */
  /* 5. Cálculo real das fórmulas (tarifa por empresa)                        */
  /* ======================================================================== */

  console.log('\n[5] Recálculo das fórmulas com tarifas preenchidas');

  // O ExcelJS não avalia fórmula. Para provar que o desenho fecha, reproduzimos
  // aqui a semântica de SUMIFS/COUNTIFS sobre a aba Tarifas lida do arquivo.
  const tarifaDe = (instrutor: string, empresa: string, preenchidas: Record<string, number>) =>
    preenchidas[`${instrutor}|${empresa}`] ?? 0;

  const preenchidas = { 'Ana Maria|Vale': 90, 'Ana Maria|ArcelorMittal': 120 }; // Samarco fica em branco

  const valorLinha = (instrutor: string, linhas: any[], i: number) =>
    linhas[i].horas * tarifaDe(instrutor, linhas[i].empresa, preenchidas);

  const anaLinhas = blocks[0].linhas;
  checkEq('Vale a R$ 90: 6h -> 540', valorLinha('Ana Maria', anaLinhas, 0), 540);
  checkEq('ArcelorMittal a R$ 120: 8h -> 960', valorLinha('Ana Maria', anaLinhas, 1), 960);
  checkEq('Vale a R$ 90 na 2ª demanda: 4h -> 360', valorLinha('Ana Maria', anaLinhas, 2), 360);
  checkEq('total da Ana = 540 + 960 + 360', anaLinhas.reduce((acc, _l, i) => acc + valorLinha('Ana Maria', anaLinhas, i), 0), 1860);

  const brunoLinhas = blocks[1].linhas;
  checkEq('tarifa não preenchida -> valor 0', valorLinha('Bruno Souza', brunoLinhas, 0), 0);

  // Contador de pendências: pares do instrutor com tarifa em branco.
  const pendentesDe = (instrutor: string) =>
    tarifas.getRows(2, tarifas.actualRowCount - 1)
      .filter((r: any) => String(r.getCell(1).value) === instrutor)
      // coluna 5 = Hora/Aula (mudou de letra ao entrarem Tipo e Noturno)
      .filter((r: any) => r.getCell(5).value === null || r.getCell(5).value === undefined || r.getCell(5).value === '')
      .length;

  checkEq('Bruno tem 1 tarifa pendente na planilha recém-gerada', pendentesDe('Bruno Souza'), 1);
  checkEq('Ana tem 2 tarifas pendentes na planilha recém-gerada', pendentesDe('Ana Maria'), 2);
  check('tarifa pendente > 0 sinaliza total incompleto', pendentesDe('Bruno Souza') > 0);


  /* ======================================================================== */
  /* [6] Demanda INTERNA — workbook próprio                                   */
  /* ======================================================================== */
  // Cenário isolado de propósito: a interna acrescenta um par na aba Tarifas
  // ('(sem empresa)' também precisa de tarifa — é trabalho pago ao instrutor),
  // e enfiá-la na fixture compartilhada mudaria as contagens de todos os checks
  // acima, escondendo regressão futura atrás de números remexidos.
  console.log('\n[6] Demanda interna na planilha de pagamento');

  const wbInterna = await buildMedicaoWorkbook(
    [{
      instructorId: 'i3', nome: 'Carla Dias', cpf: '',
      linhas: [
        { demandId: 'DEM-104', empresa: 'Vale', trainingName: 'NR 35', dias: ['2026-07-09'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false },
        { demandId: 'DEM-900', empresa: '(sem empresa)', trainingName: 'Organizar van para Brucutu', dias: ['2026-07-08'], local: 'Brucutu - MG', modalidade: 'Presencial', horas: 6, categoria: 'SIPAT', tipo: 'Interna' as const, noturno: false },
      ],
    }] as any,
    periodo
  );

  const bufInterna = await wbInterna.xlsx.writeBuffer();
  const wbLidoInterna = new ExcelJSModule.default.Workbook();
  await wbLidoInterna.xlsx.load(bufInterna as any);
  const carla = wbLidoInterna.getWorksheet('Carla Dias');

  // As linhas são ordenadas por dia (08/07 antes de 09/07), então a interna cai
  // na 2 — mas o teste não depende disso: descobre qual é qual pelo código.
  const li = texto(carla, 'A2') === 'DEM-900' ? '2' : '3';
  const lc = li === '2' ? '3' : '2';

  checkEq('Interna: Treinamento traz a descrição', texto(carla, 'C' + li), 'Organizar van para Brucutu');
  checkEq('Interna: Empresa vira (sem empresa)', texto(carla, 'B' + li), '(sem empresa)');
  checkEq('Interna: Tipo na coluna I', texto(carla, 'I' + li), 'Interna');
  checkEq('Interna: Categoria na coluna J', texto(carla, 'J' + li), 'SIPAT');
  checkEq('Interna: horas continuam em G', carla.getCell('G' + li).value, 6);
  checkEq('Cliente: Tipo na coluna I', texto(carla, 'I' + lc), 'Treinamento');
  checkEq('Cliente: coluna Categoria fica vazia', texto(carla, 'J' + lc), '');
  check(
    'Interna: fórmula de valor idêntica à de cliente (G x tarifa por B)',
    String(formula(carla, 'H' + li)).includes('G' + li + '*SUMIFS(') &&
    String(formula(carla, 'H' + li)).includes('B' + li)
  );
  checkEq('Interna: cabeçalho das colunas novas', ['I1', 'J1', 'K1'].map(a => texto(carla, a)).join('|'), 'Tipo|Categoria|Noturno');
  checkEq('Interna: modalidade sai Presencial', texto(carla, 'F' + li), 'Presencial');
  checkEq('Interna: total de horas soma as duas linhas', formula(carla, 'G4'), 'SUM(G2:G3)');



  /* ======================================================================== */
  /* [7] Granularidade da tarifa: tipo e noturno                              */
  /* ======================================================================== */
  // O caso que motivou a mudança: hora noturna vale mais e demanda interna vale
  // menos, então (instrutor, empresa) não basta como chave de tarifa.
  console.log('\n[7] Tarifa por (instrutor, empresa, tipo, noturno)');

  const wbGran = await buildMedicaoWorkbook(
    [{
      instructorId: 'i4', nome: 'Alan Costa', cpf: '',
      linhas: [
        // MESMA empresa, MESMO tipo, turnos diferentes -> 2 tarifas
        { demandId: 'DEM-200', empresa: 'FIDENS', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false },
        { demandId: 'DEM-201', empresa: 'FIDENS', trainingName: 'NR 35', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 6, categoria: '', tipo: 'Treinamento' as const, noturno: true },
        // MESMA empresa, tipo diferente -> mais uma tarifa
        { demandId: 'DEM-202', empresa: 'FIDENS', trainingName: 'Apoio na SIPAT', dias: ['2026-07-08'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, categoria: 'SIPAT', tipo: 'Interna' as const, noturno: false },
        // Repetição exata da primeira -> NÃO gera linha nova
        { demandId: 'DEM-203', empresa: 'FIDENS', trainingName: 'NR 33', dias: ['2026-07-09'], local: 'BH - MG', modalidade: 'Presencial', horas: 2, categoria: '', tipo: 'Treinamento' as const, noturno: false },
      ],
    }] as any,
    periodo
  );

  const bufGran = await wbGran.xlsx.writeBuffer();
  const wbLidoGran = new ExcelJSModule.default.Workbook();
  await wbLidoGran.xlsx.load(bufGran as any);
  const tarGran = wbLidoGran.getWorksheet('Tarifas');
  const alan = wbLidoGran.getWorksheet('Alan Costa');

  const combos = tarGran.getRows(2, tarGran.actualRowCount - 1)
    .map((r: any) => [r.getCell(2).value, r.getCell(3).value, r.getCell(4).value || ''].join('/'));

  checkEq('4 demandas na mesma empresa geram 3 tarifas', combos.length, 3);
  check('tem FIDENS/Treinamento diurno', combos.includes('FIDENS/Treinamento/Não'));
  check('tem FIDENS/Treinamento NOTURNO', combos.includes('FIDENS/Treinamento/Sim'));
  check('tem FIDENS/Interna', combos.includes('FIDENS/Interna/Não'));
  check('sem produto cartesiano (não inventa Interna noturna)', !combos.includes('FIDENS/Interna/Sim'));

  // Preenche as 3 tarifas com valores DIFERENTES e recalcula à mão as fórmulas
  const tarifaPor = (empresa: string, tipo: string, noturno: string) =>
    ({ 'FIDENS/Treinamento/Não': 100, 'FIDENS/Treinamento/Sim': 150, 'FIDENS/Interna/Não': 60 } as Record<string, number>)[
      `${empresa}/${tipo}/${noturno}`
    ] ?? 0;

  const valorDaLinha = (rowIdx: number) => {
    const empresa = String(alan.getCell(`B${rowIdx}`).value ?? '');
    const tipo = String(alan.getCell(`I${rowIdx}`).value ?? '');
    const noturno = String(alan.getCell(`K${rowIdx}`).value ?? '');
    const horas = Number(alan.getCell(`G${rowIdx}`).value ?? 0);
    return horas * tarifaPor(empresa, tipo, noturno);
  };

  checkEq('diurno 8h x 100', valorDaLinha(2), 800);
  checkEq('NOTURNO 6h x 150 (tarifa maior)', valorDaLinha(3), 900);
  checkEq('INTERNA 4h x 60 (tarifa menor)', valorDaLinha(4), 240);
  checkEq('4a linha reusa a tarifa diurna: 2h x 100', valorDaLinha(5), 200);
  check(
    'noturno e diurno da MESMA empresa dão valores diferentes por hora',
    valorDaLinha(3) / 6 !== valorDaLinha(2) / 8
  );
  check(
    'interna e treinamento da MESMA empresa dão valores diferentes por hora',
    valorDaLinha(4) / 4 !== valorDaLinha(2) / 8
  );

  // A fórmula da planilha tem que referenciar as 4 chaves, não só duas
  const fGran = String(formula(alan, 'H3'));
  check('fórmula cruza instrutor+empresa+tipo+noturno',
    fGran.includes('$A:$A') && fGran.includes('$B:$B') && fGran.includes('Tarifas!$C:$C,I3') && fGran.includes('Tarifas!$D:$D,K3'));
  check('fórmula soma a coluna E (valor)', fGran.includes('SUMIFS(Tarifas!$E:$E'));

  checkEq('pendências contam as 3 combinações em branco',
    tarGran.getRows(2, tarGran.actualRowCount - 1)
      .filter((r: any) => r.getCell(5).value === null || r.getCell(5).value === undefined || r.getCell(5).value === '').length,
    3);

  /* ======================================================================== */
  /* [8] REGRESSÃO — a tarifa da PRIMEIRA linha de Tarifas tem que calcular   */
  /* ======================================================================== */
  // Bug real: tarifa preenchida na linha 2 da aba Tarifas (primeiro instrutor
  // alfabético, Treinamento diurno) não refletia na aba de detalhe — Valor
  // ficava R$ 0,00 com as 4 chaves batendo.
  //
  // Não era off-by-one de range: a fórmula usa coluna inteira ($E:$E). Era o
  // diurno gravado como '' na aba Tarifas (célula de TEXTO vazio) contra célula
  // AUSENTE na aba de detalhe — e o Excel converte critério vindo de célula
  // vazia para o número 0, que não casa com texto vazio.
  //
  // Os blocos acima não pegavam porque nenhum deles AVALIA o SUMIFS: eles
  // reimplementam a busca em JS lendo B/I/K e consultando um mapa escrito à
  // mão, e ainda normalizam os dois lados com `?? ''` / `|| ''` — que apaga
  // exatamente a distinção ''-vs-vazio que causou o bug. Aqui a fórmula é
  // PARSEADA da célula e executada contra as células como saíram do arquivo.
  console.log('\n[8] Regressão: SUMIFS avaliado de verdade sobre a linha 2 de Tarifas');

  const wbReg = await buildMedicaoWorkbook(
    [{
      // Primeiro alfabeticamente -> cai na LINHA 2 da aba Tarifas, a posição
      // que o bug escondia.
      instructorId: 'i5', nome: 'Alexandre Eduardo', cpf: '',
      linhas: [
        { demandId: 'DEM-1406', empresa: 'VALE', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false },
        { demandId: 'DEM-1407', empresa: 'VALE', trainingName: 'NR 33', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, categoria: '', tipo: 'Treinamento' as const, noturno: false },
      ],
    }] as any,
    periodo
  );

  const bufReg = await wbReg.xlsx.writeBuffer();
  const wbLidoReg = new ExcelJSModule.default.Workbook();
  await wbLidoReg.xlsx.load(bufReg as any);
  const tarReg = wbLidoReg.getWorksheet('Tarifas');
  const detReg = wbLidoReg.getWorksheet('Alexandre Eduardo');

  checkEq('cenário: as 2 linhas geram 1 única tarifa, na linha 2', tarReg.actualRowCount - 1, 1);
  checkEq('cenário: a tarifa testada é mesmo a 1a linha de dados', String(tarReg.getCell('A2').value ?? ''), 'Alexandre Eduardo');

  /* ---- invariante estrutural: chave de SUMIFS nunca pode ser vazia ---- */
  // Zero assunção sobre semântica do Excel: só exige que toda célula-chave
  // tenha conteúdo. Teria pegado o bug sozinha.
  const vaziaReg = (v: any) => v === null || v === undefined || String(v) === '';
  const chavesVazias: string[] = [];
  for (let r = 2; r <= tarReg.actualRowCount; r++) {
    for (const col of ['A', 'B', 'C', 'D']) {
      if (vaziaReg(tarReg.getCell(col + r).value)) chavesVazias.push('Tarifas!' + col + r);
    }
  }
  for (let r = 2; r <= 3; r++) {
    for (const col of ['B', 'I', 'K']) {
      if (vaziaReg(detReg.getCell(col + r).value)) chavesVazias.push('detalhe!' + col + r);
    }
  }
  check('nenhuma célula-chave de SUMIFS sai vazia', chavesVazias.length === 0, chavesVazias.join(', '));

  /* ---- avaliador de SUMIFS: roda a fórmula que está mesmo na célula ---- */
  // Separa argumentos no nível de cima respeitando "" (nome pode ter vírgula).
  const splitArgs = (src: string) => {
    const out: string[] = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"') { aspas = !aspas; atual += ch; continue; }
      if (ch === ',' && !aspas) { out.push(atual); atual = ''; continue; }
      atual += ch;
    }
    out.push(atual);
    return out;
  };

  // 'Tarifas!$D:$D' -> valores das linhas de dados daquela coluna.
  const colunaTarifas = (ref: string) => {
    const m = /^Tarifas!\$([A-Z]+):\$([A-Z]+)$/.exec(ref.trim());
    if (!m || m[1] !== m[2]) throw new Error('range inesperado: ' + ref);
    const vals: any[] = [];
    for (let r = 2; r <= tarReg.actualRowCount; r++) vals.push(tarReg.getCell(m[1] + r).value);
    return vals;
  };

  // Critério: literal entre aspas, ou referência a célula da aba de detalhe.
  // O caso decisivo é a referência a célula VAZIA — o Excel converte para 0.
  const criterioDe = (arg: string) => {
    const t = arg.trim();
    if (t.startsWith('"')) {
      return { tipo: 'texto' as const, valor: t.slice(1, -1).replace(/""/g, '"').replace(/~([*?~])/g, '$1') };
    }
    const v = detReg.getCell(t).value;
    if (v === null || v === undefined) return { tipo: 'vazioVira0' as const, valor: '' };
    return { tipo: 'texto' as const, valor: String(v) };
  };

  const casa = (celula: any, crit: { tipo: string; valor: string }) => {
    const celulaVazia = celula === null || celula === undefined;
    // Critério vindo de célula vazia é o NÚMERO 0: não casa com texto vazio nem
    // com célula vazia. Foi exatamente aqui que a tarifa diurna se perdia.
    if (crit.tipo === 'vazioVira0') return celula === 0;
    if (crit.valor === '') return celulaVazia || celula === '';
    if (celulaVazia) return false;
    return String(celula).toLowerCase() === crit.valor.toLowerCase();
  };

  const avaliarValor = (rowIdx: number, tarifaNaLinha2: number | null) => {
    const f = String(formula(detReg, 'H' + rowIdx));
    const m = /^G(\d+)\*SUMIFS\((.*)\)$/.exec(f);
    if (!m) throw new Error('fórmula fora do formato esperado: ' + f);
    const args = splitArgs(m[2]);
    // Só E2 (a 1a linha de dados) recebe tarifa — é o cenário do bug.
    const somaCol = colunaTarifas(args[0]).map((_v, i) => (i === 0 ? tarifaNaLinha2 : null));
    let total = 0;
    for (let i = 0; i < somaCol.length; i++) {
      let bate = true;
      for (let a = 1; a < args.length; a += 2) {
        if (!casa(colunaTarifas(args[a])[i], criterioDe(args[a + 1]))) { bate = false; break; }
      }
      if (bate) total += Number(somaCol[i] ?? 0);
    }
    return Number(detReg.getCell('G' + m[1]).value ?? 0) * total;
  };

  // O caso do bug: R$ 50,00 digitado em E2, 8h na linha 2 do detalhe.
  checkEq('tarifa em E2 (1a linha de Tarifas) chega na 1a linha do detalhe: 8h x 50', avaliarValor(2, 50), 400);
  checkEq('e tambem na 2a linha, mesma combinacao: 4h x 50', avaliarValor(3, 50), 200);
  checkEq('sem tarifa preenchida o valor e 0 (e nao um numero errado)', avaliarValor(2, null), 0);

  // Contraprova de que o avaliador NAO e complacente: chave divergente nao casa.
  check('avaliador rejeita chave divergente (Sim x Nao)', casa('Sim', criterioDe('K2')) === false);

  console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error('ERRO NÃO TRATADO:', e);
  process.exit(1);
});
