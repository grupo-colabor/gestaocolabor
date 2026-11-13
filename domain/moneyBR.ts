/**
 * VALOR MONETÁRIO DIGITADO (pt-BR) — o parser único
 *
 * Todo valor de despesa digitado no app passa por aqui: o item da medição
 * (notinha anexada ou lançamento avulso, nas seis categorias) e os Campos
 * manuais da Medição Vale / BM. Antes existiam dez conversores com a mesma
 * falha — `parseFloat(texto.replace(',', '.'))` —, que lia "1.234,56" como
 * 1,234 e "R$ 10,00" como 0, sem aviso, e o Salvar gravava esse número.
 *
 * REGRA (decisões de 13/11/2026):
 *
 *   | entrada            | resultado                                   |
 *   |--------------------|---------------------------------------------|
 *   | "10"               | 10                                          |
 *   | "10,5" / "10,50"   | 10,5 — vírgula decimal, até 2 casas         |
 *   | "1.234,56"         | 1234,56 — ponto de milhar + vírgula         |
 *   | "10.50"            | 10,5 — ponto com ATÉ 2 casas é decimal      |
 *   | "R$ 10,00", "R$10" | 10 — "R$" só no início                      |
 *   | " 10,00 "          | 10 — espaços nas pontas                     |
 *   | "1.234"            | RECUSA: ambíguo (mil ou 1,234?)             |
 *   | "1,234.56"         | RECUSA: formato americano                   |
 *   | "10,00 reais"      | RECUSA: letras                              |
 *   | "-10,00"           | RECUSA: negativo                            |
 *   | "10,505"           | RECUSA: mais de 2 casas                     |
 *   | "", null           | VAZIO (não é erro: o item fica "sem valor") |
 *
 * O valor sai EXATO: o texto normalizado ("1234.56") vira número uma vez, sem
 * arredondar — o mesmo número que a leitura antiga dava para a entrada bem
 * formada ("1234,56"). Arredondamento, só na exibição.
 *
 * NÚMERO já gravado passa intacto (é como o banco guarda desde sempre); quem
 * quer saber se um número gravado é suspeito (3+ casas, negativo) usa
 * `formatarValorParaEdicao` + este parser: o texto de edição de 1,234 é
 * "1,234", que este parser recusa por casas demais — em vez de arredondar.
 *
 * Sem imports, de propósito: roda no smoke, no domínio e na tela.
 */

export type MotivoValorInvalido =
  | 'vazio'
  | 'ambiguo'
  | 'formatoAmericano'
  | 'letras'
  | 'negativo'
  | 'casasDemais'
  | 'ilegivel';

// Os dois ramos declaram os dois campos (um deles opcional): o tsconfig do
// projeto não é `strict`, e sem isso `if (!r.ok) r.motivo` não compila.
export type ResultadoValorMonetario =
  | { ok: true; valor: number; motivo?: undefined }
  | { ok: false; motivo: MotivoValorInvalido; valor?: undefined };

const falha = (motivo: MotivoValorInvalido): ResultadoValorMonetario => ({ ok: false, motivo });

/** Espaço comum, de tabulação e os inseparáveis que o colar de planilha traz. */
const ESPACO_NAS_PONTAS = /^[\s  ]+|[\s  ]+$/g;
const PREFIXO_REAL = /^R\$[\s  ]*/i;

/**
 * Lê um valor monetário digitado em pt-BR. Ver a tabela no cabeçalho.
 *
 * `number` finito passa intacto; `NaN`/`Infinity` é ilegível. `null`,
 * `undefined` e texto em branco são VAZIO — não é erro de digitação, é item
 * ainda sem valor (rascunho), e quem chama decide o selo.
 */
