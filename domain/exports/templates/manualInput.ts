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
 *   • percentual → `parseMoneyBR` aceitando "%" no fim ("20%" = "20" = 0,2);
 *     "R$" é erro (16/11/2026);
 *   • horas → `parseHorasDigitadas` ("7,333" = 7h20 é legítimo; horas não
 *     são dinheiro);
 *   • demais formatos → `parseMoneyBR`, a mesma regra pt-BR do item de
 *     despesa — símbolo ("%", letras) continua recusado;
 *   • ILEGÍVEL → `{ ok: false }` com a mensagem do campo. Quem chama NÃO
 *     registra edição nenhuma: o valor salvo fica intocado.
 *
 * Puro (só importa o parser): roda no smoke sem React.
 */
import { mensagemValorInvalido, parseHorasDigitadas, parseMoneyBR, type MotivoValorInvalido } from '../../moneyBR';
import type { TemplateColumn } from './types';

export type ConversaoCampoManual =
  | { ok: true; value: number | string | null; motivo?: undefined; mensagem?: undefined }
  | { ok: false; motivo: MotivoValorInvalido; mensagem: string; value?: undefined };

/** "%" no FIM (com ou sem espaço antes): só o campo de percentual aceita. */
const PERCENT_NO_FIM = /[\s ]*%[\s ]*$/;
const MENSAGEM_PERCENTUAL = 'Percentual não reconhecido — use 20 ou 20%';

/**
 * Percentual digitado: "20", "20%", "20 %", "12,5%" → fração (0,2 / 0,125).
 * "R$" num percentual é erro (o "R$" do parser vale só para dinheiro).
 */
function lerPercentual(raw: string): ConversaoCampoManual {
  if (/R\$/i.test(raw)) return { ok: false, motivo: 'letras', mensagem: MENSAGEM_PERCENTUAL };
  const lido = parseMoneyBR(raw.replace(PERCENT_NO_FIM, ''));
  if (!lido.ok) return { ok: false, motivo: lido.motivo, mensagem: lido.motivo === 'vazio' ? MENSAGEM_PERCENTUAL : mensagemValorInvalido(lido.motivo).replace('use 1.234,56', 'use 20 ou 20%') };
  return { ok: true, value: lido.valor / 100 };
}

export function converterCampoManual(col: Pick<TemplateColumn, 'format'>, raw: string): ConversaoCampoManual {
  if (col.format === 'text') return { ok: true, value: raw };
  if (raw.trim() === '') return { ok: true, value: null };
  // Percentual aceita "%" no fim; os demais formatos continuam recusando o símbolo.
  if (col.format === 'percent') return lerPercentual(raw);
  // Horas não são dinheiro: "7,333" (7h20) é legítimo — leitura própria, erro se ilegível.
  if (col.format === 'hours') {
    const h = parseHorasDigitadas(raw);
    return h.ok === false
      ? { ok: false, motivo: h.motivo, mensagem: 'Horas não reconhecidas — use 7,5 ou 7,333' }
      : { ok: true, value: h.valor };
  }
  const lido = parseMoneyBR(raw);
  if (!lido.ok) return { ok: false, motivo: lido.motivo, mensagem: mensagemValorInvalido(lido.motivo) };
  return { ok: true, value: lido.valor };
}

export type ConversaoValorFixo =
  | { ok: true; valor: number | string; mensagem?: undefined }
  | { ok: false; mensagem: string; valor?: undefined };

/**
 * VALOR FIXO de um modelo por empresa (ModeloMapeamento: "percentual de
 * despesa = 20%", o número do contrato...). Vai para a medição do cliente,
 * então número passa pela MESMA regra pt-BR (antes era
 * `Number(texto.replace('%','').replace(',', '.'))`, que lia "1.234,56" como
 * texto e "1.234" como 1,234):
 *   • "20%" / "12,5 %" → fração (0,2 / 0,125);
 *   • número pt-BR ("1.234,56", "R$ 10,00", "5900123435") → número;
 *   • com letras ou símbolos que não são número ("Contrato 4600/2026") → texto, como antes;
 *   • número que o parser RECUSA (ambíguo "1.234", formato americano,
 *     negativo, 3+ casas) → erro: a constante não entra até corrigir.
 */
export function converterValorFixo(raw: string): ConversaoValorFixo {
  const t = raw.trim();
  if (t === '') return { ok: true, valor: '' };
  if (PERCENT_NO_FIM.test(t)) {
    const p = lerPercentual(t);
    return p.ok === false ? { ok: false, mensagem: p.mensagem } : { ok: true, valor: p.value as number };
  }
  const lido = parseMoneyBR(t);
  if (lido.ok) return { ok: true, valor: lido.valor };
  if (lido.motivo === 'letras' || lido.motivo === 'ilegivel') return { ok: true, valor: t };
  return { ok: false, mensagem: mensagemValorInvalido(lido.motivo) };
}
