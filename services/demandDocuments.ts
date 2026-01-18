import { supabase } from '../lib/supabase';

export type DemandDocType = 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR';

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
 * Gera um path FIXO (1 arquivo por demanda + docType)
 * Assim o upload com upsert:true realmente substitui o arquivo.
 */
function buildFixedPath(demandId: string, docType: DemandDocType, fileName: string) {
  const safeName = (fileName || 'arquivo.pdf').replace(/[^\w.\-() ]/g, '_');
  return `demands/${demandId}/${docType}-${safeName}`;
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
  const { path } = await uploadDemandPdf(demandId, docType, file);

  return upsertDemandDocument({
    demand_id: demandId,
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

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(safePath, expiresInSeconds);
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
