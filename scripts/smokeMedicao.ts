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
/* 4. Workbook: fórmulas, proteção e título do período                        */
/* ========================================================================== */

console.log('\n[4] Workbook gerado');

(async () => {
  const periodo = resolvePeriodo({ modo: 'PERSONALIZADO', dataInicio: '2026-06-26', dataFim: '2026-07-25' });
  const blocks = [
    {
      instructorId: 'i1', nome: 'Ana Maria', cpf: '123.456.789-09',
      linhas: [
        { demandId: 'DEM-100', trainingName: 'NR 33', dias: ['2026-06-26', '2026-06-27', '2026-06-28'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 6 },
      ],
    },
    {
      instructorId: 'i2', nome: 'Bruno Souza', cpf: '',
      linhas: [
        { demandId: 'DEM-101', trainingName: 'NR 35', dias: ['2026-07-02'], local: 'Serra - ES', modalidade: 'Presencial', horas: 8 },
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

  const resumo = lido.getWorksheet('Resumo');
  const formula = (ws: any, addr: string) => {
    const v = ws.getCell(addr).value;
    return v && typeof v === 'object' && 'formula' in v ? (v as any).formula : null;
  };

  checkEq('Resumo: título traz o período', String(resumo.getCell('A1').value), 'MEDIÇÃO DE INSTRUTORES — 26/06/2026 a 25/07/2026');
  checkEq('Resumo: cabeçalho na linha 2', String(resumo.getCell('A2').value), 'Instrutor');
  checkEq('Resumo: 1º instrutor na linha 3', String(resumo.getCell('A3').value), 'Ana Maria');
  checkEq('Resumo: soma de horas aponta para a aba do instrutor', formula(resumo, 'C3'), "SUM('Ana Maria'!F2:F2)");
  checkEq('Resumo: total = hora/aula × horas', formula(resumo, 'D3'), 'B3*C3');
  checkEq('Resumo: TOTAL GERAL soma a partir da linha 3', formula(resumo, 'D5'), 'SUM(D3:D4)');

  const detalhe = lido.getWorksheet('Ana Maria');
  checkEq('Detalhe: valor referencia a hora/aula do Resumo', formula(detalhe, 'G2'), 'F2*Resumo!$B$3');
  checkEq('Detalhe: 2º instrutor referencia a própria linha', formula(lido.getWorksheet('Bruno Souza'), 'G2'), 'F2*Resumo!$B$4');

  // Proteção: nenhuma célula com fórmula pode estar destravada.
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
  checkEq('destravadas = 2 por instrutor (Hora/Aula + Dados Bancários)', destravadas, 4);

  console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error('ERRO NÃO TRATADO:', e);
  process.exit(1);
});
