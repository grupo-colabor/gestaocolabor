import { supabase } from "../lib/supabase";

export type TrainingRow = {
  id: string;
  name: string;
  nr: string | null;
  category: string | null;
  area_id: string | null;
  hours: number | null;
  practical_hours: number | null;
  modality: string | null;
  status: string | null;
  description_short: string | null;
  created_at: string;
};

export async function fetchTrainings(): Promise<TrainingRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trainings")
    .select("id, name, nr, category, area_id, hours, practical_hours, modality, status, description_short, created_at")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TrainingRow[];
}

export async function deleteTrainingById(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("trainings")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) throw error;
  // ⚠️ RLS sem policy de DELETE não gera `error` — só casa 0 linhas e responde
  // "sucesso" vazio. Sem este check o app mostrava "excluído com sucesso" e o
  // registro voltava no próximo reload (bug real: catálogo de treinamentos).
  if (!data || data.length === 0) {
    throw new Error("Nenhuma linha excluída (trainings) — verifique permissões (RLS).");
  }
}
