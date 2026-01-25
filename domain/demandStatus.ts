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

// ===================================================
// ✅ NOTURNO (timezone-safe)
// - NÃO usa new Date() para extrair hora (evita shift por timezone)
// - Extrai HH:mm direto da string (YYYY-MM-DDTHH:mm / ISO)
// ===================================================

const getHHMM = (v?: string | Date | null) => {
  if (!v) return null;

  // Se vier Date, extrai HH:mm do próprio Date (caso raro)
  // (mas a preferência do app é string, então não depende disso)
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const hh = v.getHours();
    const mm = v.getMinutes();
    return { hh, mm, total: hh * 60 + mm };
  }

  const s = String(v).trim();
  if (!s) return null;

  // pega HH:mm de qualquer coisa que tenha "T"
  const m = s.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  return { hh, mm, total: hh * 60 + mm };
};

const isNightShift = (start?: string | Date | null, end?: string | Date | null) => {
  const s = getHHMM(start);
  const e = getHHMM(end);
  if (!s || !e) return false;

  const nightStart = 18 * 60; // 18:00
  const nightEnd = 6 * 60;    // 06:00

  // Regra pedida: "18h–6h"
  // Marca noturno se:
  // - começa >= 18:00, OU
  // - termina <= 06:00, OU
  // - cruza meia-noite (end menor que start)
  return s.total >= nightStart || e.total <= nightEnd || e.total < s.total;
};

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

  // ✅ Agora é timezone-safe: usa extractor HH:mm da string
  const nightTag = isNightShift(input.startDate ?? null, input.endDate ?? null) ? ' (N)' : '';

  return `${base}${nightTag}`;
}
