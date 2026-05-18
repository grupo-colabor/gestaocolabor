import React from 'react';

export type Status = 'NOVA' | 'PENDENTE' | 'ALOCADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

const STATUS_MAP: Record<Status, { label: string; bg: string; color: string }> = {
  NOVA:         { label: 'Nova',         bg: 'var(--status-nova-bg)',      color: 'var(--status-nova-text)' },
  PENDENTE:     { label: 'Pendente',     bg: 'var(--status-pendente-bg)',  color: 'var(--status-pendente-text)' },
  ALOCADA:      { label: 'Alocada',      bg: 'var(--status-alocada-bg)',   color: 'var(--status-alocada-text)' },
  EM_ANDAMENTO: { label: 'Em andamento', bg: 'var(--status-andamento-bg)', color: 'var(--status-andamento-text)' },
  CONCLUIDA:    { label: 'Concluída',    bg: 'var(--status-concluida-bg)', color: 'var(--status-concluida-text)' },
  CANCELADA:    { label: 'Cancelada',    bg: 'var(--status-cancelada-bg)', color: 'var(--status-cancelada-text)' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status as Status] ?? { label: status, bg: '#F2F2F2', color: '#6B6B6B' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      fontSize: '12px',
      fontWeight: 500,
      background: s.bg,
      color: s.color,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

export const STATUS_CHART_COLORS: Record<Status, string> = {
  NOVA:         '#7C3AED',
  PENDENTE:     '#D97706',
  ALOCADA:      '#0891B2',
  EM_ANDAMENTO: '#16A34A',
  CONCLUIDA:    '#059669',
  CANCELADA:    '#E11D48',
};
