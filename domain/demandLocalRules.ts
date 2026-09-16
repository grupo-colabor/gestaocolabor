/**
 * LOCAL DO TREINAMENTO — quando é obrigatório e o que conta como preenchido
 *
 * Regra geral (já existia, em Demands.tsx): o local é obrigatório nas
 * modalidades que exigem logística (PRESENCIAL / HÍBRIDO / TUTORIA) e opcional
 * no online, onde 'N/A' é resposta válida.
 *
 * Regra da VALE (09/2026): a turma precisa de mina/site em QUALQUER modalidade,
 * online inclusive — a Medição Vale e o BM agrupam por local, e turma sem local
 * fica fora do BM (o painel de pendências avisa "turma sem local"). Então, para
 * empresa cujo nome contém "VALE" (o mesmo gate que mostra o campo ID SAP),
 * vazio e 'N/A' (qualquer caixa) são recusados no formulário, na criação e na
 * edição. Demandas antigas não são alteradas pelo código: as 40 sem local
 * foram listadas para correção manual.
 *
 * Sem import de React: roda no smoke em Node.
 */
import { requiresLogistics } from './modalityRules';

/** O gate da Vale no formulário: nome da empresa contém "VALE" (o mesmo do campo ID SAP). */
export const isValeCompanyName = (name?: string | null): boolean =>
  String(name ?? '').toUpperCase().includes('VALE');

/** 'N/A' em qualquer caixa/espaçamento. */
export const isNALocal = (local?: string | null): boolean =>
  String(local ?? '').trim().toUpperCase() === 'N/A';

/** O local é obrigatório para esta demanda? */
export const localObrigatorio = (modality?: string | null, isVale = false): boolean =>
  isVale || requiresLogistics(modality);

export const MSG_LOCAL_VALE = 'Demanda Vale precisa de local (mina/site) para a medição e o BM';

/**
 * Motivo pelo qual o local NÃO passa na validação, ou `null` quando passa.
 *   • Vale: vazio ou 'N/A' → MSG_LOCAL_VALE (em qualquer modalidade).
 *   • Demais empresas: vazio só é erro onde a modalidade exige logística; 'N/A'
 *     continua aceito no online (comportamento anterior, intocado).
 */
export function motivoLocalInvalido(
  local: string | null | undefined,
  modality: string | null | undefined,
  isVale: boolean
): string | null {
  const vazio = String(local ?? '').trim() === '';
  if (isVale) {
    if (vazio || isNALocal(local)) return MSG_LOCAL_VALE;
    return null;
  }
  if (requiresLogistics(modality) && vazio) return 'Informe o local do treinamento';
  return null;
}
