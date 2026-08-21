import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

/**
 * MVP (Supabase)
 * - public.instructors: id, full_name, email, region, is_active, created_at...
 * - public.instructor_trainings: instructor_id, training_id, level
 */

export type InstructorRow = {
  id: string;
  full_name: string;
  email: string | null;
  cpf: string | null;
  region: string | null;
  is_active: boolean | null;
  residence_location: string | null;
  address: string | null;
  coverage_locations: string[] | null;
  operational_notes: string | null;
};

export type InstructorTrainingRow = {
  instructor_id: string;
  training_id: string;
  level: string | null;
};

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase — sem erro e sem
// aviso. Um instrutor faltando aqui some da alocação, da agenda e do export
// de medição (onde o nome viraria "Instrutor <uuid>").
export async function fetchInstructors(): Promise<InstructorRow[]> {
  return fetchAllPaginated<InstructorRow>((from, to) =>
    supabase
      .from('instructors')
      .select(`
    id,
    full_name,
    email,
    cpf,
    region,
    is_active,
    residence_location,
    address,
    coverage_locations,
    agenda_role,
    operational_notes
   `)
      .order('full_name', { ascending: true })
      .order('id', { ascending: true }) // desempate: sem chave única a ordem entre páginas não é estável
      .range(from, to)
  );
}

// Pagina via fetchAllPaginated: select() sem .range() é cortado
// silenciosamente em ~1000 linhas pelo PostgREST/Supabase — sem erro e sem
// aviso. Esta é a tabela mais exposta ao corte de todas: sendo a pivot
// instrutores × treinamentos, cresce pelo produto das duas. Uma linha perdida
// aqui tira uma habilidade do instrutor em silêncio, e habilidade é o que
// filtra quem pode ser alocado numa demanda.
//
// Desempate: a tabela não tem coluna `id` (a chave é o par
// instrutor+treinamento), então a ordem estável entre páginas é o par.
export async function fetchInstructorTrainings(): Promise<InstructorTrainingRow[]> {
  return fetchAllPaginated<InstructorTrainingRow>((from, to) =>
    supabase
      .from('instructor_trainings')
      .select('instructor_id, training_id, level')
      .order('instructor_id', { ascending: true })
      .order('training_id', { ascending: true })
      .range(from, to)
  );
}

export async function deleteInstructorById(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('instructors')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha excluída (instructors) — verifique permissões (RLS).');
  }
}
