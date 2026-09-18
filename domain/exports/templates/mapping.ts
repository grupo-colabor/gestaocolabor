/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — o mapeamento (puro)
 *
 * O que a equipe de operação configura na tela, como DADO: qual aba do arquivo
 * enviado, onde está o cabeçalho, e o que cada coluna recebe. Este arquivo é a
 * ponte entre o `mapping jsonb` da tabela de modelos e o `MeasurementTemplate`
 * que o resolvedor já sabe processar.
 *
 * REGRAS DA CASA QUE ESTE ARQUIVO CUMPRE (as mesmas de domain/exports/presets.ts):
 *   • NUNCA LANÇA. Um mapeamento ilegível, ou apontando para campo que o app
 *     perdeu, vira template vazio + AVISOS em português. Configuração velha
 *     não pode travar a tela — mas também não passa em silêncio: o aviso sobe
 *     e, no resolvedor, o problema bloqueia a geração.
 *   • Vocabulário de NEGÓCIO no jsonb (`origem: 'campo' | 'digitado' | …`), não
 *     o vocabulário interno do resolvedor (`source: 'manual' | 'formula' | …`).
 *     Quem lê o banco entende o que está lá sem abrir o código; e o dia em que
 *     `TemplateColumnSource` mudar, o dado gravado não muda junto.
 *   • O jsonb guarda a `FormulaSpec`, nunca o texto compilado (formula.ts).
 *   • Chave de coluna ESTÁVEL: é o `column_key` de
 *     `measurement_template_values` (migration 017). Cabeçalho muda; chave não.
 *
 * O `template_id` de um modelo do banco é 'tpl:<uuid>' — TEXT solto, como
 * desde a 017. A FK para a tabela de modelos foi deliberadamente NÃO criada
 * (decisão de 18/09/2026); ver o cabeçalho de templates/types.ts.
 */
import {
  parseFormulaSpec,
  validateFormulaSpec,
  type FormulaSpec,
} from './formula';
import { isSourceField, SOURCE_FIELDS, type SourceField } from './sourceFields';
import type {
  MeasurementTemplate,
  TemplateCellValue,
  TemplateColumn,
  TemplateConstantDef,
  TemplateConstantValue,
  TemplateFormat,
  TemplatePersistScope,
} from './types';

export const TEMPLATE_MAPPING_VERSION = 1 as const;

/** De onde a coluna vem, na língua de quem configura. */
export type ColumnOrigem =
  /** Campo do app (a lista do catálogo). */
  | 'campo'
  /** Digitado na hora, na prévia, e lembrado. */
  | 'digitado'
  /** Conta montada por seleção. */
  | 'calculado'
  /** Valor fixo do modelo, igual em toda linha. */
  | 'constante'
  /** Sempre em branco — escolha, não esquecimento. */
  | 'branco'
  /** 1, 2, 3… (o "número do anexo" da Vale). */
  | 'sequencia';

export const COLUMN_ORIGENS: { origem: ColumnOrigem; label: string; ajuda: string }[] = [
  { origem: 'campo', label: 'Campo do sistema', ajuda: 'A coluna recebe um dado que o app já tem (treinamento, data, despesa…).' },
  { origem: 'digitado', label: 'Digitado na hora', ajuda: 'Célula editável na prévia; o valor fica lembrado para a próxima medição.' },
  { origem: 'calculado', label: 'Calculado', ajuda: 'Uma conta sobre outras colunas. A fórmula vai viva para o Excel.' },
  { origem: 'constante', label: 'Valor fixo do modelo', ajuda: 'O mesmo valor em toda linha, cadastrado na configuração.' },
  { origem: 'branco', label: 'Deixar em branco', ajuda: 'A coluna existe no arquivo do cliente e ninguém preenche.' },
  { origem: 'sequencia', label: 'Numeração (1, 2, 3…)', ajuda: 'Numera as turmas na ordem em que saem na planilha.' },
];

export interface MappingColumn {
  /** Estável; é o column_key da persistência. */
  key: string;
  /** Texto EXATO do cabeçalho no arquivo do cliente. */
  header: string;
  origem: ColumnOrigem;
  /** origem 'campo'. */
  campo?: SourceField;
  /** origem 'calculado'. */
  formula?: FormulaSpec;
  /** origem 'constante'. */
  constante?: string;
  formato?: TemplateFormat;
  /** origem 'digitado': por treinamento ou por turma. */
  escopo?: TemplatePersistScope;
  /** origem 'digitado' com escopo 'training': admite sobrescrita na turma. */
  sobrescreverNaTurma?: boolean;
  valorPadrao?: TemplateCellValue;
  /** Célula em amarelo quando sai vazia (ID do cliente, preço). */
  destacarVazio?: boolean;
}

