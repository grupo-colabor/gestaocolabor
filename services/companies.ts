import { supabase } from "../lib/supabase";
import { fetchAllPaginated } from "./pagination";

export type CompanyRow = {
  id: string;
  name: string;
  razao_social: string | null;
  cnpj: string | null;
  segment: string | null;
  status: string | null;
  logistics_type: string | null;
  cidade: string | null;
  estado: string | null;
  observations: string | null;
  created_at: string;
};

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase — sem erro e sem
// aviso. Aqui não é só rótulo: o nome da empresa é a CHAVE de casamento da
// tarifa no export de medição (services/medicaoWorkbook.ts). Empresa cortada
// da busca vira "(empresa não encontrada)" e ganha linha própria na aba
// Tarifas, quebrando a conferência de pagamento.
export async function fetchCompanies(): Promise<CompanyRow[]> {
  if (!supabase) return [];

  return fetchAllPaginated<CompanyRow>((from, to) =>
    supabase
      .from("companies")
      .select(`
      id,
      name,
      razao_social,
      cnpj,
      segment,
      status,
      logistics_type,
      cidade,
      estado,
      observations,
      created_at
    `)
      .order("name", { ascending: true })
      .order("id", { ascending: true }) // desempate: sem chave única a ordem entre páginas não é estável
      .range(from, to)
  );
}

export async function insertCompany(payload: {
  name: string;
  razao_social?: string;
  cnpj?: string;
  segment?: string;
  status?: string;
  logistics_type?: string;
  cidade?: string;
  estado?: string;
  observations?: string;
}): Promise<CompanyRow> {
  const { data, error } = await supabase
    .from("companies")
    .insert(payload)
    .select("id, name, razao_social, cnpj, segment, status, logistics_type, cidade, estado, observations, created_at")
    .single();

  if (error) throw error;
  return data as CompanyRow;
}

export async function updateCompanyById(
  id: string,
  payload: Partial<Omit<CompanyRow, "id" | "created_at">>
): Promise<void> {
  const { data, error } = await supabase
    .from("companies")
    .update(payload)
    .eq("id", id)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Nenhuma linha atualizada (companies) — verifique permissões (RLS).");
  }
}

export async function deleteCompanyById(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("companies")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Nenhuma linha excluída (companies) — verifique permissões (RLS).");
  }
}
