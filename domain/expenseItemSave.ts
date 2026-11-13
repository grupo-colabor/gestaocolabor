/**
 * SALVAR DO PAINEL DE MEDIÇÃO — os itens de despesa como vão para o banco
 *
 * Extraído de `handleSaveMeasurement` (Measurement.tsx), onde morava a cópia
 * que gravou por anos o valor lido errado: `parseFloat(texto.replace(',', '.'))`
 * transformava "1.234,56" em 1,234 e "R$ 10,00" em 0 NO BANCO, e o texto
 * digitado se perdia.
 *
 * Agora, para cada item:
 *
 *   • texto LEGÍVEL (parseMoneyBR) → `value` vira o número exato e
 *     `valorDigitado` guarda o texto como foi digitado (auditoria);
 *   • texto VAZIO → rascunho: `value: 0` (como sempre gravou) e sem
 *     `valorDigitado` — o painel mostra o selo "sem valor" (decisão 7);
 *   • número (item que ninguém editou) → intacto, inclusive `valorDigitado`
 *     de um salvar anterior;
 *   • texto ILEGÍVEL, ou número gravado cujo texto de edição o parser recusa
 *     (3+ casas, negativo) → o Salvar é BLOQUEADO e a lista volta para a
 *     tela (decisão 8). Nada é gravado pela metade.
 *
 * Medição antiga sem `valorDigitado` continua lendo igual: quem soma é `value`.
 */
import { mensagemValorInvalido, parseMoneyBR, type MotivoValorInvalido } from './moneyBR';
import { textoDeEdicao } from './expenseValueIssues';

/** O mínimo que o salvar lê de um item (o `Attachment` do app satisfaz). */
export interface SavableExpenseItem {
  id?: string;
  category?: string | null;
  value?: number | string | null;
  valorDigitado?: string | null;
  instructorId?: string | null;
}

export interface ItemValorInvalido {
  id: string;
  categoria: string;
  instructorId?: string | null;
  /** O que o campo mostra (o texto digitado, ou o número gravado sem perder casas). */
  texto: string;
  motivo: MotivoValorInvalido;
  mensagem: string;
}

export type PreparoParaSalvar<T> =
  | { ok: true; itens: T[] }
  | { ok: false; invalidos: ItemValorInvalido[] };

export function prepararItensParaSalvar<T extends SavableExpenseItem>(itens: T[]): PreparoParaSalvar<T> {
  const invalidos: ItemValorInvalido[] = [];
  const saida: T[] = [];

  for (const a of itens) {
    const texto = textoDeEdicao(a.value);
    const lido = parseMoneyBR(texto);

    if (!lido.ok && lido.motivo !== 'vazio') {
      invalidos.push({
        id: String(a.id ?? ''),
        categoria: String(a.category ?? ''),
        instructorId: a.instructorId ?? null,
        texto,
        motivo: lido.motivo,
        mensagem: mensagemValorInvalido(lido.motivo),
      });
      saida.push(a);
      continue;
    }

    if (typeof a.value !== 'string') {
      saida.push(a); // número (ou ausente/null): intacto
      continue;
    }

    if (!lido.ok) {
      // Texto em branco: rascunho. Grava 0, como sempre gravou, e o selo
      // "sem valor" aparece no painel. Sem valorDigitado: ninguém digitou valor.
      const { valorDigitado: _descartado, ...semDigitado } = a as T & { valorDigitado?: unknown };
      void _descartado;
      saida.push({ ...(semDigitado as T), value: 0 });
      continue;
    }

    saida.push({ ...a, value: lido.valor, valorDigitado: a.value });
  }

  return invalidos.length > 0 ? { ok: false, invalidos } : { ok: true, itens: saida };
}
