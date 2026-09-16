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
import fsSmoke from 'fs';
import pathSmoke from 'path';
import { computeInstructorHours, computeInstructorHoursByDemand, eligibleDemandIdsForPayment } from '../domain/instructorHours';
import { applyMeasurementOverrides } from '../domain/measurementOverrides';
import { getDemandCompanyLabel, INTERNAL_COMPANY_LABEL } from '../domain/demandLabel';

/** Leitura de fonte, para as guardas que prendem a regra no arquivo certo. */
const ler = (rel: string) => fsSmoke.readFileSync(pathSmoke.join(process.cwd(), rel), 'utf8');
// Importa a camada PURA (sem Supabase), para o script rodar em Node sem env.
import {
  buildMedicaoWorkbook,
  countDaysInclusive,
  resolvePeriodo,
} from '../services/medicaoWorkbook';
import { resolveAttachmentLink, UNLINKED_LABEL } from '../domain/measurementAttachment';

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
        { demandId: 'DEM-100', empresa: 'Vale', trainingName: 'NR 33', dias: ['2026-06-26', '2026-06-27', '2026-06-28'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 6, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-101', empresa: 'ArcelorMittal', trainingName: 'NR 35', dias: ['2026-07-02'], local: 'Serra - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-102', empresa: 'Vale', trainingName: 'NR 20', dias: ['2026-07-10'], local: 'Vitória - ES', modalidade: 'Híbrido', horas: 4, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
      ],
    },
    {
      instructorId: 'i2', nome: 'Bruno Souza', cpf: '',
      linhas: [
        { demandId: 'DEM-103', empresa: 'Samarco', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'Anchieta - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
      ],
    },
  ];

  // Linhas de fixture sem despesa a reembolsar e com horas informadas — o caso
  // de sempre. O bloco [D5] cobre o acompanhante sem horas e o reembolso.
  const SEM_REEMBOLSO = { hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0, total: 0 };
  const comDefaults = (bs: any[]) =>
    bs.map(b => ({ ...b, linhas: b.linhas.map((l: any) => ({ horasInformadas: true, reembolso: SEM_REEMBOLSO, ...l })) }));

  const wb = await buildMedicaoWorkbook(comDefaults(blocks) as any, periodo);

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
    'Tarifas: cabeçalho com Tipo, Noturno e Papel',
    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].map(a => texto(tarifas, a)).join(' | '),
    'Instrutor | Empresa | Tipo | Noturno | Papel | Hora/Aula (R$)'
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
  check('Tarifas: coluna F (valor) destravada', tarifas.getCell('F2').protection?.locked === false);
  check('Tarifas: coluna A travada', tarifas.getCell('A2').protection?.locked !== false);
  check('Tarifas: coluna C (chave) travada', tarifas.getCell('C2').protection?.locked !== false);
  check('Tarifas: coluna D (chave) travada', tarifas.getCell('D2').protection?.locked !== false);
  check('Tarifas: coluna E (papel, chave) travada', tarifas.getCell('E2').protection?.locked !== false);
  checkEq('Tarifas: papel da linha de quem ministra', texto(tarifas, 'E2'), 'Titular');
  {
    const nota = tarifas.getCell('F1').note;
    const txt = typeof nota === 'string' ? nota : (nota?.texts || []).map((t: any) => t.text).join('');
    check('Tarifas: nota "PREENCHA AQUI" no cabeçalho da tarifa', txt.startsWith('PREENCHA AQUI'));
    check('Resumo: nota "PREENCHA AQUI" saiu do Resumo', !lido.getWorksheet('Resumo').getCell('B2').note);
  }

  /* ---- aba de detalhe: nome na 1, CPF/banco na 2, cabeçalho na 3, dados da 4 ---- */
  const ana = lido.getWorksheet('Ana Maria');
  checkEq('Detalhe: linha 1 é o nome do instrutor', texto(ana, 'A1'), 'Ana Maria');
  checkEq('Detalhe: linha 2 traz o CPF do cadastro', `${texto(ana, 'A2')}=${texto(ana, 'B2')}`, 'CPF/CNPJ=123.456.789-09');
  checkEq('Detalhe: e os dados bancários por fórmula a partir do Resumo (sem 0 quando vazio)', `${texto(ana, 'C2')}: ${formula(ana, 'D2')}`, 'Dados bancários: IF(Resumo!I3="","",Resumo!I3)');
  checkEq('Detalhe: cabeçalho congelado até a linha 3', `${ana.views?.[0]?.state}/${ana.views?.[0]?.ySplit}`, 'frozen/3');
  checkEq(
    'Detalhe: cabeçalho na linha 3, despesas por categoria ANTES das horas',
    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3'].map(a => texto(ana, a)).join(' | '),
    'Código | Empresa | Treinamento | Data | Local | Modalidade | Hospedagem | Transporte (Locomoção) | Alimentação | Outros | Total despesas — automático | Horas | Hora/aula (R$) — automático | Total (R$) — automático'
  );
  checkEq('Detalhe: empresa da linha 4 (1ª de dados)', texto(ana, 'B4'), 'Vale');
  checkEq('Detalhe: treinamento em C', texto(ana, 'C4'), 'NR 33');
  checkEq('Detalhe: horas agora em L', ana.getCell('L4').value, 6);
  checkEq('Detalhe: horas com formato de horas', ana.getCell('L4').numFmt, '0.0');
  check('Detalhe: horas informadas ficam TRAVADAS (não é célula de input)', ana.getCell('L4').protection?.locked !== false);

  /* ---- chaves de tarifa e Categoria: no FIM, depois dos totais ---- */
  checkEq('Detalhe: Tipo/Categoria/Noturno/Papel são O/P/Q/R', ['O3', 'P3', 'Q3', 'R3'].map(a => texto(ana, a)).join(' | '), 'Tipo | Categoria | Noturno | Papel');
  // Papel é chave de SUMIFS: rótulo LITERAL, nunca célula vazia — mesma classe
  // do 'Não' da coluna Noturno.
  checkEq('Detalhe: quem ministra sai como Titular', texto(ana, 'R4'), 'Titular');
  checkEq('Detalhe: tipo da demanda de cliente', texto(ana, 'O4'), 'Treinamento');
  checkEq('Detalhe: demanda de cliente não tem categoria', texto(ana, 'P4'), '');
  // Diurno tem que ser rótulo LITERAL: em branco, o SUMIFS da tarifa zerava
  // (critério vindo de célula vazia vira 0 e não casa com texto vazio).
  checkEq('Detalhe: diurno marca Noturno como Não', texto(ana, 'Q4'), 'Não');

  /* ---- fórmulas da linha: despesas, hora/aula por tarifa da própria linha, total por SUM ---- */
  checkEq('Detalhe: Total despesas soma as quatro colunas da linha', formula(ana, 'K4'), 'SUM(G4:J4)');
  checkEq(
    'Detalhe: hora/aula busca tarifa por (instrutor, empresa da linha)',
    formula(ana, 'M4'),
    'L4*SUMIFS(Tarifas!$F:$F,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B4,Tarifas!$C:$C,O4,Tarifas!$D:$D,Q4,Tarifas!$E:$E,R4)'
  );
  checkEq(
    'Detalhe: linha de outra empresa referencia a própria coluna B',
    formula(ana, 'M5'),
    'L5*SUMIFS(Tarifas!$F:$F,Tarifas!$A:$A,"Ana Maria",Tarifas!$B:$B,B5,Tarifas!$C:$C,O5,Tarifas!$D:$D,Q5,Tarifas!$E:$E,R5)'
  );
  check('Detalhe: fórmula usa vírgula (separador do XML, não do Excel PT-BR)', !String(formula(ana, 'M4')).includes(';'));
  checkEq('Detalhe: Total da linha é SUM(despesas, hora/aula) — nunca +', formula(ana, 'N4'), 'SUM(K4,M4)');
  checkEq('Detalhe: total de horas em L', formula(ana, 'L7'), 'SUM(L4:L6)');
  checkEq('Detalhe: total de hora/aula em M', formula(ana, 'M7'), 'SUM(M4:M6)');
  checkEq('Detalhe: total de despesas em K', formula(ana, 'K7'), 'SUM(K4:K6)');
  checkEq('Detalhe: total geral da aba em N', formula(ana, 'N7'), 'SUM(N4:N6)');

  /* ---- Resumo: hora/aula, despesas a reembolsar, total a pagar, pendências ---- */
  const resumo = lido.getWorksheet('Resumo');
  checkEq('Resumo: título traz o período', texto(resumo, 'A1'), 'MEDIÇÃO DE INSTRUTORES — 26/06/2026 a 25/07/2026');
  checkEq(
    'Resumo: cabeçalho com Hora/aula, Despesas a reembolsar, Total a pagar e Tarifas pendentes',
    ['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'I2'].map(a => texto(resumo, a)).join(' | '),
    'Instrutor | Total de Horas — automático | Hora/aula (R$) — automático | Despesas a reembolsar (R$) — automático | Total a pagar (R$) — automático | Tarifas pendentes — automático | Horas pendentes — automático | CPF/CNPJ | Dados Bancários'
  );
  checkEq('Resumo: horas somam a coluna L da aba do instrutor', formula(resumo, 'B3'), "SUM('Ana Maria'!L4:L6)");
  checkEq('Resumo: hora/aula soma a coluna M da aba (não horas × tarifa)', formula(resumo, 'C3'), "SUM('Ana Maria'!M4:M6)");
  checkEq('Resumo: despesas a reembolsar somam a coluna K da aba', formula(resumo, 'D3'), "SUM('Ana Maria'!K4:K6)");
  checkEq('Resumo: total a pagar soma a coluna N da aba', formula(resumo, 'E3'), "SUM('Ana Maria'!N4:N6)");
  checkEq('Resumo: pendências contam tarifas em branco do instrutor', formula(resumo, 'F3'), 'COUNTIFS(Tarifas!$A:$A,"Ana Maria",Tarifas!$F:$F,"")');
  checkEq('Resumo: horas pendentes contam células de Horas em branco da aba', formula(resumo, 'G3'), "COUNTIF('Ana Maria'!L4:L6,\"\")");
  checkEq('Resumo: CPF em H', texto(resumo, 'H3'), '123.456.789-09');
  check('Resumo: dados bancários em I, destravados', resumo.getCell('I3').protection?.locked === false);
  checkEq('Resumo: TOTAL GERAL de hora/aula', formula(resumo, 'C5'), 'SUM(C3:C4)');
  checkEq('Resumo: TOTAL GERAL de despesas a reembolsar', formula(resumo, 'D5'), 'SUM(D3:D4)');
  checkEq('Resumo: TOTAL GERAL a pagar', formula(resumo, 'E5'), 'SUM(E3:E4)');
  checkEq('Resumo: TOTAL GERAL de pendências', formula(resumo, 'F5'), 'SUM(F3:F4)');
  checkEq('Resumo: TOTAL GERAL de horas pendentes', formula(resumo, 'G5'), 'SUM(G3:G4)');

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
      // coluna 6 = Hora/Aula (mudou de letra ao entrarem Tipo, Noturno e Papel)
      .filter((r: any) => r.getCell(6).value === null || r.getCell(6).value === undefined || r.getCell(6).value === '')
      .length;

  checkEq('Bruno tem 1 tarifa pendente na planilha recém-gerada', pendentesDe('Bruno Souza'), 1);
  checkEq('Ana tem 2 tarifas pendentes na planilha recém-gerada', pendentesDe('Ana Maria'), 2);
  check('tarifa pendente > 0 sinaliza total incompleto', pendentesDe('Bruno Souza') > 0);


  /* ======================================================================== */
  /* [6] Demanda INTERNA — workbook próprio                                   */
  /* ======================================================================== */
  // Cenário isolado de propósito: a interna acrescenta um par na aba Tarifas
  // ('Colabor (Interna)' também precisa de tarifa — é trabalho pago ao instrutor),
  // e enfiá-la na fixture compartilhada mudaria as contagens de todos os checks
  // acima, escondendo regressão futura atrás de números remexidos.
  console.log('\n[6] Demanda interna na planilha de pagamento');

  const wbInterna = await buildMedicaoWorkbook(
    comDefaults([{
      instructorId: 'i3', nome: 'Carla Dias', cpf: '',
      linhas: [
        { demandId: 'DEM-104', empresa: 'Vale', trainingName: 'NR 35', dias: ['2026-07-09'], local: 'Vitória - ES', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-900', empresa: 'Colabor (Interna)', trainingName: 'Organizar van para Brucutu', dias: ['2026-07-08'], local: 'Brucutu - MG', modalidade: 'Presencial', horas: 6, categoria: 'SIPAT', tipo: 'Interna' as const, noturno: false, papel: 'Titular' as const },
      ],
    }]) as any,
    periodo
  );

  const bufInterna = await wbInterna.xlsx.writeBuffer();
  const wbLidoInterna = new ExcelJSModule.default.Workbook();
  await wbLidoInterna.xlsx.load(bufInterna as any);
  const carla = wbLidoInterna.getWorksheet('Carla Dias');

  // As linhas são ordenadas por dia (08/07 antes de 09/07), então a interna cai
  // na 4 (1ª de dados) — mas o teste não depende disso: descobre pelo código.
  const li = texto(carla, 'A4') === 'DEM-900' ? '4' : '5';
  const lc = li === '4' ? '5' : '4';

  checkEq('Interna: Treinamento traz a descrição', texto(carla, 'C' + li), 'Organizar van para Brucutu');
  // A planilha diz o MESMO que o app: interna sem cliente e 'Colabor (Interna)'
  // (domain/demandLabel), nao '(sem empresa)' — um rotulo em cada lugar parecia
  // cadastro faltando para quem confere pagamento nos dois.
  checkEq('Interna: Empresa usa o rotulo do app', texto(carla, 'B' + li), 'Colabor (Interna)');
  checkEq('Interna: Tipo na coluna O', texto(carla, 'O' + li), 'Interna');
  checkEq('Interna: Categoria na coluna P', texto(carla, 'P' + li), 'SIPAT');
  checkEq('Interna: horas em L', carla.getCell('L' + li).value, 6);
  checkEq('Cliente: Tipo na coluna O', texto(carla, 'O' + lc), 'Treinamento');
  checkEq('Cliente: coluna Categoria fica vazia', texto(carla, 'P' + lc), '');
  check(
    'Interna: fórmula de hora/aula idêntica à de cliente (L x tarifa por B)',
    String(formula(carla, 'M' + li)).includes('L' + li + '*SUMIFS(') &&
    String(formula(carla, 'M' + li)).includes('B' + li)
  );
  checkEq('Interna: cabeçalho das chaves de tarifa', ['O3', 'P3', 'Q3'].map(a => texto(carla, a)).join('|'), 'Tipo|Categoria|Noturno');
  checkEq('Interna: modalidade sai Presencial', texto(carla, 'F' + li), 'Presencial');
  checkEq('Interna: total de horas soma as duas linhas', formula(carla, 'L6'), 'SUM(L4:L5)');



  /* ======================================================================== */
  /* [7] Granularidade da tarifa: tipo e noturno                              */
  /* ======================================================================== */
  // O caso que motivou a mudança: hora noturna vale mais e demanda interna vale
  // menos, então (instrutor, empresa) não basta como chave de tarifa.
  console.log('\n[7] Tarifa por (instrutor, empresa, tipo, noturno)');

  const wbGran = await buildMedicaoWorkbook(
    comDefaults([{
      instructorId: 'i4', nome: 'Alan Costa', cpf: '',
      linhas: [
        // MESMA empresa, MESMO tipo, turnos diferentes -> 2 tarifas
        { demandId: 'DEM-200', empresa: 'FIDENS', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-201', empresa: 'FIDENS', trainingName: 'NR 35', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 6, categoria: '', tipo: 'Treinamento' as const, noturno: true, papel: 'Titular' as const },
        // MESMA empresa, tipo diferente -> mais uma tarifa
        { demandId: 'DEM-202', empresa: 'FIDENS', trainingName: 'Apoio na SIPAT', dias: ['2026-07-08'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, categoria: 'SIPAT', tipo: 'Interna' as const, noturno: false, papel: 'Titular' as const },
        // Repetição exata da primeira -> NÃO gera linha nova
        { demandId: 'DEM-203', empresa: 'FIDENS', trainingName: 'NR 33', dias: ['2026-07-09'], local: 'BH - MG', modalidade: 'Presencial', horas: 2, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
      ],
    }]) as any,
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

  // Colunas do layout novo: B empresa, O tipo, Q noturno, L horas; dados da linha 4.
  const valorDaLinha = (rowIdx: number) => {
    const empresa = String(alan.getCell(`B${rowIdx}`).value ?? '');
    const tipo = String(alan.getCell(`O${rowIdx}`).value ?? '');
    const noturno = String(alan.getCell(`Q${rowIdx}`).value ?? '');
    const horas = Number(alan.getCell(`L${rowIdx}`).value ?? 0);
    return horas * tarifaPor(empresa, tipo, noturno);
  };

  checkEq('diurno 8h x 100', valorDaLinha(4), 800);
  checkEq('NOTURNO 6h x 150 (tarifa maior)', valorDaLinha(5), 900);
  checkEq('INTERNA 4h x 60 (tarifa menor)', valorDaLinha(6), 240);
  checkEq('4a linha reusa a tarifa diurna: 2h x 100', valorDaLinha(7), 200);
  check(
    'noturno e diurno da MESMA empresa dão valores diferentes por hora',
    valorDaLinha(5) / 6 !== valorDaLinha(4) / 8
  );
  check(
    'interna e treinamento da MESMA empresa dão valores diferentes por hora',
    valorDaLinha(6) / 4 !== valorDaLinha(4) / 8
  );

  // A fórmula da planilha tem que referenciar as 4 chaves, não só duas
  const fGran = String(formula(alan, 'M5'));
  check('fórmula cruza instrutor+empresa+tipo+noturno+papel',
    fGran.includes('$A:$A') && fGran.includes('$B:$B') && fGran.includes('Tarifas!$C:$C,O5') &&
      fGran.includes('Tarifas!$D:$D,Q5') && fGran.includes('Tarifas!$E:$E,R5'));
  check('fórmula soma a coluna F (valor)', fGran.includes('SUMIFS(Tarifas!$F:$F'));

  checkEq('pendências contam as 3 combinações em branco',
    tarGran.getRows(2, tarGran.actualRowCount - 1)
      .filter((r: any) => r.getCell(6).value === null || r.getCell(6).value === undefined || r.getCell(6).value === '').length,
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
    comDefaults([{
      // Primeiro alfabeticamente -> cai na LINHA 2 da aba Tarifas, a posição
      // que o bug escondia.
      instructorId: 'i5', nome: 'Alexandre Eduardo', cpf: '',
      linhas: [
        { demandId: 'DEM-1406', empresa: 'VALE', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-1407', empresa: 'VALE', trainingName: 'NR 33', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
      ],
    }]) as any,
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
    for (const col of ['A', 'B', 'C', 'D', 'E']) {
      if (vaziaReg(tarReg.getCell(col + r).value)) chavesVazias.push('Tarifas!' + col + r);
    }
  }
  // Dados da aba de detalhe começam na linha 4; chaves em B, O, Q e R.
  for (let r = 4; r <= 5; r++) {
    for (const col of ['B', 'O', 'Q', 'R']) {
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

  // O avaliador virou FÁBRICA quando a chave passou a ter 5 componentes: o
  // cenário do bug original (4 chaves, papel Titular) e o cenário novo
  // (Titular e Acompanhante do MESMO instrutor na MESMA empresa) precisam ser
  // avaliados pelo mesmo código. Dois avaliadores divergiriam, e o que prova a
  // não-regressão é justamente rodar o mesmo motor nos dois.
  const criarAvaliador = (tarSheet: any, detSheet: any) => {
    // 'Tarifas!$D:$D' -> valores das linhas de dados daquela coluna.
    const colunaTarifas = (ref: string) => {
      const m = /^Tarifas!\$([A-Z]+):\$([A-Z]+)$/.exec(ref.trim());
      if (!m || m[1] !== m[2]) throw new Error('range inesperado: ' + ref);
      const vals: any[] = [];
      for (let r = 2; r <= tarSheet.actualRowCount; r++) vals.push(tarSheet.getCell(m[1] + r).value);
      return vals;
    };

    // Critério: literal entre aspas, ou referência a célula da aba de detalhe.
    // O caso decisivo é a referência a célula VAZIA — o Excel converte para 0.
    const criterioDe = (arg: string) => {
      const t = arg.trim();
      if (t.startsWith('"')) {
        return { tipo: 'texto' as const, valor: t.slice(1, -1).replace(/""/g, '"').replace(/~([*?~])/g, '$1') };
      }
      const v = detSheet.getCell(t).value;
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

    /**
     * Avalia uma fórmula `L{n}*SUMIFS(...)` com as tarifas informadas por linha
     * da aba Tarifas. Separado de `avaliarValor` para o bloco [D5] avaliar a
     * parte interna do IF da linha sem horas com o MESMO motor.
     */
    const avaliarHorasVezesTarifa = (f: string, tarifasPorLinha: (number | null)[]) => {
      const m = /^L(\d+)\*SUMIFS\((.*)\)$/.exec(f);
      if (!m) throw new Error('fórmula fora do formato esperado: ' + f);
      const args = splitArgs(m[2]);
      const somaCol = colunaTarifas(args[0]).map((_v, i) => tarifasPorLinha[i] ?? null);
      let total = 0;
      for (let i = 0; i < somaCol.length; i++) {
        let bate = true;
        for (let a = 1; a < args.length; a += 2) {
          if (!casa(colunaTarifas(args[a])[i], criterioDe(args[a + 1]))) { bate = false; break; }
        }
        if (bate) total += Number(somaCol[i] ?? 0);
      }
      return Number(detSheet.getCell('L' + m[1]).value ?? 0) * total;
    };

    /** Avalia M{rowIdx} (hora/aula) com as tarifas informadas por linha da aba Tarifas. */
    const avaliarValor = (rowIdx: number, tarifasPorLinha: (number | null)[]) =>
      avaliarHorasVezesTarifa(String(formula(detSheet, 'M' + rowIdx)), tarifasPorLinha);

    return { casa, criterioDe, avaliarValor, avaliarHorasVezesTarifa };
  };

  const { casa, criterioDe, avaliarValor } = criarAvaliador(tarReg, detReg);

  // O caso do bug: R$ 50,00 digitado em F2, 8h na linha 4 do detalhe (1ª de dados).
  checkEq('tarifa em F2 (1a linha de Tarifas) chega na 1a linha do detalhe: 8h x 50', avaliarValor(4, [50]), 400);
  checkEq('e tambem na 2a linha, mesma combinacao: 4h x 50', avaliarValor(5, [50]), 200);
  checkEq('sem tarifa preenchida o valor e 0 (e nao um numero errado)', avaliarValor(4, [null]), 0);

  // Contraprova de que o avaliador NAO e complacente: chave divergente nao casa.
  check('avaliador rejeita chave divergente (Sim x Nao)', casa('Sim', criterioDe('Q4')) === false);

  /* ---- D4: papel é a 5ª chave — mesma pessoa, dois papéis, duas tarifas ---- */
  //
  // O caso que a decisão D4 resolve: o instrutor deu uma demanda para a VALE e
  // acompanhou outra da MESMA VALE. Sem o papel na chave, as duas linhas do
  // detalhe cairiam na mesma tarifa — a hora de quem acompanha seria paga como
  // a hora de quem ministra.
  const wbD4 = await buildMedicaoWorkbook(
    comDefaults([{
      instructorId: 'i9', nome: 'Carla Nogueira', cpf: '',
      linhas: [
        { demandId: 'DEM-1500', empresa: 'VALE', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Titular' as const },
        { demandId: 'DEM-1501', empresa: 'VALE', trainingName: 'NR 33', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, categoria: '', tipo: 'Treinamento' as const, noturno: false, papel: 'Acompanhante' as const },
      ],
    }]) as any,
    periodo
  );

  const bufD4 = await wbD4.xlsx.writeBuffer();
  const wbLidoD4 = new ExcelJSModule.default.Workbook();
  await wbLidoD4.xlsx.load(bufD4 as any);
  const tarD4 = wbLidoD4.getWorksheet('Tarifas');
  const detD4 = wbLidoD4.getWorksheet('Carla Nogueira');

  checkEq(
    'mesma pessoa + mesma empresa em papéis diferentes = DUAS linhas de tarifa',
    tarD4.actualRowCount - 1,
    2
  );
  checkEq(
    'e os papéis saem rotulados nas duas',
    [texto(tarD4, 'E2'), texto(tarD4, 'E3')].sort().join('|'),
    'Acompanhante|Titular'
  );

  const avalD4 = criarAvaliador(tarD4, detD4);
  // Tarifas: R$ 100 na linha do Acompanhante (2, alfabética) e R$ 200 na do
  // Titular (3). Cada linha do detalhe tem de puxar a SUA.
  const linhaAcomp = texto(tarD4, 'E2') === 'Acompanhante' ? 0 : 1;
  const tarifasD4: (number | null)[] = [null, null];
  tarifasD4[linhaAcomp] = 100;
  tarifasD4[1 - linhaAcomp] = 200;

  // Papel em R; dados da linha 4.
  const linhaDetTitular = texto(detD4, 'R4') === 'Titular' ? 4 : 5;
  const linhaDetAcomp = linhaDetTitular === 4 ? 5 : 4;
  checkEq(
    'linha de quem MINISTRA puxa a tarifa de Titular: 8h x 200',
    avalD4.avaliarValor(linhaDetTitular, tarifasD4),
    1600
  );
  checkEq(
    'linha de quem ACOMPANHA puxa a de Acompanhante: 4h x 100',
    avalD4.avaliarValor(linhaDetAcomp, tarifasD4),
    400
  );
  // Contraprova direta da D4: sem a tarifa do acompanhante preenchida, a linha
  // dele vale 0 — NUNCA herda a do titular.
  const soTitular: (number | null)[] = [null, null];
  soTitular[1 - linhaAcomp] = 200;
  checkEq(
    'sem tarifa de acompanhante a linha dele é 0 (não herda a do titular)',
    avalD4.avaliarValor(linhaDetAcomp, soTitular),
    0
  );
  checkEq(
    'e a do titular continua certa no mesmo cenário',
    avalD4.avaliarValor(linhaDetTitular, soTitular),
    1600
  );

  /* ======================================================================== */
  /* [D5] Layout novo: despesas por categoria, acompanhante sem horas,        */
  /*      Resumo fecha com Σ das abas em recálculo real (com texto no meio)   */
  /* ======================================================================== */
  console.log('\n[D5] Despesas a reembolsar, acompanhante sem horas e Resumo fechando');

  const R = (o: Partial<{ hospedagem: number; locomocao: number; alimentacao: number; outros: number }>) => {
    const b = { hospedagem: 0, locomocao: 0, alimentacao: 0, outros: 0, ...o };
    return { ...b, total: b.hospedagem + b.locomocao + b.alimentacao + b.outros };
  };
  // Diego: uma demanda como titular COM reembolso, e um acompanhamento SEM
  // horas informadas mas COM despesa dele. Elisa: só hora/aula, sem despesa.
  const wbD5 = await buildMedicaoWorkbook(
    [
      {
        instructorId: 'j1', nome: 'Diego Reembolso', cpf: '111.222.333-96',
        linhas: [
          { demandId: 'DEM-300', empresa: 'VALE', trainingName: 'NR 35', dias: ['2026-07-06'], local: 'BH - MG', modalidade: 'Presencial', horas: 8, horasInformadas: true, reembolso: R({ hospedagem: 300, locomocao: 80 }), categoria: '', tipo: 'Treinamento', noturno: false, papel: 'Titular' },
          { demandId: 'DEM-301', empresa: 'VALE', trainingName: 'NR 33', dias: ['2026-07-08'], local: 'BH - MG', modalidade: 'Presencial', horas: null, horasInformadas: false, reembolso: R({ alimentacao: 40 }), categoria: '', tipo: 'Treinamento', noturno: false, papel: 'Acompanhante' },
        ],
      },
      {
        instructorId: 'j2', nome: 'Elisa Semdespesa', cpf: '',
        linhas: [
          { demandId: 'DEM-302', empresa: 'VALE', trainingName: 'NR 10', dias: ['2026-07-07'], local: 'BH - MG', modalidade: 'Presencial', horas: 4, horasInformadas: true, reembolso: R({}), categoria: '', tipo: 'Treinamento', noturno: false, papel: 'Titular' },
          // Híbrida sem horas presenciais informadas: linha normal, Horas em branco.
          { demandId: 'DEM-303', empresa: 'VALE', trainingName: 'CIPA Mineração', dias: ['2026-07-09', '2026-07-10'], local: 'BH - MG', modalidade: 'Híbrido', horas: null, horasInformadas: false, motivoSemHoras: 'HIBRIDA', reembolso: R({}), categoria: '', tipo: 'Treinamento', noturno: false, papel: 'Titular' },
        ],
      },
    ] as any,
    periodo
  );
  const bufD5 = await wbD5.xlsx.writeBuffer();
  const lidoD5 = new ExcelJSModule.default.Workbook();
  await lidoD5.xlsx.load(bufD5 as any);
  const tarD5 = lidoD5.getWorksheet('Tarifas');
  const resD5 = lidoD5.getWorksheet('Resumo');
  const diego = lidoD5.getWorksheet('Diego Reembolso');
  const elisa = lidoD5.getWorksheet('Elisa Semdespesa');

  /* ---- despesas por categoria: números, na ordem do painel ---- */
  checkEq('titular: Hospedagem 300 em G', diego.getCell('G4').value, 300);
  checkEq('titular: Transporte 80 em H', diego.getCell('H4').value, 80);
  checkEq('titular: Alimentação 0 em I', diego.getCell('I4').value, 0);
  checkEq('titular: Outros 0 em J', diego.getCell('J4').value, 0);
  checkEq('titular: Total despesas é SUM(G4:J4)', formula(diego, 'K4'), 'SUM(G4:J4)');
  checkEq('titular: horas 8 em L', diego.getCell('L4').value, 8);
  check('titular: hora/aula é a fórmula de sempre (sem IF)', String(formula(diego, 'M4')).startsWith('L4*SUMIFS('));
  checkEq('titular: Total é SUM(K4,M4)', formula(diego, 'N4'), 'SUM(K4,M4)');
  checkEq('sem despesa: as quatro colunas zeradas, não vazias', ['G4', 'H4', 'I4', 'J4'].map(a => elisa.getCell(a).value).join(','), '0,0,0,0');

  /* ---- acompanhante sem horas: célula vazia, amarela, destravada; texto no hora/aula ---- */
  const l5 = diego.getCell('L5');
  check('acompanhante: Horas em BRANCO (não 0)', l5.value === null || l5.value === undefined);
  check('acompanhante: Horas destravada', l5.protection?.locked === false);
  checkEq('acompanhante: Horas amarela', l5.fill?.fgColor?.argb, 'FFFFFF00');
  check('acompanhante: Horas tem nota explicando', !!l5.note);
  checkEq(
    'acompanhante: hora/aula mostra o texto até digitarem, com a fórmula de sempre dentro',
    formula(diego, 'M5'),
    'IF(L5="","horas não informadas",L5*SUMIFS(Tarifas!$F:$F,Tarifas!$A:$A,"Diego Reembolso",Tarifas!$B:$B,B5,Tarifas!$C:$C,O5,Tarifas!$D:$D,Q5,Tarifas!$E:$E,R5))'
  );
  checkEq('acompanhante: Total é SUM (texto no M não dá #VALUE!)', formula(diego, 'N5'), 'SUM(K5,M5)');
  checkEq('acompanhante: Papel = Acompanhante', texto(diego, 'R5'), 'Acompanhante');
  checkEq('acompanhante: a despesa dele aparece mesmo sem horas', diego.getCell('I5').value, 40);
  check(
    'acompanhante: a linha de tarifa dele existe (o valor calcula assim que digitarem as horas)',
    tarD5.getRows(2, tarD5.actualRowCount - 1).some((r: any) => String(r.getCell(1).value) === 'Diego Reembolso' && String(r.getCell(5).value) === 'Acompanhante')
  );
  checkEq('totais da aba: uma linha abaixo dos dados', [formula(diego, 'K6'), formula(diego, 'L6'), formula(diego, 'M6'), formula(diego, 'N6')].join(' | '), 'SUM(K4:K5) | SUM(L4:L5) | SUM(M4:M5) | SUM(N4:N5)');

  /* ---- híbrida sem horas presenciais: linha normal, Horas em branco, texto próprio ---- */
  const l5e = elisa.getCell('L5');
  checkEq('híbrida: a linha existe, com Modalidade Híbrido', texto(elisa, 'F5'), 'Híbrido');
  check('híbrida: Horas em BRANCO (não o rateio)', l5e.value === null || l5e.value === undefined);
  check('híbrida: Horas destravada e amarela', l5e.protection?.locked === false && l5e.fill?.fgColor?.argb === 'FFFFFF00');
  checkEq(
    'híbrida: hora/aula mostra o texto da híbrida (não o do acompanhante) até digitarem',
    formula(elisa, 'M5'),
    'IF(L5="","híbrida: informe as horas presenciais realizadas",L5*SUMIFS(Tarifas!$F:$F,Tarifas!$A:$A,"Elisa Semdespesa",Tarifas!$B:$B,B5,Tarifas!$C:$C,O5,Tarifas!$D:$D,Q5,Tarifas!$E:$E,R5))'
  );
  checkEq('híbrida: Total é SUM (texto não dá #VALUE!)', formula(elisa, 'N5'), 'SUM(K5,M5)');
  checkEq('híbrida: Papel continua Titular', texto(elisa, 'R5'), 'Titular');
  checkEq('Resumo: Horas pendentes = COUNTIF das células de Horas em branco', [formula(resD5, 'G3'), formula(resD5, 'G4'), formula(resD5, 'G5')].join(' | '),
    "COUNTIF('Diego Reembolso'!L4:L5,\"\") | COUNTIF('Elisa Semdespesa'!L4:L5,\"\") | SUM(G3:G4)");

  /* ---- Resumo aponta para as colunas certas ---- */
  checkEq('Resumo: Diego na linha 3 com as quatro somas', [formula(resD5, 'B3'), formula(resD5, 'C3'), formula(resD5, 'D3'), formula(resD5, 'E3')].join(' | '),
    "SUM('Diego Reembolso'!L4:L5) | SUM('Diego Reembolso'!M4:M5) | SUM('Diego Reembolso'!K4:K5) | SUM('Diego Reembolso'!N4:N5)");

  /* ---- proteção: a única célula nova destravada é a Horas do acompanhante ---- */
  {
    let destravadasD5 = 0;
    let formulaDestravadaD5 = 0;
    for (const ws of lidoD5.worksheets) {
      ws.eachRow((row: any) => row.eachCell({ includeEmpty: true }, (cell: any) => {
        const temFormula = cell.value && typeof cell.value === 'object' && 'formula' in cell.value;
        if (cell.protection?.locked === false) { destravadasD5++; if (temFormula) formulaDestravadaD5++; }
      }));
    }
    // 3 tarifas (Diego Titular, Diego Acompanhante, Elisa) + 2 dados bancários
    // + 1 Horas do acompanhante + 1 Horas da híbrida
    checkEq('destravadas = tarifas + dados bancários + Horas do acompanhante + Horas da híbrida', destravadasD5, 7);
    checkEq('nenhuma fórmula destravada', formulaDestravadaD5, 0);
  }

  /* ---- RECÁLCULO REAL: avalia as fórmulas como saíram do arquivo ---- */
  // Tarifas preenchidas por linha da aba Tarifas (a ordem é a da aba).
  const tarifaD5 = (r: any) => {
    const k = `${r.getCell(1).value}|${r.getCell(5).value}`;
    return ({ 'Diego Reembolso|Titular': 100, 'Diego Reembolso|Acompanhante': 60, 'Elisa Semdespesa|Titular': 50 } as Record<string, number>)[k] ?? null;
  };
  const tarifasD5: (number | null)[] = tarD5.getRows(2, tarD5.actualRowCount - 1).map(tarifaD5);

  // Avaliador mínimo: SUM(range) / SUM(a,b) / IF(L="",texto,inner) / L*SUMIFS,
  // com referências a outra aba ('Nome'!A1:A2). Texto NÃO soma — é o que o
  // Excel faz, e é o que a linha do acompanhante depende.
  const evalCell = (ws: any, addr: string): number | string | null => {
    const v = ws.getCell(addr).value;
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'object' && 'formula' in v) return evalFormula(ws, String(v.formula));
    return null;
  };
  const refToSheet = (ref: string): [any, string] => {
    const m = /^'([^']+)'!(.+)$/.exec(ref) ?? /^([A-Za-z]+)!(.+)$/.exec(ref);
    if (m) return [lidoD5.getWorksheet(m[1]), m[2]];
    return [null, ref];
  };
  const evalFormula = (ws: any, f: string): number | string | null => {
    let m = /^SUM\((.+)\)$/.exec(f);
    if (m) {
      let total = 0;
      for (const arg of splitArgs(m[1])) {
        const [sheet, ref] = refToSheet(arg.trim());
        const target = sheet ?? ws;
        const rng = /^([A-Z])(\d+):([A-Z])(\d+)$/.exec(ref);
        const addrs: string[] = [];
        if (rng) {
          // Range vertical (L4:L5) ou horizontal (G4:J4): percorre as duas dimensões.
          for (let c = rng[1].charCodeAt(0); c <= rng[3].charCodeAt(0); c++) {
            for (let r = Number(rng[2]); r <= Number(rng[4]); r++) addrs.push(String.fromCharCode(c) + r);
          }
        } else addrs.push(ref);
        for (const a of addrs) { const x = evalCell(target, a); if (typeof x === 'number') total += x; }
      }
      return total;
    }
    m = /^IF\(([A-Z]+\d+)="","([^"]*)",(.+)\)$/.exec(f);
    if (m) {
      const h = evalCell(ws, m[1]);
      if (h === null || h === '') return m[2];
      return criarAvaliador(tarD5, ws).avaliarHorasVezesTarifa(m[3], tarifasD5);
    }
    if (/^L\d+\*SUMIFS\(/.test(f)) return criarAvaliador(tarD5, ws).avaliarHorasVezesTarifa(f, tarifasD5);
    m = /^COUNTIF\((.+),""\)$/.exec(f);
    if (m) {
      // COUNTIF(range,""): células vazias do range (é a Horas pendentes do Resumo).
      const [sheet, ref] = refToSheet(m[1].trim());
      const rng = /^([A-Z])(\d+):([A-Z])(\d+)$/.exec(ref)!;
      let vazias = 0;
      for (let r = Number(rng[2]); r <= Number(rng[4]); r++) {
        const x = evalCell(sheet ?? ws, rng[1] + r);
        if (x === null || x === '') vazias++;
      }
      return vazias;
    }
    if (/^COUNTIFS\(/.test(f)) return 0; // fora do escopo deste recálculo
    throw new Error('fórmula não suportada pelo avaliador do smoke: ' + f);
  };

  checkEq('recálculo: titular K4 = 380', evalCell(diego, 'K4'), 380);
  checkEq('recálculo: titular M4 = 8h × 100', evalCell(diego, 'M4'), 800);
  checkEq('recálculo: titular N4 = 380 + 800', evalCell(diego, 'N4'), 1180);
  checkEq('recálculo: acompanhante M5 é o TEXTO', evalCell(diego, 'M5'), 'horas não informadas');
  checkEq('recálculo: acompanhante N5 = só as despesas (40), texto ignorado', evalCell(diego, 'N5'), 40);
  checkEq('recálculo: total da aba M6 = 800 (texto não soma)', evalCell(diego, 'M6'), 800);
  checkEq('recálculo: Resumo B3 (horas) = 8', evalCell(resD5, 'B3'), 8);
  checkEq('recálculo: Resumo C3 (hora/aula) = 800', evalCell(resD5, 'C3'), 800);
  checkEq('recálculo: Resumo D3 (despesas a reembolsar) = 420', evalCell(resD5, 'D3'), 420);
  checkEq('recálculo: Resumo E3 (total a pagar) = 1220', evalCell(resD5, 'E3'), 1220);
  checkEq('recálculo: Total a pagar = Hora/aula + Despesas (fecha)', evalCell(resD5, 'E3'), Number(evalCell(resD5, 'C3')) + Number(evalCell(resD5, 'D3')));
  checkEq('recálculo: Elisa E4 = 4h × 50, sem despesa', evalCell(resD5, 'E4'), 200);
  checkEq('recálculo: TOTAL GERAL E5 = Σ abas (1420)', evalCell(resD5, 'E5'), 1420);
  checkEq('recálculo: TOTAL GERAL fecha com C5 + D5', evalCell(resD5, 'E5'), Number(evalCell(resD5, 'C5')) + Number(evalCell(resD5, 'D5')));

  checkEq('recálculo: híbrida M5 é o TEXTO da híbrida', evalCell(elisa, 'M5'), 'híbrida: informe as horas presenciais realizadas');
  checkEq('recálculo: Elisa E4 continua 200 (a híbrida em branco não soma nem quebra)', evalCell(resD5, 'E4'), 200);
  checkEq('recálculo: Horas pendentes do Diego = 1 (acompanhante)', evalCell(resD5, 'G3'), 1);
  checkEq('recálculo: Horas pendentes da Elisa = 1 (híbrida)', evalCell(resD5, 'G4'), 1);
  checkEq('recálculo: TOTAL GERAL de horas pendentes = 2', evalCell(resD5, 'G5'), 2);

  // E quando alguém DIGITA as horas do acompanhante, o texto some e o valor entra
  // com a tarifa DELE (60), não a do titular.
  diego.getCell('L5').value = 3;
  checkEq('recálculo: horas digitadas na célula amarela → 3h × 60 (tarifa de Acompanhante)', evalCell(diego, 'M5'), 180);
  checkEq('recálculo: e o Total a pagar do Diego passa a 1400', evalCell(resD5, 'E3'), 1400);
  checkEq('recálculo: e as Horas pendentes do Diego caem a 0', evalCell(resD5, 'G3'), 0);

  // Idem na híbrida: horas presenciais digitadas → tarifa de Titular (50).
  elisa.getCell('L5').value = 6;
  checkEq('recálculo: horas presenciais digitadas → 6h × 50', evalCell(elisa, 'M5'), 300);
  checkEq('recálculo: Total a pagar da Elisa passa a 500', evalCell(resD5, 'E4'), 500);
  checkEq('recálculo: TOTAL GERAL de horas pendentes zera', evalCell(resD5, 'G5'), 0);

  /* ======================================================================== */
  /* Item de despesa do Painel: nome/link do anexo                            */
  /* ======================================================================== */
  //
  // O bug: a notinha anexada em Cafe/Almoco/Jantar/Outros aparecia sem link. A
  // causa era layout (a linha nao cabia na coluna estreita e o nome era o unico
  // elemento encolhivel), mas a montagem do item tem regra propria — e e ela
  // que decide entre link, texto simples e rotulo neutro. E o que da para
  // travar aqui, sem DOM.
  //
  // ⚠️ A resolucao NAO olha categoria. Se alguem introduzir um ramo por
  // categoria, o primeiro bloco abaixo pega — ele roda a MESMA asserção para
  // as seis.

  console.log('\n— Item de despesa: nome e link do anexo');

  const PUB = 'https://xyz.supabase.co/storage/v1/object/public';
  const resolveStorageUrl = (bucket: string, path: string) => `${PUB}/${bucket}/${path}`;

  const CATEGORIAS = ['HOSPEDAGEM', 'LOCOMOCAO', 'CAFE', 'ALMOCO', 'JANTAR', 'OUTROS'];

  {
    // 1. Item com arquivo completo — o caso normal do upload.
    for (const cat of CATEGORIAS) {
      const r = resolveAttachmentLink({
        name: 'nota-fiscal.pdf',
        url: `${PUB}/measurement-attachments/measurements/DEM-1/FILE-1-nota-fiscal.pdf`,
        type: 'application/pdf',
        bucket: 'measurement-attachments',
        path: 'measurements/DEM-1/FILE-1-nota-fiscal.pdf',
      });
      check(
        `[${cat}] arquivo completo vira LINK com o nome do arquivo`,
        r.kind === 'link' && r.label === 'nota-fiscal.pdf' && (r as any).href.endsWith('nota-fiscal.pdf')
      );
    }
  }

  {
    // 2. Valor avulso — nunca teve arquivo, NAO pode virar link.
    //    E exatamente o que handleAddManualValue grava.
    for (const cat of CATEGORIAS) {
      const r = resolveAttachmentLink({
        name: 'Lançamento Avulso',
        url: '#',
        type: 'text/plain',
      });
      check(
        `[${cat}] valor avulso NAO mostra link (texto simples)`,
        r.kind === 'plain' && r.label === 'Lançamento Avulso'
      );
    }
  }

  {
    // 3. Referencia ausente — item de arquivo que perdeu url e path.
    //    Nao pode virar link morto; rotulo neutro.
    const r = resolveAttachmentLink({
      name: 'recibo-almoco.jpg',
      url: '#',
      type: 'image/jpeg',
    });
    check('referencia ausente NAO vira link', r.kind === 'unlinked');
    check('referencia ausente mantem o nome conhecido como rotulo', r.label === 'recibo-almoco.jpg');

    const semNome = resolveAttachmentLink({ url: '', type: 'image/png' });
    checkEq('referencia ausente e sem nome cai no rotulo neutro', semNome.label, UNLINKED_LABEL);
    check('referencia ausente e sem nome tambem nao vira link', semNome.kind === 'unlinked');
  }

  {
    // 4. Reconciliacao em leitura: url perdida, mas bucket + path sobreviveram.
    //    Reconstroi o destino sem gravar nada (sem backfill, sem migration).
    const r = resolveAttachmentLink(
      {
        name: 'cupom.jpg',
        url: '#',
        type: 'image/jpeg',
        bucket: 'measurement-attachments',
        path: 'measurements/DEM-9/FILE-9-cupom.jpg',
      },
      { resolveStorageUrl }
    );
    check('url perdida + bucket/path presentes: reconstroi o LINK', r.kind === 'link');
    checkEq(
      'link reconstruido aponta para o objeto certo',
      (r as any).href,
      `${PUB}/measurement-attachments/measurements/DEM-9/FILE-9-cupom.jpg`
    );

    // Sem o resolvedor injetado, degrada para rotulo neutro — nunca link morto.
    const semResolver = resolveAttachmentLink({
      name: 'cupom.jpg', url: '#', type: 'image/jpeg',
      bucket: 'measurement-attachments', path: 'measurements/DEM-9/FILE-9-cupom.jpg',
    });
    check('sem resolvedor de storage, degrada para rotulo neutro (nao link morto)', semResolver.kind === 'unlinked');
  }


  
/* ══════════════════════════════════════════════════════════════════════════ */
/* [9] O override só age sobre demanda ELEGÍVEL para o export                 */
/* ══════════════════════════════════════════════════════════════════════════ */
//
// O bug: o export de 09/2026 trouxe o acompanhante de uma demanda ALOCADA e o
// titular + participante de outra, também ALOCADA — enquanto o titular da
// primeira, que passa pelo rateio, corretamente NÃO aparecia. Eram duas regras
// de elegibilidade para a mesma planilha: o rateio filtrava por status e
// período, e o override varria TODA medição com blocos.
console.log('\n[9] Override respeita o recorte do export');
{
  const diaRelativo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Duas demandas iguais em tudo, menos a data: uma no passado (CONCLUÍDA) e
  // outra no futuro (ALOCADA). O status é derivado, não digitado.
  const passado = diaRelativo(-30);
  const futuro = diaRelativo(30);

  const demandaBase = {
    tipo: 'interna',
    dateMode: 'CONTINUO',
    modality: 'PRESENCIAL',
    trainingLocal: 'BH - MG',
    instructorId: 'TITULAR',
    horasPrevistas: 8,
  };
  const concluida: any = { ...demandaBase, id: 'DEM-OK', startDate: passado + 'T08:00', endDate: passado + 'T18:00' };
  const alocada: any = { ...demandaBase, id: 'DEM-FUT', startDate: futuro + 'T08:00', endDate: futuro + 'T18:00' };

  const medicaoV2 = (demandId: string) => ({
    demandId,
    attachments: [],
    expenses: {
      classHours: 8, hourRate: 0,
      participantes: [
        { instructorId: 'TITULAR', papel: 'TITULAR' },
        { instructorId: 'PART', papel: 'PARTICIPANTE' },
      ],
    },
  });

  /* --- o conjunto elegível --- */
  const elegiveis = eligibleDemandIdsForPayment({
    demands: [concluida, alocada],
    trainings: [],
  });
  check('demanda CONCLUÍDA é elegível', elegiveis.has('DEM-OK'));
  check('demanda ALOCADA não é', !elegiveis.has('DEM-FUT'));

  const forasDoPeriodo = eligibleDemandIdsForPayment({
    demands: [concluida, alocada],
    trainings: [],
    periodStart: '2000-01-01',
    periodEnd: '2000-01-31',
  });
  checkEq('e nenhuma delas entra num período que não é o delas', forasDoPeriodo.size, 0);

  /* --- a medição da ALOCADA não põe ninguém na planilha --- */
  const rowsAlocada = applyMeasurementOverrides({
    rows: [],
    measurements: [medicaoV2('DEM-FUT')] as any,
    demands: [alocada],
    eligibleDemandIds: elegiveis,
  });
  checkEq('medição v2 de demanda ALOCADA gera ZERO linhas', rowsAlocada.length, 0);

  // CONTRAPROVA: sem o conjunto, o override volta a varrer tudo — é o bug.
  const semRecorte = applyMeasurementOverrides({
    rows: [],
    measurements: [medicaoV2('DEM-FUT')] as any,
    demands: [alocada],
  });
  check(
    '(contraprova) sem o conjunto elegível, a ALOCADA voltaria à planilha',
    semRecorte.length > 0
  );

  /* --- a mesma medição, na demanda CONCLUÍDA, entra --- */
  const rowsConcluida = applyMeasurementOverrides({
    rows: [
      { instructorId: 'TITULAR', demandId: 'DEM-OK', horas: 8, dias: [passado], dividida: false },
    ],
    measurements: [medicaoV2('DEM-OK')] as any,
    demands: [concluida],
    eligibleDemandIds: elegiveis,
  });
  checkEq(
    'a mesma medição numa demanda CONCLUÍDA entra',
    rowsConcluida.map(r => r.instructorId).sort().join(','),
    'PART,TITULAR'
  );
  checkEq('com o titular pelo rateio', rowsConcluida.find(r => r.instructorId === 'TITULAR')?.horas, 8);
  checkEq('e o participante pela carga da demanda', rowsConcluida.find(r => r.instructorId === 'PART')?.horas, 8);

  /* --- acompanhante de demanda não elegível também fica de fora --- */
  const comAcompanhante = applyMeasurementOverrides({
    rows: [],
    measurements: [{
      demandId: 'DEM-FUT',
      attachments: [],
      expenses: {
        classHours: 8, hourRate: 0,
        participantes: [
          { instructorId: 'TITULAR', papel: 'TITULAR' },
          { instructorId: 'ACOMP', papel: 'ACOMPANHANTE', horas: 4 },
        ],
      },
    }] as any,
    demands: [{ ...alocada, tipo: 'cliente' }],
    companions: [{ demandId: 'DEM-FUT', instructorId: 'ACOMP', startDate: futuro + 'T08:00' }],
    eligibleDemandIds: elegiveis,
  });
  checkEq('acompanhante de demanda ALOCADA não entra', comAcompanhante.length, 0);

  /* --- guarda de fonte: o serviço passa o conjunto --- */
  const svc = ler('services/medicaoExportService.ts');
  check(
    'o export calcula o conjunto elegível...',
    svc.includes('eligibleDemandIdsForPayment({')
  );
  // O conjunto é calculado UMA vez e entregue ao override e à linha do
  // acompanhante sem horas — os dois recortam pela mesma elegibilidade.
  check(
    '...e o entrega ao override',
    svc.includes('const eligibleDemandIds = eligibleDemandIdsForPayment({') &&
      /applyMeasurementOverrides\(\{[\s\S]{0,900}eligibleDemandIds,/.test(svc)
  );
  check(
    '...e à montagem da linha do acompanhante sem horas (mesmo Set)',
    /buildCompanionRowsWithoutHours\(\{[\s\S]{0,200}eligibleDemandIds,/.test(svc)
  );
  check(
    'com o MESMO período do rateio',
    /eligibleDemandIdsForPayment\(\{[\s\S]{0,200}periodStart: dataInicio,[\s\S]{0,60}periodEnd: dataFim,/.test(svc)
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* [10] Rótulo da interna: planilha e app dizem a mesma coisa                 */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n[10] Rótulo de empresa da demanda interna');
{
  const empresas = [{ id: 'C1', name: 'Vale' }];

  checkEq(
    'interna sem empresa vinculada usa o rótulo do app',
    getDemandCompanyLabel({ tipo: 'interna' } as any, empresas),
    'Colabor (Interna)'
  );
  checkEq(
    'interna COM empresa mostra a empresa',
    getDemandCompanyLabel({ tipo: 'interna', companyId: 'C1' } as any, empresas),
    'Vale'
  );
  check(
    'e o rótulo é a constante do domínio, não um literal solto',
    getDemandCompanyLabel({ tipo: 'interna' } as any, empresas) === INTERNAL_COMPANY_LABEL
  );

  /* --- guarda de fonte: o export reusa a função, não reimplementa --- */
  const svc = ler('services/medicaoExportService.ts');
  check(
    'o export usa getDemandCompanyLabel para a interna',
    svc.includes('getDemandCompanyLabel(demand, companiesParaLabel)')
  );
  check(
    'e o rótulo entra na MESMA função que alimenta a chave de tarifa',
    svc.includes('empresa: nomeEmpresa(demand),')
  );
  check(
    'cliente sem empresa continua diagnosticando o caso ruim',
    svc.includes("if (!demand.companyId) return '(sem empresa)';") &&
      svc.includes("return '(empresa não encontrada)';")
  );
}

console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => {
  console.error('ERRO NÃO TRATADO:', e);
  process.exit(1);
});
