/**
 * TEMPLATE DE MEDIÇÃO — VALE (em código, primeiro exemplo)
 *
 * Extraído do modelo `public/templates/vale.xlsx` em 16/09/2026 (duas abas:
 * "Turmas Realizadas" e "Plantas"). O arquivo é a fonte: cabeçalhos com os
 * espaços que ele tem, fórmulas de valor total e total de despesas como ele
 * grava, 0,2 no % de despesa, totais em carga, valor e despesas. Em
 * 20/10/2026 "Data"/"Horário" viraram quatro colunas (início e fim, E..H) e
 * o arquivo-base ganhou as mesmas — ele e esta lista precisam ter as mesmas
 * colunas na mesma ordem, porque o escritor copia o cabeçalho e os estilos
 * do arquivo por posição (smoke:medicao-vale confere). Divergências aprovadas
 * em relação ao arquivo original:
 *   • o total de valor no modelo somava só as 4 primeiras linhas (erro do
 *     modelo) — aqui soma a faixa real, como as outras colunas;
 *   • a linha de totais vai logo abaixo da última turma (o modelo a fixa na
 *     33, com 31 linhas pré-formatadas); sobras são removidas pelo escritor;
 *   • Data grava data de verdade com dd/mm/yyyy (o modelo usa o formato
 *     embutido dependente do idioma);
 *   • o preço ganha formato de moeda (o modelo não tem);
 *   • ID da Turma, horários e preço em amarelo quando saem vazios.
 * Sem proteção, sem congelamento, sem autofiltro — como o arquivo.
 *
 * Fórmulas SÓ por chave de coluna ({col:key}); o smoke reprova letra literal.
 * A aba Plantas é copiada do arquivo-base, sem cruzamento com dados do app.
 */
import type { MeasurementTemplate, TemplateColumn } from './types';

export const VALE_TEMPLATE_ID = 'vale-v1';

const CURRENCY = 'currency' as const;