export interface MappingConstant {
  nome: string;
  label: string;
  valor: TemplateConstantValue;
  formato?: TemplateFormat;
}

export interface TemplateMapping {
  v: typeof TEMPLATE_MAPPING_VERSION;
  /** Nome EXATO da aba de dados no arquivo enviado. */
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  columns: MappingColumn[];
  constants: MappingConstant[];
  /** Chaves das colunas que somam na linha de totais. */
  totals: string[];
  /**
   * Checagens do painel de pendências que este modelo aplica. Fase 4; aqui é
   * só preservado na ida e na volta, para um modelo gravado depois não perder
   * a configuração ao ser reaberto por uma versão que ainda não a usa.
   */
  checks?: string[];
}

export const EMPTY_MAPPING: TemplateMapping = {
  v: TEMPLATE_MAPPING_VERSION,
  sheetName: '',
  headerRow: 1,
  firstDataRow: 2,
  columns: [],
  constants: [],
  totals: [],
};

/* ─────────────────────────── leitura do jsonb ─────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

const inteiro = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback;

const FORMATOS: TemplateFormat[] = ['currency', 'percent', 'date', 'time', 'hours', 'integer', 'text'];
const isFormato = (v: unknown): v is TemplateFormat => FORMATOS.includes(v as TemplateFormat);

const ORIGENS = new Set<ColumnOrigem>(COLUMN_ORIGENS.map(o => o.origem));
const isOrigem = (v: unknown): v is ColumnOrigem => ORIGENS.has(v as ColumnOrigem);

const isConstValue = (v: unknown): v is TemplateConstantValue =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const isCellValue = (v: unknown): v is TemplateCellValue =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

export interface ParsedMapping {
  mapping: TemplateMapping;
  /** O que foi ignorado ou substituído — a tela mostra em banner amarelo. */
  avisos: string[];
}

/**
 * jsonb desconhecido -> mapeamento. Nunca lança: o pior caso é um mapeamento
 * vazio com o motivo escrito.
 */
