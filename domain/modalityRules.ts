export const MODALITIES_REQUIRING_INSTRUCTOR = [
  'PRESENCIAL',
  'HIBRIDO',
  'ONLINE_AO_VIVO',
] as const;

export const MODALITIES_REQUIRING_LOGISTICS = [
  'PRESENCIAL',
  'HIBRIDO',
  'TUTORIA',
] as const;

export const requiresInstructor = (m?: string | null): boolean =>
  (MODALITIES_REQUIRING_INSTRUCTOR as readonly string[]).includes(
    (m ?? '').toUpperCase()
  );

export const requiresLogistics = (m?: string | null): boolean =>
  (MODALITIES_REQUIRING_LOGISTICS as readonly string[]).includes(
    (m ?? '').toUpperCase()
  );

/** Alias semântico: demandas que precisam ser "programadas" (ter instrutor alocado via Programação). */
export const requiresScheduling = requiresInstructor;

export const isEAD = (m?: string | null): boolean => {
  const upper = (m ?? '').toUpperCase();
  return (
    upper === 'ONLINE' ||
    upper === 'EAD' ||
    upper === 'TUTORIA' ||
    upper === 'ONLINE_AO_VIVO'
  );
};