export const VALE_TURMAS_COLUMNS: TemplateColumn[] = [
  { key: 'anexo', header: 'Número do anexo', source: 'sequence', format: 'integer' },
  { key: 'idTurma', header: 'ID da Turma', source: 'demand.clientDemandId', format: 'text', highlightWhenEmpty: true },
  { key: 'treinamento', header: 'Treinamento', source: 'training.name', format: 'text' },
  { key: 'local', header: 'Local Treinamento ', source: 'demand.local', format: 'text' },
  // Início e fim (20/10/2026): a data fim é o último dia REAL — o mesmo pelo
  // qual o filtro de período escolhe a medição. Horário ausente sai em branco
  // e amarelo, nunca inventado (o dataset lê os horários crus).
  { key: 'dataInicio', header: 'Data início', source: 'demand.dataInicio', format: 'date' },
  { key: 'dataFim', header: 'Data fim', source: 'demand.dataFim', format: 'date' },
  { key: 'horarioInicio', header: 'Horário início', source: 'demand.horarioInicio', format: 'time', highlightWhenEmpty: true },
  { key: 'horarioFim', header: 'Horário fim', source: 'demand.horarioFim', format: 'time', highlightWhenEmpty: true },
  // Carga em branco (híbrida sem horas práticas válidas) sai amarela, com aviso.
  { key: 'cargaHoraria', header: 'Carga horária', source: 'demand.cargaHoraria', format: 'hours', highlightWhenEmpty: true },
  {
    key: 'precoHH',
    header: 'Preço unitário HH',
    source: 'manual',
    format: CURRENCY,
    editable: true,
    persistScope: 'training',
    overrideScope: 'demand',
    highlightWhenEmpty: true,
    // Híbrida: um preço por parte, nas mesmas chaves de persistência de
    // sempre (treinamento / sobrescrita na turma). O `precoHH` único de um
    // treinamento híbrido NÃO vale para as partes — ver pendencias.ts.
    hybridKeys: { presencial: 'precoHHPresencial', online: 'precoHHOnline' },
  },
  {
    key: 'valorTotal',
    header: 'Valor total do treinamento',
    source: 'formula',
    formula: '={col:cargaHoraria}{row}*{col:precoHH}{row}',
    format: CURRENCY,
  },
  // Despesas: na híbrida saem UMA vez, na linha presencial (`hybridOnline`).
  { key: 'locacao', header: 'Despesa reembolsável (locação veículo/táxi)', source: 'expenses.locomocao', format: CURRENCY, hybridOnline: 'zero' },
  {
    key: 'combustivel',
    header: 'Despesa reembolsável (combustível)',
    source: 'manual',
    format: CURRENCY,
    defaultValue: 0,
    editable: true,
    persistScope: 'demand',
    hybridOnline: 'zero',
  },
  { key: 'alimentacao', header: 'Despesa reembolsável (alimentação)', source: 'expenses.alimentacao', format: CURRENCY, hybridOnline: 'zero' },
  { key: 'hospedagem', header: 'Despesa reembolsável (hospedagem)', source: 'expenses.hospedagem', format: CURRENCY, hybridOnline: 'zero' },
  { key: 'outros', header: 'Despesa reembolsável (outros)', source: 'expenses.outros', format: CURRENCY, hybridOnline: 'zero' },
  {
    key: 'pctDespesa',
    header: '% despesa reembolsável',
    source: 'manual',
    format: 'percent',
    defaultValue: 0.2,
    editable: true,
    persistScope: 'demand',
  },
  {
    key: 'valorTotalDespesas',
    header: 'Valor total despesas',
    source: 'formula',
    formula:
      '=SUM({col:locacao}{row}:{col:outros}{row})+(SUM({col:locacao}{row}:{col:outros}{row})*{col:pctDespesa}{row})',
    format: CURRENCY,
  },
  { key: 'consultor', header: 'Consultor', source: 'people.titulares', format: 'text' },
  {
    key: 'observacao',
    header: 'Observação',
    source: 'manual',
    format: 'text',
    editable: true,
    persistScope: 'demand',
  },
];

export const VALE_TEMPLATE: MeasurementTemplate = {
  id: VALE_TEMPLATE_ID,
  version: 1,
  origin: 'code',
  label: 'Medição Vale',
  company: { nameIncludes: 'VALE' },
  baseFile: '/templates/vale.xlsx',
  fileNameBase: 'medicao_vale',
  hybridSplit: true,
  notes: [
    'A turma entra na medição do período em que TERMINA, mesmo que tenha começado antes — diferente do dataset Medições, que usa interseção. Como cada turma tem uma só data de fim, ela nunca aparece em duas medições.',
    'Itens marcados como não reembolsáveis na medição ficam fora das colunas de despesa.',
    'O preço unitário HH é lembrado por treinamento e pode ser sobrescrito na turma.',
    'Treinamento híbrido sai em duas linhas — presencial e online — com a carga dividida pelo cadastro do treinamento (horas práticas) e um preço HH para cada parte; as despesas saem só na linha presencial.',
  ],
  sheets: [
    {
      name: 'Turmas Realizadas',
      kind: 'rows',
      rowScope: 'demand',
      headerRow: 1,
      firstDataRow: 2,
      columns: VALE_TURMAS_COLUMNS,
      totals: {
        sumColumns: ['cargaHoraria', 'valorTotal', 'locacao', 'combustivel', 'alimentacao', 'hospedagem', 'outros', 'valorTotalDespesas'],
      },
      file: { firstDataRow: 2, lastDataRow: 32, totalsRow: 33 },
    },
    { name: 'Plantas', kind: 'static', staticFrom: 'file' },
  ],
};

/** Registro dos templates em código. A Etapa 3 junta os do banco a esta lista. */
export const CODE_TEMPLATES: MeasurementTemplate[] = [VALE_TEMPLATE];
