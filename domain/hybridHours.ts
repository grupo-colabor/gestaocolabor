/**
 * HORAS DA HÍBRIDA — a leitura de `practicalHours`, uma vez só
 *
 * O cadastro do treinamento híbrido guarda a parte PRESENCIAL em
 * `practicalHours`; a carga total (`hours`) inclui a EAD. Dois usos leem esse
 * campo, com políticas diferentes para o campo inválido:
 *
 *   • PAGAMENTO e DASHBOARD (`effectiveDemandHours`, domain/instructorHours.ts):
 *     híbrida vale as horas práticas; sem elas, cai na carga total — o rateio
 *     precisa de um número, e o painel de medição é quem corrige.
 *   • MEDIÇÃO VALE / BM: a híbrida sai em DUAS linhas (presencial e online),
 *     cada uma com a sua carga e o seu preço HH. Aqui NÃO há fallback: campo
 *     inválido é carga em branco/amarela nas duas linhas e aviso no painel,
 *     porque a carga total numa linha só cobraria a EAD a preço presencial.
 *
 * `practicalHoursOf` é o PREDICADO comum ("há horas práticas utilizáveis?");
 * `splitHybridHours` é a política da Vale. Uma leitura, duas políticas — a
 * regra de "o que é um practicalHours válido" não existe em dois lugares.
 *
 * ⚠️ Por que o cadastro e não a medição: o pagamento do instrutor segue as
 * horas DIGITADAS na medição (domain/measurementTotals.ts, "HÍBRIDA × qualquer
 * papel"), porque o split realizado varia por turma. A Vale, por contrato,
 * cobra pela carga CADASTRADA do treinamento, dividida como o cadastro diz —
 * decisão de 20/10/2026. Mudar `practicalHours` muda a divisão de toda
 * medição regerada, inclusive de meses fechados (o manual avisa).
 */
import { isHybridModality } from './modalityRules';

/** Só o que estas funções leem do treinamento. */
export interface HybridTrainingLike {
  hours?: number | null;
  practicalHours?: number | null;
  modality?: string | null;
}

/**
 * Horas práticas UTILIZÁVEIS: número finito maior que zero. Senão `null` — o
 * que o cadastro grava quando o campo fica em branco (App.tsx, mapTrainingToDb).
 */
export function practicalHoursOf(training: HybridTrainingLike | undefined | null): number | null {
  const v = training?.practicalHours;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** O treinamento é híbrido? A modalidade do TREINAMENTO decide. */
export const isHybridTraining = (training: HybridTrainingLike | undefined | null): boolean =>
  isHybridModality(training?.modality);

export type HybridSplitProblem = 'SEM_HORAS_PRATICAS' | 'HORAS_PRATICAS_INVALIDAS' | 'SEM_CARGA';

export type HybridSplit =
  | { ok: true; presencial: number; online: number; hours: number }
  | { ok: false; motivo: HybridSplitProblem; texto: string; hours: number; practicalHours: number | null };

/**
 * Presencial = `practicalHours`; online = `hours − practicalHours`.
 *
 * Inválido (nunca inventa, nunca zera em silêncio):
 *   • `hours` ≤ 0 ou não numérico           → SEM_CARGA;
 *   • `practicalHours` em branco / ≤ 0      → SEM_HORAS_PRATICAS;
 *   • `practicalHours` ≥ `hours`            → HORAS_PRATICAS_INVALIDAS (a parte
 *     online seria zero ou negativa).
 */
export function splitHybridHours(training: HybridTrainingLike | undefined | null): HybridSplit {
  const hours = typeof training?.hours === 'number' && Number.isFinite(training.hours) ? training.hours : 0;
  const practicalHours = practicalHoursOf(training);

  if (hours <= 0) {
    return { ok: false, motivo: 'SEM_CARGA', texto: 'Treinamento híbrido sem carga horária cadastrada', hours, practicalHours };
  }
  if (practicalHours === null) {
    return { ok: false, motivo: 'SEM_HORAS_PRATICAS', texto: 'Treinamento híbrido sem horas práticas cadastradas', hours, practicalHours };
  }
  if (practicalHours >= hours) {
    return {
      ok: false,
      motivo: 'HORAS_PRATICAS_INVALIDAS',
      texto: `Treinamento híbrido com horas práticas inválidas (${practicalHours}h de ${hours}h — a parte online ficaria sem carga)`,
      hours,
      practicalHours,
    };
  }
  return { ok: true, presencial: practicalHours, online: Math.round((hours - practicalHours) * 100) / 100, hours };
}

/** Rótulo curto para a tela: "8h presenciais + 32h online". */
export function describeHybridSplit(split: HybridSplit): string {
  return split.ok === true ? `${split.presencial}h presenciais + ${split.online}h online` : split.texto;
}
