/**
 * PREÇO HH DA HÍBRIDA — o estado dos dois preços, para a grade e o painel
 *
 * Um treinamento híbrido tem DOIS preços (presencial e online) nas chaves
 * `TemplateColumn.hybridKeys`, com a mesma precedência de sempre (sobrescrita
 * na turma vence o treinamento). Esta função responde, sem React, o que a
 * tela precisa mostrar: cada preço resolvido, o selo do card e o preço único
 * antigo que ficou gravado antes de a híbrida ter duas chaves — que aparece,
 * mas NUNCA é usado por uma parte (ver resolve.ts, `manualColumnKey`).
 */
import { resolveManualValue, type ManualRefs, type ManualValueResolution } from './resolve';
import type { TemplateColumn } from './types';
import { getTemplateValue, type TemplateValuesIndex } from './values';

export type HybridPriceBadge = 'com preço' | 'falta online' | 'falta presencial' | 'sem preço';

export interface HybridPriceStatus {
  presencial: ManualValueResolution;
  online: ManualValueResolution;
  /** "com preço" SÓ com os dois preenchidos. */
  selo: HybridPriceBadge;
  completo: boolean;
  /** `precoHH` único gravado no TREINAMENTO antes da divisão; null quando não há. */
  precoUnicoAntigo: number | null;
}

const temValor = (r: ManualValueResolution) => r.fonte !== 'vazio';

export function hybridPriceStatus(
  column: TemplateColumn,
  refs: Omit<ManualRefs, 'parte'>,
  values: TemplateValuesIndex
): HybridPriceStatus {
  const presencial = resolveManualValue(column, { ...refs, parte: 'PRESENCIAL' }, values);
  const online = resolveManualValue(column, { ...refs, parte: 'ONLINE' }, values);
  const p = temValor(presencial);
  const o = temValor(online);
  const selo: HybridPriceBadge = p && o ? 'com preço' : p ? 'falta online' : o ? 'falta presencial' : 'sem preço';

  const unico = refs.trainingId ? getTemplateValue(values, 'training', refs.trainingId, column.key) : undefined;
  const n = Number(unico);
  const precoUnicoAntigo = unico !== undefined && unico !== null && unico !== '' && Number.isFinite(n) ? n : null;

  return { presencial, online, selo, completo: p && o, precoUnicoAntigo };
}
