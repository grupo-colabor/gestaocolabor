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

/** As categorias que o painel mostra SEM linha de "Outras despesas". */
const CATEGORIAS_DO_PAINEL = new Set(['HOSPEDAGEM', 'LOCOMOCAO', 'CAFE', 'ALMOCO', 'JANTAR']);

/**
 * O item aparece em algum campo do Painel de Medição? É o mesmo recorte do
 * `CategoryBlock`: as cinco categorias SEM `otherId`, e OUTROS com
 * `otherId` de uma linha de `other_expenses` que existe. Fora disso — o
 * órfão de Outros, categoria desconhecida, categoria comum com `otherId` —
 * não há campo na tela para corrigir nem lixeira para apagar.
 */
export function apareceNoPainel(a: SavableExpenseItem & { otherId?: string | null }, outrosIds: Set<string>): boolean {
  const cat = String(a?.category ?? '');
  if (cat === 'OUTROS') return !!a.otherId && outrosIds.has(a.otherId);
  return CATEGORIAS_DO_PAINEL.has(cat) && !a.otherId;
}

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

// Os dois ramos declaram os dois campos: o tsconfig do projeto não é `strict`.
export type PreparoParaSalvar<T> =
  | { ok: true; itens: T[]; invalidos?: undefined }
  | { ok: false; invalidos: ItemValorInvalido[]; itens?: undefined };

export interface PreparoOptions {
  /**
   * Ids das linhas de `other_expenses`. Presente = só o item que o painel
   * MOSTRA (`apareceNoPainel`) é validado e convertido; o que não aparece
   * passa INTACTO — senão um órfão com número suspeito travaria o Salvar
   * para sempre, sem campo para corrigir (revisão adversarial, 16/11/2026).
   */
  outrosIds?: Set<string>;
}

export function prepararItensParaSalvar<T extends SavableExpenseItem>(itens: T[], opts: PreparoOptions = {}): PreparoParaSalvar<T> {
  const invalidos: ItemValorInvalido[] = [];
  const saida: T[] = [];

  for (const a of itens) {
    if (opts.outrosIds && !apareceNoPainel(a as T & { otherId?: string | null }, opts.outrosIds)) {
      saida.push(a); // não aparece na tela: não há o que corrigir — fica como está
      continue;
    }
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
