import { supabase } from "../lib/supabase";

export type TrainingRow = {
  id: string;
  name: string;
  nr: string | null;
  category: string | null;
  area_id: string | null;
  hours: number | null;
  modality: string | null;
  status: string | null;
  created_at: string;
};

export async function fetchTrainings(): Promise<TrainingRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("trainings")
    .select("id, name, nr, category, area_id, hours, modality, status, description_short, created_at")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TrainingRow[];
}
