/**
 * CAMPOS MANUAIS (Medição Vale / BM e modelos por empresa) — o que a pessoa
 * digitou na grade vira o quê
 *
 * Extraído de GradeEditavel.tsx, onde o conversor era
 * `Number(texto.replace(',', '.'))` e o ilegível virava `null`. `null` é
 * "campo esvaziado", que o Salvar transforma em DELETE: "1.234,56", "R$ 45"
 * ou "20%" APAGAVAM o valor salvo, e a célula caía no padrão — combustível 0,
 * % 20% — sem aviso nenhum.
 *
 * Agora:
 *   • coluna `text` → o texto, como foi digitado;
 *   • campo em BRANCO → `null`: limpar de propósito continua apagando a
 *     sobrescrita (e a célula volta ao valor de treinamento / padrão);
 *   • qualquer outro formato → `parseMoneyBR`, a mesma regra pt-BR do item
 *     de despesa (percent divide por 100, como antes);
 *   • ILEGÍVEL → `{ ok: false }` com a mensagem do campo. Quem chama NÃO
 *     registra edição nenhuma: o valor salvo fica intocado.
 *
 * Puro (só importa o parser): roda no smoke sem React.
 */
import { mensagemValorInvalido, parseMoneyBR, type MotivoValorInvalido } from '../../moneyBR';
import type { TemplateColumn } from './types';

export type ConversaoCampoManual =
  | { ok: true; value: number | string | null; motivo?: undefined; mensagem?: undefined }
  | { ok: false; motivo: MotivoValorInvalido; mensagem: string; value?: undefined };

export function converterCampoManual(col: Pick<TemplateColumn, 'format'>, raw: string): ConversaoCampoManual {
  if (col.format === 'text') return { ok: true, value: raw };
  if (raw.trim() === '') return { ok: true, value: null };
  const lido = parseMoneyBR(raw);
  if (!lido.ok) return { ok: false, motivo: lido.motivo, mensagem: mensagemValorInvalido(lido.motivo) };
  return { ok: true, value: col.format === 'percent' ? lido.valor / 100 : lido.valor };
}