export function parseTemplateMapping(config: unknown): ParsedMapping {
  const avisos: string[] = [];
  if (!isRecord(config)) {
    return { mapping: { ...EMPTY_MAPPING }, avisos: ['Modelo sem conteúdo legível; nada foi carregado.'] };
  }
  if (config.v !== undefined && config.v !== TEMPLATE_MAPPING_VERSION) {
    avisos.push(`Modelo gravado em outra versão (${String(config.v)}); lido como versão ${TEMPLATE_MAPPING_VERSION}.`);
  }

  const headerRow = inteiro(config.headerRow, EMPTY_MAPPING.headerRow);
  let firstDataRow = inteiro(config.firstDataRow, headerRow + 1);
  if (firstDataRow <= headerRow) {
    avisos.push('A primeira linha de dados não pode ser igual ou anterior à do cabeçalho; usando a linha logo abaixo dele.');
    firstDataRow = headerRow + 1;
  }

  /* Constantes primeiro: as colunas e as fórmulas referenciam. */
  const constants: MappingConstant[] = [];
  const nomesConst = new Set<string>();
  for (const raw of Array.isArray(config.constants) ? config.constants : []) {
    if (!isRecord(raw)) continue;
    const nome = texto(raw.nome).trim();
    if (!nome) {
      avisos.push('Valor fixo sem nome — ignorado.');
      continue;
    }
    if (nomesConst.has(nome)) {
      avisos.push(`Valor fixo «${nome}» aparece duas vezes — mantida a primeira ocorrência.`);
      continue;
    }
    if (!isConstValue(raw.valor)) {
      avisos.push(`Valor fixo «${nome}» tem um valor que não dá para ler — ignorado.`);
      continue;
    }
    nomesConst.add(nome);
    constants.push({
      nome,
      label: texto(raw.label).trim() || nome,
      valor: raw.valor,
      formato: isFormato(raw.formato) ? raw.formato : undefined,
    });
  }

  /* Colunas. */
  const columns: MappingColumn[] = [];
  const chaves = new Set<string>();
  for (const raw of Array.isArray(config.columns) ? config.columns : []) {
    if (!isRecord(raw)) continue;
    const key = texto(raw.key).trim();
    const header = texto(raw.header);
    if (!key) {
      avisos.push(`Coluna «${header || '(sem cabeçalho)'}» sem identificação — ignorada.`);
      continue;
    }
    if (chaves.has(key)) {
      avisos.push(`Coluna «${header || key}» repetida no modelo — mantida a primeira ocorrência.`);
      continue;
    }
    if (!isOrigem(raw.origem)) {
      avisos.push(`Coluna «${header || key}» tem uma origem desconhecida («${String(raw.origem)}») — deixada em branco.`);
      chaves.add(key);
      columns.push({ key, header, origem: 'branco' });
      continue;
    }

    const col: MappingColumn = {
      key,
      header,
      origem: raw.origem,
      formato: isFormato(raw.formato) ? raw.formato : undefined,
      destacarVazio: raw.destacarVazio === true || undefined,
      valorPadrao: isCellValue(raw.valorPadrao) ? raw.valorPadrao : undefined,
    };

    switch (raw.origem) {
      case 'campo': {
        const campo = texto(raw.campo);
        if (!isSourceField(campo)) {
          // Campo que o app perdeu. A coluna CONTINUA no modelo com a origem
          // que alguém escolheu — apagá-la esconderia o defeito. O resolvedor
          // transforma isto em pendência que bloqueia a geração.
          avisos.push(
            `A coluna «${header || key}» está ligada ao campo «${campo || '(vazio)'}», que não existe mais no sistema. Escolha outro campo.`
          );
          col.campo = campo as SourceField;
        } else {
          col.campo = campo;
        }
        break;
      }
      case 'digitado': {
        col.escopo = raw.escopo === 'training' ? 'training' : 'demand';
        if (raw.escopo !== 'training' && raw.escopo !== 'demand' && raw.escopo !== undefined) {
          avisos.push(`A coluna «${header || key}» tinha um escopo desconhecido — tratada como "por turma".`);
        }
        // Sobrescrita só faz sentido no escopo por treinamento.
        col.sobrescreverNaTurma = col.escopo === 'training' && raw.sobrescreverNaTurma === true ? true : undefined;
        break;
      }
      case 'calculado': {
        const spec = parseFormulaSpec(raw.formula);
        if (!spec) {
          avisos.push(`A coluna «${header || key}» está marcada como calculada, mas a conta não pôde ser lida — configure a conta de novo.`);
        } else {
          col.formula = spec;
        }
        break;
      }
      case 'constante': {
        const nome = texto(raw.constante).trim();
        if (!nome) {
          avisos.push(`A coluna «${header || key}» é um valor fixo, mas não diz qual — deixada em branco.`);
          col.origem = 'branco';
        } else {
          col.constante = nome;
          if (!nomesConst.has(nome)) {
            avisos.push(`A coluna «${header || key}» usa o valor fixo «${nome}», que não está declarado no modelo.`);
          }
        }
        break;
      }
      default:
        break;
    }

    chaves.add(key);
    columns.push(col);
  }

  /* Totais: só colunas que existem. */
  const totals: string[] = [];
  const desconhecidas: string[] = [];
  for (const k of Array.isArray(config.totals) ? config.totals : []) {
    if (typeof k !== 'string') continue;
    if (!chaves.has(k)) {
      if (!desconhecidas.includes(k)) desconhecidas.push(k);
      continue;
    }
    if (!totals.includes(k)) totals.push(k);
  }
  if (desconhecidas.length > 0) {
    avisos.push(`A linha de totais somava coluna(s) que não existe(m) mais: ${desconhecidas.join(', ')} — removida(s).`);
  }

  /* Fórmulas: as referências têm de existir depois de tudo lido. */
  const escopo = { colunas: columns.map(c => c.key), constantes: constants.map(c => c.nome) };
  for (const c of columns) {
    if (!c.formula) continue;
    for (const p of validateFormulaSpec(c.formula, escopo, c.header || c.key)) avisos.push(p);
  }

  const checks = Array.isArray(config.checks) ? config.checks.filter((c): c is string => typeof c === 'string') : undefined;

  // Sai pela MESMA normalização da escrita: ler é determinístico, e comparar
  // dois mapeamentos é comparar dois objetos na mesma forma.
  return {
    mapping: buildTemplateMapping({
      v: TEMPLATE_MAPPING_VERSION,
      sheetName: texto(config.sheetName),
      headerRow,
      firstDataRow,
      columns,
      constants,
      totals,
      ...(checks && checks.length > 0 ? { checks } : {}),
    }),
    avisos,
  };
}

/**
 * O que a tela tem agora -> o jsonb a gravar.
 *
 * ORDEM DE CAMPOS CANÔNICA, não a de inserção: o mesmo mapeamento gravado
 * duas vezes tem de dar o MESMO jsonb, senão o diff no banco vira ruído e
 * "ler e gravar de volta" deixa de ser uma operação nula. Campo indefinido não
 * é gravado.
 */