export function parseMoneyBR(entrada: unknown): ResultadoValorMonetario {
  if (typeof entrada === 'number') {
    return Number.isFinite(entrada) ? { ok: true, valor: entrada } : falha('ilegivel');
  }
  if (entrada === null || entrada === undefined) return falha('vazio');
  if (typeof entrada !== 'string') return falha('ilegivel');

  const aparado = entrada.replace(ESPACO_NAS_PONTAS, '');
  if (aparado === '') return falha('vazio');
  let s = aparado.replace(PREFIXO_REAL, '');
  if (s === '') return falha('vazio'); // só "R$"

  // Só dígitos, ponto, vírgula e o sinal. Letra (ou "$" fora do prefixo) é
  // "letras"; qualquer outro símbolo — inclusive espaço no meio — é ilegível.
  if (/[^0-9.,-]/.test(s)) return falha(/[A-Za-zÀ-ÿ$]/.test(s) ? 'letras' : 'ilegivel');

  const negativo = s.startsWith('-');
  if (negativo) s = s.slice(1);
  if (s.includes('-')) return falha('ilegivel');

  let inteiro: string;
  let decimais = '';
  if (/^[0-9]+$/.test(s)) {
    inteiro = s;
  } else if (/^[0-9]+,[0-9]+$/.test(s)) {
    [inteiro, decimais] = s.split(',');
  } else if (/^[0-9]{1,3}(\.[0-9]{3})+,[0-9]+$/.test(s)) {
    const [milhares, dec] = s.split(',');
    inteiro = milhares.split('.').join('');
    decimais = dec;
  } else if (/^[0-9]+\.[0-9]{1,2}$/.test(s)) {
    [inteiro, decimais] = s.split('.');
  } else if (/^[0-9]{1,3}(\.[0-9]{3})+$/.test(s)) {
    return falha('ambiguo');
  } else if (/^[0-9]{1,3}(,[0-9]{3})+\.[0-9]+$/.test(s)) {
    return falha('formatoAmericano');
  } else if (/^[0-9]+\.[0-9]{3,}$/.test(s)) {
    return falha('casasDemais');
  } else {
    return falha('ilegivel');
  }

  if (decimais.length > 2) return falha('casasDemais');
  if (negativo) return falha('negativo');

  const valor = Number(decimais ? `${inteiro}.${decimais}` : inteiro);
  return Number.isFinite(valor) ? { ok: true, valor } : falha('ilegivel');
}

/** A mensagem do campo, por motivo. A base é a combinada: "Valor não reconhecido — use 1.234,56". */
export const MENSAGEM_VALOR_NAO_RECONHECIDO = 'Valor não reconhecido — use 1.234,56';

export function mensagemValorInvalido(motivo: MotivoValorInvalido): string {
  switch (motivo) {
    case 'vazio':
      return 'Sem valor';
    case 'ambiguo':
      return 'Valor ambíguo — para milhar, use 1.234,00';
    case 'negativo':
      return 'Valor negativo não é aceito — use 1.234,56';
    case 'casasDemais':
      return 'Mais de 2 casas decimais — use 1.234,56';
    default:
      return MENSAGEM_VALOR_NAO_RECONHECIDO;
  }
}

/**
 * HORAS, VALOR HORA/AULA E VALOR HH — o caminho numérico de sempre.
 *
 * Esses campos são inputs `type="number"` e o painel grava NÚMERO; número
 * passa intacto. Texto só existiria em dado muito antigo, e para ele vale a
 * leitura de sempre (a primeira vírgula vira ponto, `parseFloat`, inválido =
 * 0): passar horas pelo parser monetário recusaria "7.333" (3 casas é hora
 * legítima) e mudaria hora paga. Por isso esta leitura existe — aqui, ao lado
 * do parser, e em lugar nenhum mais.
 *
 * NUNCA use para valor de item de despesa: esse é `parseMoneyBR`.
 */
export function lerCampoNumerico(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * O texto que o campo mostra para um número JÁ GRAVADO, sem perder casas e
 * sem separador de milhar: 1234.56 → "1234,56", 10.5 → "10,5", 1.234 →
 * "1,234". Separador de milhar ficaria ambíguo no inteiro (1234 → "1.234",
 * que este parser recusa), e arredondar esconderia o número suspeito — o
 * texto de 1,234 é recusado por casas demais, que é o que se quer.
 *
 * Ida e volta exatas: `parseMoneyBR(formatarValorParaEdicao(v)).valor === v`
 * para todo número de até 2 casas.
 */
export function formatarValorParaEdicao(v: number): string {
  if (!Number.isFinite(v)) return '';
  const s = String(v);
  if (/e/i.test(s)) return s; // fora da faixa de dinheiro (1e21, 1e-7): cru, e a validação recusa
  return s.replace('.', ',');
}
