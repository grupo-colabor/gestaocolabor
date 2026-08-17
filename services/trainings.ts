import { supabase } from "../lib/supabase";
import { fetchAllPaginated } from "./pagination";

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

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase — sem erro e sem
// aviso. `trainings` ainda está abaixo do corte, mas um treinamento faltando
// aqui se propaga em silêncio para todo o app (carga horária, modalidade e,
// no export de medição, o nome do treinamento vira "—").
export async function fetchTrainings(): Promise<TrainingRow[]> {
  if (!supabase) return [];

  return fetchAllPaginated<TrainingRow>((from, to) =>
    supabase
      .from("trainings")
      .select("id, name, nr, category, area_id, hours, practical_hours, modality, status, description_short, created_at")
      .order("name", { ascending: true })
      .order("id", { ascending: true }) // desempate: sem chave única a ordem entre páginas não é estável
      .range(from, to)
  );
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
