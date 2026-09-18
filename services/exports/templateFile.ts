/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — leitura do arquivo enviado (I/O: ExcelJS)
 *
 * Recebe o .xlsx que a equipe subiu e devolve a fotografia que a heurística
 * pura consome (domain/exports/templates/inspect.ts). Nada de regra aqui: só
 * abrir, olhar e recusar o que não serve.
 *
 * ⚠️ POR QUE A GUARDA DE ASSINATURA DE BYTES EXISTE
 * ---------------------------------------------------------------------------
 * Verificado no ExcelJS 4.4 com o `public/templates/vale-bm.xls` real:
 * carregar um .xls antigo NÃO LANÇA — devolve um workbook com ZERO abas. Sem
 * esta guarda, quem sobe um .xls lê "nenhuma aba encontrada" e não faz ideia
 * do que fazer. Um arquivo que o app não entende tem de dizer o que ele é e o
 * que fazer com ele, em português, antes de chegar ao parser:
 *   • .xlsx  = zip          -> 50 4B 03 04  ('PK\x03\x04')
 *   • .xls   = OLE2         -> D0 CF 11 E0 A1 B1 1A E1
 * Qualquer outra coisa é recusada pelo que ela é, não por "deu erro".
 *
 * Também recusa, com o motivo: arquivo sem aba nenhuma, e aba escolhida sem
 * uma linha de dados sequer. "Aceitei o upload mas não achei nada" é a falha
 * silenciosa que este repositório não faz.
 *
 * O ExcelJS entra por `import()` dinâmico, como em todos os exports do app.
 *
 * STORAGE (bucket `measurement-templates`, privado — migration 022)
 * ---------------------------------------------------------------------------
 * Upload no padrão de services/demandDocuments.ts (`upsert: true` +
 * `contentType`), caminho
 * `templates/<company_id>/<template_id>/<nome-sanitizado>.xlsx`, e leitura por
 * URL ASSINADA de 1 h — a URL expira, então ela NUNCA é guardada no modelo: o
 * template guarda o CAMINHO e quem vai baixar assina na hora.
 *
 * A guarda de assinatura de bytes roda ANTES do upload, não só antes do parse:
 * um .xls no bucket viraria um arquivo-base que falha toda vez que alguém
 * gerar a medição, semanas depois de quem o subiu ter esquecido.
 */
import {
  INSPECT_ROWS,
  type CellSnapshot,
  type SheetSnapshot,
  type SnapshotCellType,
  type WorkbookSnapshot,
} from '../../domain/exports/templates/inspect';

/** Teto do arquivo-base. Um modelo de medição real tem menos de 100 KB. */
export const TEMPLATE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export type TemplateFileErrorCode =
  | 'vazio'
  | 'grande'
  | 'xls-antigo'
  | 'nao-e-xlsx'
  | 'ilegivel'
  | 'sem-abas'
  | 'sem-dados';

/** Erro com mensagem já em português, pronta para o banner. */
export class TemplateFileError extends Error {
  readonly codigo: TemplateFileErrorCode;
  constructor(codigo: TemplateFileErrorCode, message: string) {
    super(message);
    this.name = 'TemplateFileError';
    this.codigo = codigo;
  }
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const comeca = (bytes: Uint8Array, assinatura: number[]): boolean =>
  bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b);

/**
 * O arquivo é um .xlsx? Lança com a explicação quando não é. Roda ANTES do
 * ExcelJS — ver o cabeçalho.
 */
export function assertXlsx(data: ArrayBuffer | Uint8Array): void {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.length === 0) {
    throw new TemplateFileError('vazio', 'O arquivo está vazio. Envie a planilha que a empresa usa na medição.');
  }
  if (bytes.length > TEMPLATE_FILE_MAX_BYTES) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1);
    throw new TemplateFileError(
      'grande',
      `O arquivo tem ${mb} MB e o limite é ${TEMPLATE_FILE_MAX_BYTES / 1024 / 1024} MB. Envie só o modelo em branco, sem os dados de meses anteriores.`
    );
  }
  if (comeca(bytes, OLE2)) {
    throw new TemplateFileError(
      'xls-antigo',
      'Este arquivo está no formato antigo do Excel (.xls). Abra no Excel e salve como .xlsx (Pasta de Trabalho do Excel) antes de enviar.'
    );
  }
  if (!comeca(bytes, ZIP)) {
    throw new TemplateFileError(
      'nao-e-xlsx',
      'Este arquivo não é uma planilha do Excel (.xlsx). Confira se não enviou um PDF, uma imagem ou um .csv por engano.'
    );
  }
}

/* ────────────────────────── fotografia da planilha ────────────────────────── */

/** ExcelJS.ValueType -> o tipo que a heurística entende. */
function tipoDaCelula(cell: any): SnapshotCellType {
  const v = cell?.value;
  if (v === null || v === undefined || v === '') return 'vazio';
  // 1 = Merge no ExcelJS: célula coberta por uma mesclagem.
  if (cell.type === 1) return 'mesclada';
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return 'formula';
    if ('error' in v) return 'erro';
    if ('richText' in v) return String(textoDaCelula(cell)).trim() ? 'texto' : 'vazio';
    if ('hyperlink' in v) return 'texto';
    if (v instanceof Date) return 'data';
    return 'texto';
  }
  if (v instanceof Date) return 'data';
  if (typeof v === 'number') return 'numero';
  if (typeof v === 'boolean') return 'booleano';
  return String(v).trim() ? 'texto' : 'vazio';
}

