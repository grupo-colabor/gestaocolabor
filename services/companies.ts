import { supabase } from "../lib/supabase";

export type CompanyRow = {
  id: string;
  name: string;
  created_at: string;
};

export async function fetchCompanies(): Promise<CompanyRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, created_at")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CompanyRow[];
}
