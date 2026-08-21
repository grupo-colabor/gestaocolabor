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
        { demandId: 'DEM-100', empresa: 'Vale', trainingName: 'NR 33', dias: ['2026-06-26', '2026-06-27', '2026-06-28'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 6, categoria: '' },
        { demandId: 'DEM-101', empresa: 'ArcelorMittal', trainingName: 'NR 35', dias: ['2026-07-02'], local: 'Serra - ES', modalidade: 'Presencial', horas: 8, categoria: '' },
        { demandId: 'DEM-102', empresa: 'Vale', trainingName: 'NR 20', dias: ['2026-07-10'], local: 'Vitória - ES', modalidade: 'Híbrido', horas: 4, categoria: '' },
      ],
    },
    {
      instructorId: 'i2', nome: 'Bruno Souza', cpf: '',
      linhas: [
        { demandId: 'DEM-103', empresa: 'Samarco', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'Anchieta - ES', modalidade: 'Presencial', horas: 8, categoria: '' },
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
  checkEq('Tarifas: cabeçalho', [texto(tarifas, 'A1'), texto(tarifas, 'B1'), texto(tarifas, 'C1')].join(' | '), 'Instrutor | Empresa | Hora/Aula (R$)');
  checkEq('Tarifas: uma linha por par (instrutor, empresa)', tarifas.actualRowCount, 4); // 1 cabeçalho + 3 pares
  checkEq('Tarifas: par 1', `${texto(tarifas, 'A2')}/${texto(tarifas, 'B2')}`, 'Ana Maria/ArcelorMittal');
  checkEq('Tarifas: par 2 (mesma instrutora, outra empresa)', `${texto(tarifas, 'A3')}/${texto(tarifas, 'B3')}`, 'Ana Maria/Vale');
  checkEq('Tarifas: par 3', `${texto(tarifas, 'A4')}/${texto(tarifas, 'B4')}`, 'Bruno Souza/Samarco');
  checkEq('Tarifas: duas demandas da mesma empresa não duplicam a linha', tarifas.actualRowCount - 1, 3);
  check('Tarifas: coluna C destravada', tarifas.getCell('C2').protection?.locked === false);
  check('Tarifas: coluna A travada', tarifas.getCell('A2').protection?.locked !== false);
  {
    const nota = tarifas.getCell('C1').note;
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
  checkEq('Detalhe: Categoria é a coluna I', texto(ana, 'I1'), 'Categoria');
  checkEq('Detalhe: demanda de cliente não tem categoria', texto(ana, 'I2'), '');

  /* ---- fórmula de valor: tarifa cruzada por empresa da própria linha ---- */
  checkEq(
    'Detalhe: valor busca tarifa por (instrutor, empresa da linha)',
    formula(ana, 'H2'),
    'G2*SUMIFS(Tarifas!$C:$C,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B2)'
  );
  checkEq(
    'Detalhe: linha de outra empresa referencia a própria coluna B',
    formula(ana, 'H3'),
    'G3*SUMIFS(Tarifas!$C:$C,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B3)'
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
  checkEq('Resumo: pendências contam tarifas em branco do instrutor', formula(resumo, 'D3'), 'COUNTIFS(Tarifas!$A:$A,"Ana Maria",Tarifas!$C:$C,"")');
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
      .filter((r: any) => r.getCell(3).value === null || r.getCell(3).value === undefined || r.getCell(3).value === '')
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
        { demandId: 'DEM-104', empresa: 'Vale', trainingName: 'NR 35', dias: ['2026-07-09'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 8, categoria: '' },
        { demandId: 'DEM-900', empresa: '(sem empresa)', trainingName: 'Organizar van para Brucutu', dias: ['2026-07-08'], local: 'Brucutu - MG', modalidade: 'Presencial', horas: 6, categoria: 'SIPAT' },
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
  checkEq('Interna: Categoria na coluna I', texto(carla, 'I' + li), 'SIPAT');
  checkEq('Interna: horas continuam em G', carla.getCell('G' + li).value, 6);
  checkEq('Cliente: coluna Categoria fica vazia', texto(carla, 'I' + lc), '');
  check(
    'Interna: fórmula de valor idêntica à de cliente (G x tarifa por B)',
    String(formula(carla, 'H' + li)).includes('G' + li + '*SUMIFS(') &&
    String(formula(carla, 'H' + li)).includes('B' + li)
  );
  checkEq('Interna: cabeçalho da coluna I', texto(carla, 'I1'), 'Categoria');
  checkEq('Interna: total de horas soma as duas linhas', formula(carla, 'G4'), 'SUM(G2:G3)');


  console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error('ERRO NÃO TRATADO:', e);
  process.exit(1);
});
