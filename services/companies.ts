import { supabase } from "../lib/supabase";

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

export async function fetchCompanies(): Promise<CompanyRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
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
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CompanyRow[];
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
  const { error } = await supabase
    .from("companies")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteCompanyById(id: string): Promise<void> {
  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
