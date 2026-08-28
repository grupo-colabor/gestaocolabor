/**
 * ITEM DE DESPESA DA MEDIÇÃO — como resolver nome e link do anexo
 *
 * Um item de `measurements.attachments` (jsonb) pode estar em três estados, e
 * a linha da UI precisa tratar os três sem inventar link morto:
 *
 *  1. ARQUIVO  — notinha anexada: tem `url` utilizável (ou dá para reconstruir
 *                a partir de `bucket` + `path`). Vira link clicável.
 *  2. AVULSO   — "Valor Avulso": lançamento sem arquivo nenhum, criado por
 *                `handleAddManualValue` com `url: '#'` e `type: 'text/plain'`.
 *                Nunca teve arquivo, então NÃO deve mostrar link.
 *  3. ÓRFÃO    — item que é de arquivo (MIME de imagem/PDF) mas perdeu a
 *                referência: sem `url` e sem `path`. Não há o que abrir; a
 *                linha mostra um rótulo neutro em vez de um link que erra.
 *
 * A reconstrução do estado 1 a partir de `bucket` + `path` é resolução em
 * TEMPO DE LEITURA — não escreve nada, não precisa de backfill nem migration.
 *
 * Está em `domain/` porque é a única parte da montagem do item que tem regra
 * de verdade, e é o que o smoke consegue exercitar sem montar o React.
 */

export interface AttachmentLike {
  name?: string;
  url?: string;
  type?: string;
  bucket?: string;
  path?: string;
}

export type AttachmentLink =
  /** Arquivo com destino: renderiza como link. */
  | { kind: 'link'; label: string; href: string }
  /** Lançamento avulso: texto simples, sem link (não é um arquivo). */
  | { kind: 'plain'; label: string }
  /** Era arquivo, perdeu a referência: rótulo neutro, sem link. */
  | { kind: 'unlinked'; label: string };

/** Rótulo do item órfão — sem link, para não prometer o que não abre. */
export const UNLINKED_LABEL = 'Arquivo não vinculado';

/** Nome de último recurso quando o item nem `name` tem. */
const FALLBACK_LABEL = 'Notinha';

/** '#' é o placeholder que o lançamento avulso grava; não é destino. */
const isUsableUrl = (url?: string) => {
  const u = (url ?? '').trim();
  return u.length > 0 && u !== '#';
};

/**
 * Item nasceu de upload de arquivo? `handleAddManualValue` grava
 * `type: 'text/plain'`; qualquer MIME diferente disso veio de um arquivo real.
 */
const isFileAttachment = (a: AttachmentLike) => {
  const t = (a.type ?? '').trim().toLowerCase();
  if (!t) return !!a.path || !!a.bucket;
  return t !== 'text/plain';
};

export interface ResolveAttachmentLinkOptions {
  /**
   * Reconstrói a URL a partir de bucket + path. O chamador injeta o Supabase
   * (`getPublicUrl`) para esta camada continuar pura e testável.
   */
  resolveStorageUrl?: (bucket: string, path: string) => string | null | undefined;
}

export function resolveAttachmentLink(
  attachment: AttachmentLike,
  { resolveStorageUrl }: ResolveAttachmentLinkOptions = {}
): AttachmentLink {
  const label = (attachment.name ?? '').trim();

  // 1. URL gravada no item — o caminho normal.
  if (isUsableUrl(attachment.url)) {
    return { kind: 'link', label: label || FALLBACK_LABEL, href: attachment.url as string };
  }

  // 2. Sem URL, mas com bucket + path: dá para reconstruir na leitura.
  if (attachment.bucket && attachment.path && resolveStorageUrl) {
    const rebuilt = resolveStorageUrl(attachment.bucket, attachment.path);
    if (isUsableUrl(rebuilt ?? undefined)) {
      return { kind: 'link', label: label || FALLBACK_LABEL, href: rebuilt as string };
    }
  }

  // 3. Nunca foi arquivo: lançamento avulso.
  if (!isFileAttachment(attachment)) {
    return { kind: 'plain', label: label || FALLBACK_LABEL };
  }

  // 4. Era arquivo e perdeu a referência.
  return { kind: 'unlinked', label: label || UNLINKED_LABEL };
}
