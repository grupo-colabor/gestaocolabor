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

/**
 * Demanda HÍBRIDA? Aceita as grafias que o cadastro já produziu ('HIBRIDO',
 * 'Híbrido', 'hibrido'). A modalidade do TREINAMENTO prevalece sobre a da
 * demanda — igual ao resto do app (ver resolveModality em instructorHours).
 *
 * Existe porque a medição de híbrida NÃO pode herdar a carga cheia do
 * treinamento como default de horas: o split presencial/online varia por
 * demanda (8+32, 16+24...) e só quem mede sabe as horas presenciais realizadas.
 */
export const isHybridModality = (m?: string | null): boolean => {
  // Tira acento sem regex de faixa unicode: 'Híbrido' -> 'Hibrido'.
  const semAcento = Array.from(String(m ?? '').normalize('NFD'))
    .filter(ch => {
      const c = ch.charCodeAt(0);
      return c < 0x300 || c > 0x36f;
    })
    .join('');
  return semAcento.trim().toUpperCase() === 'HIBRIDO';
};