export function buildTemplateMapping(m: TemplateMapping): TemplateMapping {
  const limpo = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  const coluna = (c: MappingColumn): MappingColumn =>
    limpo({
      key: c.key,
      header: c.header,
      origem: c.origem,
      campo: c.campo,
      formula: c.formula,
      constante: c.constante,
      formato: c.formato,
      escopo: c.escopo,
      sobrescreverNaTurma: c.sobrescreverNaTurma,
      valorPadrao: c.valorPadrao,
      destacarVazio: c.destacarVazio,
    });

  const constante = (c: MappingConstant): MappingConstant =>
    limpo({ nome: c.nome, label: c.label, valor: c.valor, formato: c.formato });

  return limpo({
    v: TEMPLATE_MAPPING_VERSION,
    sheetName: m.sheetName,
    headerRow: m.headerRow,
    firstDataRow: m.firstDataRow,
    columns: m.columns.map(coluna),
    constants: m.constants.map(constante),
    totals: [...m.totals],
    checks: m.checks && m.checks.length > 0 ? [...m.checks] : undefined,
  });
}

/* ────────────────────── mapeamento -> MeasurementTemplate ────────────────────── */

/**
 * A linha da tabela de modelos (migration 022), sem nada de I/O.
 *
 * ⚠️ `sheetName`, `headerRow` e `firstDataRow` existem TAMBÉM como colunas na
 * tabela, para dar para consultar um modelo sem abrir o jsonb. A FONTE é o
 * `mapping`: `templateFromRecord` lê de lá e ignora as colunas, e quem grava
 * (services/exports/templates.ts) deriva as colunas do mapeamento na mesma
 * escrita. Elas não podem divergir porque ninguém as escreve sozinhas.
 */
export interface TemplateRecord {
  /** uuid da linha. */
  id: string;
  /** `companies.id` — a empresa cujas demandas o modelo mede. */
  companyId: string;
  /** Nome da empresa, para o rótulo do módulo. */
  companyName: string;
  /** Nome do MODELO, para a lista de gerenciamento ("orçamento 2027"). */
  name: string;
  storageBucket?: string;
  storagePath?: string;
  /** O jsonb cru. */
  mapping: unknown;
  isActive: boolean;
  /** Cópias derivadas do `mapping` — ver a nota acima. */
  sheetName?: string | null;
  headerRow?: number | null;
  firstDataRow?: number | null;
  /** Aba + linha do cabeçalho + textos dos cabeçalhos no momento do mapeamento. */
  baseFingerprint?: unknown;
}

/**
 * A impressão digital do arquivo-base: o que precisa continuar igual para o
 * mapeamento seguir válido. Trocar o arquivo por um de colunas diferentes
 * faria o modelo escrever na coluna errada sem reclamar de nada.
 */
export interface BaseFingerprint {
  sheetName: string;
  headerRow: number;
  /** Os cabeçalhos EXATOS, na ordem das colunas do arquivo. */
  headers: string[];
}

export function buildBaseFingerprint(m: TemplateMapping, headers: string[]): BaseFingerprint {
  return { sheetName: m.sheetName, headerRow: m.headerRow, headers: [...headers] };
}

export function parseBaseFingerprint(v: unknown): BaseFingerprint | null {
  if (!isRecord(v)) return null;
  const sheetName = typeof v.sheetName === 'string' ? v.sheetName : null;
  const headerRow = typeof v.headerRow === 'number' ? v.headerRow : null;
  const headers = Array.isArray(v.headers) ? v.headers.filter((h): h is string => typeof h === 'string') : null;
  if (sheetName === null || headerRow === null || !headers) return null;
  return { sheetName, headerRow, headers };
}

/**
 * O que mudou entre a planilha que gerou o mapeamento e a que está lá agora,
 * em português. Lista vazia = pode seguir sem reconfirmar nada.
 */
export function compareBaseFingerprint(antes: BaseFingerprint, agora: BaseFingerprint): string[] {
  const dif: string[] = [];
  if (antes.sheetName !== agora.sheetName) {
    dif.push(`A aba de dados era «${antes.sheetName}» e agora é «${agora.sheetName}».`);
  }
  if (antes.headerRow !== agora.headerRow) {
    dif.push(`O cabeçalho estava na linha ${antes.headerRow} e agora está na linha ${agora.headerRow}.`);
  }
  const n = Math.max(antes.headers.length, agora.headers.length);
  for (let i = 0; i < n; i++) {
    const a = antes.headers[i];
    const b = agora.headers[i];
    if (a === b) continue;
    const letra = columnLetterOfIndex(i);
    if (a === undefined) dif.push(`A coluna ${letra} («${b}») não existia na planilha anterior.`);
    else if (b === undefined) dif.push(`A coluna ${letra} («${a}») não existe mais na planilha nova.`);
    else dif.push(`A coluna ${letra} era «${a}» e agora é «${b}».`);
  }
  return dif;
}

