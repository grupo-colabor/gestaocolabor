/**
 * TEMPLATE DE MEDIÇÃO — VALE (em código, primeiro exemplo)
 *
 * Extraído do modelo `public/templates/vale.xlsx` em 16/09/2026 (duas abas:
 * "Turmas Realizadas" e "Plantas"). O arquivo é a fonte: cabeçalhos com os
 * espaços que ele tem, fórmulas de I e P como ele grava, 0,2 em O, totais em
 * G, I a N e P. Divergências aprovadas em relação ao arquivo:
 *   • o total de I no modelo soma só I2:I5 (erro do modelo) — aqui soma a
 *     faixa real, como as outras colunas;
 *   • a linha de totais vai logo abaixo da última turma (o modelo a fixa na
 *     33, com 31 linhas pré-formatadas); sobras são removidas pelo escritor;
 *   • Data grava data de verdade com dd/mm/yyyy (o modelo usa o formato
 *     embutido dependente do idioma);
 *   • H (preço) ganha formato de moeda (o modelo não tem);
 *   • B e H em amarelo quando saem vazias.
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
  { key: 'data', header: 'Data', source: 'demand.dataInicio', format: 'date' },
  { key: 'horario', header: 'Horário', source: 'demand.horarioInicio', format: 'time' },
  { key: 'cargaHoraria', header: 'Carga horária', source: 'demand.cargaHoraria', format: 'hours' },
  {
    key: 'precoHH',
    header: 'Preço unitário HH',
    source: 'manual',
    format: CURRENCY,
    editable: true,
    persistScope: 'training',
    overrideScope: 'demand',
    highlightWhenEmpty: true,
  },
  {
    key: 'valorTotal',
    header: 'Valor total do treinamento',
    source: 'formula',
    formula: '={col:cargaHoraria}{row}*{col:precoHH}{row}',
    format: CURRENCY,
  },
  { key: 'locacao', header: 'Despesa reembolsável (locação veículo/táxi)', source: 'expenses.locomocao', format: CURRENCY },
  {
    key: 'combustivel',
    header: 'Despesa reembolsável (combustível)',
    source: 'manual',
    format: CURRENCY,
    defaultValue: 0,
    editable: true,
    persistScope: 'demand',
  },
  { key: 'alimentacao', header: 'Despesa reembolsável (alimentação)', source: 'expenses.alimentacao', format: CURRENCY },
  { key: 'hospedagem', header: 'Despesa reembolsável (hospedagem)', source: 'expenses.hospedagem', format: CURRENCY },
  { key: 'outros', header: 'Despesa reembolsável (outros)', source: 'expenses.outros', format: CURRENCY },
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
  notes: [
    'O período seleciona as turmas pela DATA DE INÍCIO dentro do intervalo — diferente do dataset Medições, que usa interseção. Uma turma que atravessa o fechamento entra num mês só.',
    'Itens marcados como não reembolsáveis na medição ficam fora das colunas de despesa.',
    'O preço unitário HH é lembrado por treinamento e pode ser sobrescrito na turma.',
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
