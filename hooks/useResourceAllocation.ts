import { useCallback, useState } from 'react';

import type { LogisticAllocation } from '../types';

/**
 * FLUXO DE ALOCAÇÃO DE CTM — estado e regras, fonte única
 *
 * A outra metade de `components/ResourceAllocationModal.tsx`. Extraído de
 * `Demands.tsx` (`handleOpenResourceModal` + `handleAddResourceAllocation`) sem
 * alteração de comportamento, para que o modal de demanda INTERNA use o MESMO
 * fluxo — mesmas validações bloqueantes, mesmo payload, mesma escrita.
 *
 * As duas validações são BLOQUEANTES (diferente do fluxo de instrutor, que só
 * avisa): período do CTM contido no da demanda, e conflito com outra reserva.
 * O conflito é neutro quanto a `tipo` — uma interna bloqueia uma de cliente e
 * vice-versa (ver `domain/resourceConflict.ts`).
 *
 * O slot de erro vem DE FORA porque em `Demands.tsx` ele é compartilhado com o
 * fluxo de instrutor e com um toast global; a interna passa um `useState`
 * próprio. Sem isso, extrair mudaria o comportamento do cliente.
 */

export interface UseResourceAllocationOptions {
  demand: { id?: string; startDate?: string; endDate?: string } | null | undefined;
  addResourceAllocation: (a: LogisticAllocation) => void;
  hasResourceConflict: (
    startDate: string,
    endDate: string,
    excludeDemandId?: string,
    excludeAllocationId?: string
  ) => boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** Guard de permissão (`alocarRecurso`). Falso = o fluxo não abre nem grava. */
  canAllocate?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Mesmo helper do modal de cliente: qualquer formato -> 'YYYY-MM-DD' local. */
const toLocalDateInput = (v?: string) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v.includes('T') ? v.split('T')[0] : v;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export function useResourceAllocation({
  demand,
  addResourceAllocation,
  hasResourceConflict,
  error,
  setError,
  canAllocate = true,
}: UseResourceAllocationOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '' });

  const failWith = useCallback((message: string) => {
    setError(message);
    setTimeout(() => setError(null), 4000);
  }, [setError]);

  const open = useCallback(() => {
    if (!demand?.id) return;
    if (!canAllocate) return;
    setError(null);
    setForm({
      startDate: toLocalDateInput(demand.startDate) || '',
      endDate: toLocalDateInput(demand.endDate) || '',
    });
    setIsOpen(true);
  }, [demand?.id, demand?.startDate, demand?.endDate, canAllocate, setError]);

  const close = useCallback(() => setIsOpen(false), []);

  const confirm = useCallback(() => {
    setError(null);

    // Guard defensivo: esconder o botão não basta se o estado de permissão
    // mudar com o modal aberto.
    if (!canAllocate) {
      failWith('Seu perfil não tem permissão para alocar o Centro Móvel.');
      return;
    }
    if (!demand?.id) return;

    if (!form.startDate || !form.endDate) {
      failWith('Preencha as datas de alocação do CTM.');
      return;
    }

    const normalizeStart = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T00:00:00');
    const normalizeEnd = (dateStr: string) => new Date(dateStr.split('T')[0] + 'T23:59:59');

    const allocStartLimit = normalizeStart(form.startDate);
    const allocEndLimit = normalizeEnd(form.endDate);
    const demandStartLimit = normalizeStart(demand.startDate!);
    const demandEndLimit = normalizeEnd(demand.endDate!);

    // 1. Validar limites da demanda
    if (allocStartLimit < demandStartLimit || allocEndLimit > demandEndLimit) {
      failWith('O período do CTM deve estar dentro do período da demanda.');
      return;
    }

    // 2. Validar conflito do CTM
    if (hasResourceConflict(form.startDate, form.endDate, demand.id)) {
      failWith('O Centro de Treinamento Móvel já possui um compromisso neste período.');
      return;
    }

    // ✅ Horário fixo para evitar deslocamento de timezone — "YYYY-MM-DDTHH:mm"
    // é interpretado como hora LOCAL. Mesmo padrão do Logistics.tsx.
    const buildDateTimeLocal = (date: string, fallbackTime: string) => {
      if (!date) return '';
      const dateOnly = date.split('T')[0];
      return `${dateOnly}T${fallbackTime}`;
    };

    const newAllocation: LogisticAllocation = {
      id: `RES-${Date.now()}`,
      demandId: demand.id,
      resourceType: 'CENTRO_TREINAMENTO_MOVEL',
      startDate: buildDateTimeLocal(form.startDate, '08:00'),
      endDate: buildDateTimeLocal(form.endDate, '18:00'),
    };

    addResourceAllocation(newAllocation);
    setIsOpen(false);
  }, [canAllocate, demand?.id, demand?.startDate, demand?.endDate, form, hasResourceConflict, addResourceAllocation, setError, failWith]);

  return {
    open,
    close,
    isOpen,
    /** Pronto para espalhar em <ResourceAllocationModal {...modalProps} />. */
    modalProps: {
      open: isOpen,
      startDate: form.startDate,
      endDate: form.endDate,
      onChangeStartDate: (value: string) => { setForm(f => ({ ...f, startDate: value })); setError(null); },
      onChangeEndDate: (value: string) => { setForm(f => ({ ...f, endDate: value })); setError(null); },
      demandStartDate: demand?.startDate,
      demandEndDate: demand?.endDate,
      error,
      onCancel: close,
      onConfirm: confirm,
    },
  };
}
