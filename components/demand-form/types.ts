import type { Dispatch, SetStateAction } from 'react';
import type { Demand } from '../../types';

/**
 * Rascunho do formulário de demanda — o mesmo shape que `Demands.tsx` usa no
 * `useState` do `formDemand`, agora nomeado para que as seções extraídas e o
 * formulário de demanda interna compartilhem exatamente o mesmo contrato.
 *
 * Continua sendo `Partial<...>` porque o formulário começa vazio e só vira uma
 * `Demand` completa no save.
 */
export type DemandFormState = Partial<
  Demand & {
    cancelledAt?: string;
    attachments?: {
      classListPdf?: { name: string; base64: string };
      instructorReleasePdf?: { name: string; base64: string };
    };
    cancelInfo?: { reason: string; note: string; date: string };
  }
>;

export type DemandFormSetter = Dispatch<SetStateAction<DemandFormState>>;

/** VIEW = leitura (accordion de visualização), FORM = edição. */
export type DemandFormMode = 'VIEW' | 'FORM';

/**
 * Mesma assinatura do `setNotification` do AppContext — declarada aqui para as
 * seções não precisarem importar o contexto só por causa do tipo.
 */
export type NotifyFn = Dispatch<
  SetStateAction<{ message: string; type: 'info' | 'success' | 'error' } | null>
>;
