/**
 * MODELOS DE MEDIÇÃO POR EMPRESA — o arquivo-base no Storage (I/O: Supabase)
 *
 * Bucket `measurement-templates`, PRIVADO (criado à mão no painel; a migration
 * 022 só confere que ele existe — ver a conferência prévia 3 de lá).
 *
 * Separado de templateFile.ts de propósito: lá é BYTES e NOMES (a guarda de
 * assinatura, o parser, a sanitização da key), coisas que o smoke exercita sem
 * banco nenhum; aqui é REDE. Misturar os dois obrigaria todo smoke que testa a
 * leitura de planilha a carregar o cliente do Supabase.
 *
 * Upload no padrão de services/demandDocuments.ts (`upsert: true` +
 * `contentType`), caminho
 * `templates/<company_id>/<template_id>/<nome-sanitizado>.xlsx`.
 *
 * A URL ASSINADA VALE 1 h E NUNCA É GUARDADA. O modelo guarda o CAMINHO
 * (`storage_path`); quem vai baixar assina na hora. Guardar a URL no registro
 * daria um link morto no dia seguinte.
 *
 * ⚠️ A GUARDA DE BYTES RODA ANTES DO UPLOAD, não só antes do parse: um .xls
 * aceito no bucket viraria um arquivo-base que falha toda vez que alguém for
 * gerar a medição — semanas depois de quem o subiu ter esquecido do assunto.
 *
 * Sumiço do arquivo vira frase em português, não erro de HTTP: quem recebe a
 * mensagem é quem vai reenviar a planilha, não quem lê stack trace.
 */
import { supabase } from '../../lib/supabase';
import {
  assertXlsx,
  buildTemplateStoragePath,
  TEMPLATE_BUCKET,
} from './templateFile';

/** Validade da URL assinada, em segundos — a mesma de demandDocuments. */
export const SIGNED_URL_TTL = 3600;

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sumiu = (path: string) =>
  new Error(
    `A planilha-base deste modelo não está mais no armazenamento (${path}). Envie o arquivo do cliente de novo antes de gerar a medição.`
  );

export interface UploadedTemplateFile {
  bucket: string;
  path: string;
  /** O nome que a pessoa enviou, para a tela mostrar. */
  originalName: string;
}

/** Envia o arquivo-base. A guarda de bytes roda ANTES — ver o cabeçalho. */
export async function uploadTemplateBaseFile(
  companyId: string,
  templateId: string,
  file: File | Blob,
  fileName: string
): Promise<UploadedTemplateFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertXlsx(bytes);

  const path = buildTemplateStoragePath(companyId, templateId, fileName);
  const { error } = await supabase.storage.from(TEMPLATE_BUCKET).upload(path, file, {
    contentType: XLSX_CONTENT_TYPE,
    upsert: true,
  });
  if (error) {
    console.error('[measurement-templates] upload error', error);
    throw new Error(`Não foi possível enviar a planilha-base: ${error.message}`);
  }
  return { bucket: TEMPLATE_BUCKET, path, originalName: String(fileName ?? '').trim() };
}

/** URL assinada para ler o arquivo-base. Gerada na hora de usar. */
export async function signedTemplateBaseUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket || TEMPLATE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    console.error('[measurement-templates] signed url error', error);
    throw sumiu(path);
  }
  return data.signedUrl;
}

/**
 * Baixa o arquivo-base. É o `loader` que `fetchTemplateBaseFile`
 * (templateXlsxWriter.ts) recebe quando o template é `baseFileFrom: 'storage'`.
 */
export async function downloadTemplateBaseFile(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket || TEMPLATE_BUCKET).download(path);
  if (error || !data) {
    console.error('[measurement-templates] download error', error);
    throw sumiu(path);
  }
  return data.arrayBuffer();
}

/**
 * Remove o arquivo-base. Chamado DEPOIS de o registro sair — a ordem e o
 * porquê estão em `excluirTemplateComArquivo` (services/exports/templates.ts).
 *
 * A falha NÃO é engolida: sobe com o caminho, para ficar registrado que o
 * modelo saiu e o arquivo ficou.
 */
export async function removeTemplateBaseFile(bucket: string, path: string): Promise<void> {
  const alvo = String(path ?? '').trim();
  if (!alvo) return;
  const { error } = await supabase.storage.from(bucket || TEMPLATE_BUCKET).remove([alvo]);
  if (error) {
    console.error('[measurement-templates] remove error', error);
    throw new Error(
      `O modelo foi excluído, mas a planilha-base continuou no armazenamento (${alvo}): ${error.message}`
    );
  }
}
