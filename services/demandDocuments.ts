import { supabase } from '../lib/supabase';

export type DemandDocType = 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR';

export async function markDemandDocumentAsNA(
  demandId: string,
  docType: 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR'
) {
  // 1) verifica se já existe doc e se tem PDF
  const { data: existing, error: e1 } = await supabase
    .from('demand_documents')
    .select('id, file_path')
    .eq('demand_id', demandId)
    .eq('doc_type', docType)
    .maybeSingle();

  if (e1) return { error: e1 };

  if (existing?.file_path) {
    return { error: new Error('Não é possível marcar como N/A quando já existe PDF anexado.') };
  }

  // 2) upsert (se existir, update; se não, insert)
  if (existing?.id) {
    const { error: e2 } = await supabase
      .from('demand_documents')
      .update({
        is_na: true,
        file_path: null,
        file_name: null,
        mime_type: null
      })
      .eq('id', existing.id);

    if (e2) return { error: e2 };
    return { error: null };
  }

  const { error: e3 } = await supabase
    .from('demand_documents')
    .insert({
      demand_id: demandId,
      doc_type: docType,
      is_na: true,
      file_path: null,
      file_name: null,
      mime_type: null
    });

  if (e3) return { error: e3 };
  return { error: null };
}

export type DemandDocumentRow = {
  id: string; // uuid
  demand_id: string; // DEM-xxxx
  doc_type: DemandDocType;
  file_path: string; // path no storage
  file_name: string | null;
  mime_type: string | null;
  created_at?: string;
  updated_at?: string;
};

const BUCKET = 'demand-documents';

const SELECT_FIELDS = `
  id, demand_id, doc_type, file_path, file_name, mime_type,
  created_at, updated_at
`;

/**
 * Busca documentos APENAS da demanda informada.
 * (Esse filtro é CRÍTICO para não "puxar PDF fantasma")
 */
export async function fetchDemandDocumentsByDemandId(
  demandId: string
): Promise<DemandDocumentRow[]> {
  const safeId = (demandId ?? '').trim();
  if (!safeId) return [];

  const { data, error } = await supabase
    .from('demand_documents')
    .select(SELECT_FIELDS)
    .eq('demand_id', safeId);

  if (error) throw error;

  // Garantia extra: se por algum motivo vier algo fora, filtra novamente no client
  const rows = (data || []) as DemandDocumentRow[];
  return rows.filter(r => r?.demand_id === safeId);
}

/**
 * ✅ Path FIXO de verdade (1 arquivo por demanda + docType)
 * - NÃO usa o nome original do arquivo
 * - garante que upload com upsert:true substitui sempre o mesmo arquivo
 */
function buildFixedPath(demandId: string, docType: DemandDocType, fileName?: string) {
  const safeId = (demandId ?? '').trim();

  // tenta manter extensão original se existir, senão ".pdf"
  const extMatch = (fileName ?? '').toLowerCase().match(/\.(pdf)$/);
  const ext = extMatch ? extMatch[0] : '.pdf';

  return `demands/${safeId}/${docType}${ext}`;
}

/**
 * Upload do PDF no storage (substitui o anterior por path fixo)
 */
export async function uploadDemandPdf(
  demandId: string,
  docType: DemandDocType,
  file: File
): Promise<{ path: string }> {
  const safeId = (demandId ?? '').trim();
  if (!safeId) throw new Error('demandId inválido para upload.');
  if (!file) throw new Error('Arquivo inválido para upload.');

  const path = buildFixedPath(safeId, docType, file.name);

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: true
  });

  if (error) throw error;
  return { path };
}

/**
 * UPSERT (demand_id, doc_type) único
 */
export async function upsertDemandDocument(
  payload: Omit<DemandDocumentRow, 'id' | 'created_at' | 'updated_at'>
) {
  const safeId = (payload?.demand_id ?? '').trim();
  if (!safeId) throw new Error('demand_id inválido no upsertDemandDocument.');

  // garante updated_at (caso não tenha trigger)
  const dataToUpsert: any = {
    ...payload,
    demand_id: safeId,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('demand_documents')
    .upsert(dataToUpsert, { onConflict: 'demand_id,doc_type' })
    .select(SELECT_FIELDS)
    .single();

  return { data: (data as DemandDocumentRow | null) ?? null, error };
}

/**
 * Fluxo completo recomendado:
 * 1) upload storage
 * 2) upsert na tabela demand_documents
 */
export async function uploadAndUpsertDemandPdf(
  demandId: string,
  docType: DemandDocType,
  file: File
) {
  const safeId = (demandId ?? '').trim();
  if (!safeId) throw new Error('demandId inválido.');

  const { path } = await uploadDemandPdf(safeId, docType, file);

  return upsertDemandDocument({
    demand_id: safeId,
    doc_type: docType,
    file_path: path,
    file_name: file.name,
    mime_type: file.type || 'application/pdf'
  });
}

/**
 * Signed URL (bucket privado)
 */
export async function getDemandDocumentSignedUrl(filePath: string, expiresInSeconds = 60) {
  const safePath = (filePath ?? '').trim();
  if (!safePath) return { data: null, error: new Error('filePath inválido') as any };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(safePath, expiresInSeconds);

  return { data, error }; // data.signedUrl
}

/**
 * Remover arquivo do storage (opcional)
 */
export async function deleteDemandDocumentFile(filePath: string) {
  const safePath = (filePath ?? '').trim();
  if (!safePath) return { data: null, error: null };

  const { data, error } = await supabase.storage.from(BUCKET).remove([safePath]);
  return { data, error };
}

/**
 * ✅ Remove TODOS os documentos de uma demanda:
 * - apaga arquivos do storage
 * - apaga linhas na tabela demand_documents
 *
 * Use isso quando excluir a demanda (antes ou depois de deletar a demanda).
 */
export async function deleteDemandDocumentsByDemandId(demandId: string) {
  const safeId = (demandId ?? '').trim();
  if (!safeId) return { ok: true };

  // 1) busca docs para saber os paths
  const docs = await fetchDemandDocumentsByDemandId(safeId);

  // 2) remove arquivos do storage (se existirem)
  const paths = docs.map(d => d.file_path).filter(Boolean);

  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) {
      // não aborta automaticamente, mas retorna erro para você tratar se quiser
      return { ok: false, error: storageError };
    }
  }

  // 3) remove linhas da tabela
  const { error: dbError } = await supabase.from('demand_documents').delete().eq('demand_id', safeId);
  if (dbError) return { ok: false, error: dbError };

  return { ok: true };
}
