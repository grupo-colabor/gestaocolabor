/**
 * TEMPLATE — BM DA VALE (Boletim de Medição), em código
 *
 * Extraído de `public/templates/vale-bm.xlsx` (convertido do .xls "Boletim de
 * – PNR-000043 – Rev. 05") em 16/09/2026. Uma folha, `BOLETIM MEDIÇÃO`:
 *
 *   • CABEÇALHO do contrato — células fixas e mescladas, endereçadas por chave
 *     e lidas do cadastro por contexto "<corredor>|<mina>" (escopo 'context'
 *     da migration 018), mais data de envio (digitada) e período (do filtro);
 *   • LINHAS DO QQP — 19 a 42 no arquivo (24 posições), cabeçalho na 18,
 *     B número · C:E descrição · F unidade · G preço · H quantidade ·
 *     I:J =G×H. Uma linha por treinamento (nome normalizado + preço) com
 *     quantidade = Σ carga horária das turmas, e uma linha fixa final de
 *     despesas (QQP 70, unidade 1, preço 1, quantidade = Σ despesas);
 *   • VALOR TOTAL DESTA MEDIÇÃO — linha 43, SUM da faixa real, sempre
 *     reescrita pelo escritor;
 *   • ASSINATURAS — linhas 45 a 53, intocadas (o escritor insere linhas antes
 *     do total quando passa de 24 e o ExcelJS desloca as mesclagens).
 *
 * As turmas vêm EXATAMENTE da seleção da Medição Vale (datasets/medicaoVale +
 * templates/vale): mesma elegibilidade, mesma exclusão de não reembolsável,
 * mesmo preço HH. Σ das linhas 20 = Σ coluna I da aba Turmas; quantidade da
 * linha 70 = Σ coluna P. O smoke:medicao-vale-bm prende os dois.
 *
 * `despesasComAcrescimo` é CONSTANTE (regra ainda a confirmar com a Colabor):
 * true = quantidade da linha 70 usa a coluna P (com o % de cada turma); false
 * = só J+K+L+M+N. Trocar aqui muda a regra em uma linha.
 *
 * Esta folha é 'form': endereços fixos vêm do arquivo — a guarda "sem letra
 * literal" do smoke vale para vale.ts (aba de linhas), não para esta.
 */
import type { MeasurementTemplate, TemplateContextField } from './types';

export const VALE_BM_TEMPLATE_ID = 'vale-bm-v1';

export const VALE_BM_CONSTANTS = {
  despesasComAcrescimo: true,
  qqpTreinamento: '20',
  qqpDespesas: '70',
  prefixoTreinamento: 'Aplicação de Treinamento - ',
  unidadeTreinamento: 'Hora/Aula ',
  descricaoDespesas: 'Despesas Tributáveis (hospedagem,transporte e alimentação)',
  unidadeDespesas: 1,
  precoDespesas: 1,
} as const;

/** Campos do cadastro por (corredor, mina). Os QQP têm default; os demais nascem em branco. */
export const VALE_BM_CONTEXT_FIELDS: TemplateContextField[] = [
  { key: 'gerenciaExecutiva', label: 'Gerência executiva (por extenso)' },
  { key: 'gerencia', label: 'Gerência (por extenso)' },
  { key: 'contrato', label: 'Contrato nº' },
  { key: 'contratada', label: 'Contratada / CNPJ' },
  { key: 'objeto', label: 'Objeto' },
  { key: 'gestor', label: 'Gestor do contrato' },
  { key: 'local', label: 'Local de prestação do serviço' },
  { key: 'qqpTreinamento', label: 'Linha do QQP — treinamento', defaultValue: VALE_BM_CONSTANTS.qqpTreinamento },
  { key: 'qqpDespesas', label: 'Linha do QQP — despesas', defaultValue: VALE_BM_CONSTANTS.qqpDespesas },
];

export const VALE_BM_TEMPLATE: MeasurementTemplate = {
  id: VALE_BM_TEMPLATE_ID,
  version: 1,
  origin: 'code',
  label: 'BM Vale',
  company: { nameIncludes: 'VALE' },
  baseFile: '/templates/vale-bm.xlsx',
  fileNameBase: 'vale-bm',
  constants: { ...VALE_BM_CONSTANTS },
  contextFields: VALE_BM_CONTEXT_FIELDS,
  notes: [
    'O BM sai da MESMA seleção da Medição Vale: mesmas turmas, mesmo preço HH, mesma exclusão de não reembolsável. Os totais dos dois documentos batem por construção.',
    'Um BM por (corredor, mina). Corredor é obrigatório; sem mina, sai um .zip com um .xlsx por mina do recorte.',
    'Turma sem local na demanda fica fora do BM — corrija o local na demanda.',
  ],
  sheets: [
    {
      name: 'BOLETIM MEDIÇÃO',
      kind: 'form',
      cells: [
        { key: 'gerenciaExecutiva', cell: 'F10', source: 'context', highlightWhenEmpty: true, label: 'Gerência executiva' },
        { key: 'gerencia', cell: 'H10', source: 'context', highlightWhenEmpty: true, label: 'Gerência' },
        { key: 'contrato', cell: 'B13', source: 'context', highlightWhenEmpty: true, label: 'Contrato nº' },
        { key: 'contratada', cell: 'E13', source: 'context', highlightWhenEmpty: true, label: 'Contratada / CNPJ' },
        { key: 'objeto', cell: 'F13', source: 'context', highlightWhenEmpty: true, label: 'Objeto' },
        { key: 'dataEnvio', cell: 'B16', source: 'dataEnvio', format: 'date', highlightWhenEmpty: true, label: 'Data de envio' },
        { key: 'gestor', cell: 'E16', source: 'context', highlightWhenEmpty: true, label: 'Gestor do contrato' },
        { key: 'local', cell: 'F16', source: 'context', highlightWhenEmpty: true, label: 'Local de prestação do serviço' },
        { key: 'periodo', cell: 'I16', source: 'periodo', highlightWhenEmpty: true, label: 'Período' },
      ],
      region: {
        rowScope: 'training',
        firstRow: 19,
        lastRowInFile: 42,
        totalsRowInFile: 43,
        mergeCols: ['C:E', 'I:J'],
        columns: [
          { key: 'qqp', col: 'B', source: 'field' },
          { key: 'descricao', col: 'C', source: 'field' },
          { key: 'unidade', col: 'F', source: 'field' },
          { key: 'preco', col: 'G', source: 'field', highlightWhenEmpty: true },
          { key: 'quantidade', col: 'H', source: 'field' },
          { key: 'total', col: 'I', source: 'formula', formula: '={col:preco}{row}*{col:quantidade}{row}' },
        ],
        totals: { col: 'I', formula: 'SUM({col:total}{first}:J{last})' },
      },
    },
  ],
};
