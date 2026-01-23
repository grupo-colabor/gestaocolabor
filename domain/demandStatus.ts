/**
 * MOTOR DE STATUS DE DEMANDA (Lógica de Domínio)
 * Responsável por calcular o status REAL da demanda.
 */

export type DemandStatus =
  | 'NOVA'
  | 'PENDENTE'
  | 'ALOCADA'
  | 'EM_ANDAMENTO'
  | 'CONCLUIDA'
  | 'CANCELADA';

export interface DemandStatusInput {
  startDate: string | Date;
  endDate: string | Date;
  instructorId?: string | null;
  cancelled?: boolean;
  trainingLocal?: string;
  modality?: string; // IMPORTANTE: deve vir da modalidade do TREINAMENTO (fonte de verdade)
}

const normalizeModality = (value: any) => {
  const v = String(value ?? '').trim().toUpperCase();
  // aceita variações comuns
  if (v === 'HÍBRIDO') return 'HIBRIDO';
  return v;
};

export function calculateDemandStatus(
  input: DemandStatusInput,
  now: Date = new Date()
): DemandStatus {
  const {
    startDate,
    endDate,
    instructorId,
    cancelled,
    trainingLocal,
    modality,
  } = input;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const mode = normalizeModality(modality);

  // Proteção básica contra datas inválidas (não quebra o app)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    // se estiver cancelada, respeita; senão, retorna NOVA por segurança
    if (cancelled === true) return 'CANCELADA';
    return 'NOVA';
  }

  // 1️⃣ Cancelamento sempre ganha
  if (cancelled === true) return 'CANCELADA';

  // 2️⃣ REGRA EXCLUSIVA — ONLINE / TUTORIA
  // Não exige instrutor e NUNCA deve cair em PENDENTE
  if (mode === 'ONLINE' || mode === 'TUTORIA') {
    if (now > end) return 'CONCLUIDA';
    if (now >= start && now <= end) return 'EM_ANDAMENTO';
    return 'ALOCADA'; // futura
  }

  // 3️⃣ Concluída (para presencial / híbrido)
  if (now > end) return 'CONCLUIDA';

  // 4️⃣ Em andamento (exige instrutor)
  if (instructorId && now >= start && now <= end) {
    return 'EM_ANDAMENTO';
  }

  // 5️⃣ Alocada futura
  if (instructorId && now < start) {
    return 'ALOCADA';
  }

  // 6️⃣ Pendente (somente presencial / híbrido)
  if (!instructorId) {
    const diffMs = start.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 4) return 'PENDENTE';
    if (String(trainingLocal ?? '').trim().toUpperCase() === 'N/A') return 'PENDENTE';
  }

  // 7️⃣ Caso inicial
  return 'NOVA';
}

// ✅ Label centralizado para a Agenda (inclui marcação Noturno "(N)")
export function formatDemandLabel(input: {
  trainingNr?: string;
  companyName?: string;
  startDate?: string | Date;
  endDate?: string | Date;
}) {
  const trainingNr = String(input.trainingNr ?? '').trim();
  const companyName = String(input.companyName ?? '').trim();

  const base =
    trainingNr && companyName
      ? `${trainingNr} - ${companyName}`
      : trainingNr || companyName || 'Demanda';

  const hasTimeInfo = (v: any) => {
    const s = String(v ?? '');
    // detecta se tem hora (ex: 2026-01-23T18:00:00 ou "18:00")
    return s.includes('T') || /(\d{1,2}):(\d{2})/.test(s);
  };

  const isNight = (() => {
    if (!input.startDate || !input.endDate) return false;

    // Se não tiver hora no start/end, não arriscamos marcar como noturno
    if (!hasTimeInfo(input.startDate) && !hasTimeInfo(input.endDate)) return false;

    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;

    const sh = start.getHours();
    const eh = end.getHours();

    // Regra do seu pedido: 18h–6h
    // Marca noturno se:
    // - começa >= 18h
    // - OU termina <= 6h
    // - OU atravessa meia-noite (hora final menor que hora inicial)
    if (sh >= 18) return true;
    if (eh <= 6) return true;
    if (sh > eh) return true;

    return false;
  })();

  return isNight ? `${base} (N)` : base;
}