/** O texto visível da célula, sem formatar número nem data. */
function textoDaCelula(cell: any): string {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray((v as any).richText)) {
      return (v as any).richText.map((t: any) => String(t?.text ?? '')).join('');
    }
    if ('result' in v) return String((v as any).result ?? '');
    if ('text' in v) return String((v as any).text ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('error' in v) return String((v as any).error ?? '');
    return '';
  }
  return String(v);
}

function mergesDaAba(ws: any): string[] {
  const doModel = ws?.model?.merges;
  if (Array.isArray(doModel)) return doModel.map((m: unknown) => String(m));
  // Fallback para versões que só expõem o índice interno.
  const internos = ws?._merges;
  return internos && typeof internos === 'object' ? Object.keys(internos) : [];
}

function abaSnapshot(ws: any, maxRows: number): SheetSnapshot {
  const columnCount = Math.max(1, Number(ws.columnCount) || 0);
  const rowCount = Math.max(0, Number(ws.rowCount) || 0);
  const ate = Math.min(rowCount, maxRows);

  const rows: CellSnapshot[][] = [];
  for (let r = 1; r <= ate; r++) {
    const row = ws.getRow(r);
    const cells: CellSnapshot[] = [];
    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c);
      cells.push({ text: textoDaCelula(cell), type: tipoDaCelula(cell) });
    }
    rows.push(cells);
  }

  return {
    name: String(ws.name ?? ''),
    hidden: ws.state === 'hidden' || ws.state === 'veryHidden',
    locked: !!ws.sheetProtection,
    rowCount,
    columnCount,
    merges: mergesDaAba(ws),
    rows,
  };
}

export interface ReadTemplateFileOptions {
  /** Quantas linhas fotografar por aba. */
  maxRows?: number;
}

/**
 * .xlsx -> fotografia para a heurística. Recusa com mensagem em português
 * tudo que não serve; NUNCA devolve uma fotografia vazia fingindo sucesso.
 */
export async function readTemplateFile(
  data: ArrayBuffer | Uint8Array,
  opts: ReadTemplateFileOptions = {}
): Promise<WorkbookSnapshot> {
  assertXlsx(data);

  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default ?? ExcelJSModule;

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as any);
  } catch (e: any) {
    throw new TemplateFileError(
      'ilegivel',
      `Não foi possível abrir a planilha. Ela pode estar corrompida ou protegida por senha. Detalhe: ${e?.message || e}`
    );
  }

  const abas: any[] = workbook.worksheets ?? [];
  if (abas.length === 0) {
    throw new TemplateFileError(
      'sem-abas',
      'A planilha foi aberta, mas não tem nenhuma aba. Confira o arquivo e envie de novo.'
    );
  }

  const maxRows = Math.max(2, opts.maxRows ?? INSPECT_ROWS);
  const sheets = abas.map(ws => abaSnapshot(ws, maxRows));

  if (sheets.every(s => s.rows.every(r => r.every(c => c.type === 'vazio')))) {
    throw new TemplateFileError(
      'sem-dados',
      'A planilha está em branco: nenhuma aba tem cabeçalho ou dados nas primeiras linhas.'
    );
  }

  return { sheets };
}

/* ──────────────── nome e caminho do arquivo-base no Storage ──────────────── */
/*
 * Nome e caminho são STRING, não rede: moram aqui, junto da guarda de bytes,
 * para o smoke poder exercitá-los sem tocar no Supabase. Quem fala com o
 * bucket é services/exports/templateStorage.ts.
 */

/** O bucket da 022. Privado: o arquivo do cliente não fica em URL adivinhável. */
export const TEMPLATE_BUCKET = 'measurement-templates';

/**
 * Nome de arquivo seguro para o Storage, preservando o que dá:
 * "Modelo Medição — Vale (2027).xlsx" -> "modelo_medicao_vale_2027.xlsx".
 *
 * O Supabase Storage recusa/escapa acento, espaço e vários símbolos na key.
 * Sem isto, um nome com acento vira 400 no upload — e o nome do arquivo é
 * escolha de quem envia, não deve ser armadilha.
 */
export function sanitizeFileName(nome: string): string {
  const cru = String(nome ?? '').trim();
  const extMatch = /\.([A-Za-z0-9]{1,10})$/.exec(cru);
  const ext = (extMatch ? extMatch[1] : 'xlsx').toLowerCase();
  const base = extMatch ? cru.slice(0, -extMatch[0].length) : cru;

  const slug = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 80);

  return `${slug || 'modelo'}.${ext}`;
}

/** `templates/<company_id>/<template_id>/<nome-sanitizado>.xlsx`. */
export function buildTemplateStoragePath(companyId: string, templateId: string, fileName: string): string {
  const empresa = String(companyId ?? '').trim();
  const modelo = String(templateId ?? '').trim();
  if (!empresa) throw new TemplateFileError('ilegivel', 'Modelo sem empresa: não dá para guardar o arquivo-base.');
  if (!modelo) throw new TemplateFileError('ilegivel', 'Modelo sem identificação: não dá para guardar o arquivo-base.');
  return `templates/${empresa}/${modelo}/${sanitizeFileName(fileName)}`;
}
