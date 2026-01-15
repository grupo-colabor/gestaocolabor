import { supabase } from '../lib/supabase';

/**
 * MVP (Supabase)
 * - public.instructors: id, full_name, email, region, is_active, created_at...
 * - public.instructor_trainings: instructor_id, training_id, level
 */

export type InstructorRow = {
  id: string;
  full_name: string;
  email: string | null;
  region: string | null;
  is_active: boolean | null;
};

export type InstructorTrainingRow = {
  instructor_id: string;
  training_id: string;
  level: string | null;
};

export async function fetchInstructors(): Promise<InstructorRow[]> {
  const { data, error } = await supabase
    .from('instructors')
    .select('id, full_name, email, region, is_active')
    .order('full_name', { ascending: true });

  if (error) throw error;
  return (data || []) as InstructorRow[];
}

export async function fetchInstructorTrainings(): Promise<InstructorTrainingRow[]> {
  const { data, error } = await supabase
    .from('instructor_trainings')
    .select('instructor_id, training_id, level');

  if (error) throw error;
  return (data || []) as InstructorTrainingRow[];
}