/** 0 -> 'A'. Local, para o domínio de mapeamento não depender do resolvedor. */
function columnLetterOfIndex(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 'tpl:<uuid>' — o que vai para measurement_template_values.template_id. */
export const templateIdOf = (recordId: string): string => `tpl:${recordId}`;

/** Base do nome do arquivo gerado: 'medicao_gerdau'. */
export function fileNameBaseOf(companyName: string): string {
  const slug = companyName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? `medicao_${slug}` : 'medicao';
}

/** A origem interna do resolvedor para cada origem de negócio. */
function sourceOf(c: MappingColumn): TemplateColumn['source'] {
  switch (c.origem) {
    case 'campo':
      // Campo extinto sai como está; o resolvedor tolerante o transforma em
      // pendência com o nome da coluna, que é o que a pessoa precisa ler.
      return (c.campo ?? 'blank') as TemplateColumn['source'];
    case 'digitado':
      return 'manual';
    case 'calculado':
      return 'formula';
    case 'constante':
      return 'constant';
    case 'sequencia':
      return 'sequence';
    case 'branco':
    default:
      return 'blank';
  }
}

export interface BuiltTemplate {
  template: MeasurementTemplate;
  avisos: string[];
}

/**
 * Linha da tabela + jsonb -> o template que o resolvedor consome.
 *
 * O RÓTULO do módulo vem da EMPRESA ("Medição Gerdau"), não do nome do modelo:
 * o `name` serve à lista de gerenciamento, onde "orçamento 2027" faz sentido, e
 * não à aba, onde a pessoa procura pela empresa.
 */
export function templateFromRecord(rec: TemplateRecord): BuiltTemplate {
  const { mapping, avisos } = parseTemplateMapping(rec.mapping);

  const columns: TemplateColumn[] = mapping.columns.map(c => {
    const col: TemplateColumn = {
      key: c.key,
      header: c.header,
      source: sourceOf(c),
    };
    if (c.formato) col.format = c.formato;
    if (c.valorPadrao !== undefined) col.defaultValue = c.valorPadrao;
    if (c.destacarVazio) col.highlightWhenEmpty = true;
    if (c.origem === 'digitado') {
      col.editable = true;
      col.persistScope = c.escopo ?? 'demand';
      if (c.sobrescreverNaTurma) col.overrideScope = 'demand';
    }
    if (c.origem === 'calculado' && c.formula) col.formulaSpec = c.formula;
    if (c.origem === 'constante' && c.constante) col.constantName = c.constante;
    return col;
  });

  const constants: Record<string, TemplateConstantValue> = {};
  const constantDefs: TemplateConstantDef[] = [];
  for (const c of mapping.constants) {
    constants[c.nome] = c.valor;
    constantDefs.push({ name: c.nome, label: c.label, format: c.formato });
  }

  const template: MeasurementTemplate = {
    id: templateIdOf(rec.id),
    version: TEMPLATE_MAPPING_VERSION,
    origin: 'db',
    label: `Medição ${rec.companyName}`.trim(),
    company: { id: rec.companyId },
    fileNameBase: fileNameBaseOf(rec.companyName),
    sheets: [
      {
        name: mapping.sheetName,
        kind: 'rows',
        rowScope: 'demand',
        headerRow: mapping.headerRow,
        firstDataRow: mapping.firstDataRow,
        columns,
        ...(mapping.totals.length > 0 ? { totals: { sumColumns: [...mapping.totals] } } : {}),
      },
    ],
    constants,
    constantDefs,
  };

  if (rec.storagePath) {
    template.baseFile = rec.storagePath;
    template.baseFileFrom = 'storage';
    if (rec.storageBucket) template.baseFileBucket = rec.storageBucket;
  }

  return { template, avisos };
}

/** Os campos do catálogo, para a tela listar. Rótulo de negócio, nunca a chave. */
export function catalogoDeCampos(): { campo: SourceField; label: string }[] {
  return (Object.keys(SOURCE_FIELDS) as SourceField[]).map(campo => ({
    campo,
    label: SOURCE_FIELDS[campo].label,
  }));
}
