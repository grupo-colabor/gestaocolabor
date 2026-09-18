/**
 * MODELOS DE MEDIÇÃO — o modelo está inteiro? (puro)
 *
 * Valida um `MeasurementTemplate` SEM linhas: é o que a tela precisa para
 * recusar um modelo quebrado no SALVAR, antes de qualquer demanda existir, e o
 * que o painel de pendências usa para bloquear a geração.
 *
 * POR QUE NÃO REUSAR O MODO TOLERANTE DO RESOLVEDOR
 * ---------------------------------------------------------------------------
 * `resolveTemplateWithProblems` também coleta estes defeitos, mas só os que
 * aparecem no caminho de uma LINHA — "campo que não existe mais" vive dentro do
 * laço por demanda e, com zero linhas, nunca dispara. Um modelo recém-salvo,
 * antes de existir demanda no recorte, passaria batido. Por isso a validação
 * estática mora aqui; o modo tolerante continua sendo a rede de segurança em
 * tempo de geração, e os dois dizem a mesma coisa com as mesmas palavras.
 *
 * DOIS PESOS, DE PROPÓSITO:
 *   • BLOQUEIO (`fato`) — o modelo NÃO gera: campo do app que sumiu, conta
 *     sobre coluna removida, coluna calculada sem conta, valor fixo não
 *     declarado, total sobre coluna que não existe, chave de coluna repetida.
 *     Tudo isso produziria célula errada ou vazia numa medição que vai para o
 *     cliente.
 *   • ALERTA (`aviso`) — gera, mas alguém devia olhar: modelo sem nenhuma
 *     coluna ligada a dado do app (sairia uma planilha só de constantes).
 *
 * Nunca lança. Configuração velha não é exceção — é texto em português.
 */
import { validateFormulaSpec } from './formula';
import { formulaTextRefs, formulaTextOf } from './resolve';
import { isSourceField } from './sourceFields';
import type { MeasurementTemplate, TemplateColumn, TemplateSheet } from './types';

export type ProblemaSeveridade = 'bloqueio' | 'alerta';

export interface ProblemaDeModelo {
  /** Chave estável, para deduplicar e para o teste apontar o caso. */
  key: string;
  severidade: ProblemaSeveridade;
  /** Pronto para a tela e para o painel de pendências. */
  texto: string;
  columnKey?: string;
  sheet?: string;
}

export interface ValidacaoDeModelo {
  problemas: ProblemaDeModelo[];
  /** Falso quando há QUALQUER bloqueio. É o que trava o botão de gerar. */
  podeGerar: boolean;
}

const ORIGENS_INTERNAS = new Set(['manual', 'formula', 'sequence', 'constant', 'blank']);

const rotulo = (c: TemplateColumn) => c.header || c.key;

function validarAba(
  sheet: TemplateSheet,
  template: MeasurementTemplate,
  out: ProblemaDeModelo[]
): void {
  const colunas = sheet.columns ?? [];
  const chaves = colunas.map(c => c.key);
  const constantes = Object.keys(template.constants ?? {});
  const escopo = { colunas: chaves, constantes };
  const add = (p: Omit<ProblemaDeModelo, 'sheet'>) => out.push({ ...p, sheet: sheet.name });

  const vistas = new Set<string>();
  for (const c of colunas) {
    if (vistas.has(c.key)) {
      add({
        key: `chave-repetida:${c.key}`,
        severidade: 'bloqueio',
        columnKey: c.key,
        texto: `Duas colunas do modelo têm a mesma identificação («${rotulo(c)}»). Renomeie uma delas.`,
      });
    }
    vistas.add(c.key);

    // Campo do app que sumiu — o bloqueio do item 14.
    if (!ORIGENS_INTERNAS.has(c.source) && !isSourceField(c.source)) {
      add({
        key: `campo-extinto:${c.key}`,
        severidade: 'bloqueio',
        columnKey: c.key,
        texto: `A coluna «${rotulo(c)}» está ligada a um campo que não existe mais no sistema («${c.source}»). Edite o modelo.`,
      });
    }

    if (c.source === 'formula') {
      const texto = formulaTextOf(c);
      if (!texto) {
        add({
          key: `formula-vazia:${c.key}`,
          severidade: 'bloqueio',
          columnKey: c.key,
          texto: `A coluna «${rotulo(c)}» está marcada como calculada, mas não tem conta configurada.`,
        });
      } else if (c.formulaSpec) {
        for (const p of validateFormulaSpec(c.formulaSpec, escopo, rotulo(c))) {
          add({ key: `formula:${c.key}:${p}`, severidade: 'bloqueio', columnKey: c.key, texto: p });
        }
      } else {
        // Texto escrito à mão (template de código): confere as referências.
        const refs = formulaTextRefs(texto);
        for (const k of refs.colunas) {
          if (!chaves.includes(k)) {
            add({
              key: `formula:${c.key}:col:${k}`,
              severidade: 'bloqueio',
              columnKey: c.key,
              texto: `A coluna «${rotulo(c)}» usa a coluna «${k}», que não existe mais no modelo.`,
            });
          }
        }
        for (const n of refs.constantes) {
          if (!constantes.includes(n)) {
            add({
              key: `formula:${c.key}:const:${n}`,
              severidade: 'bloqueio',
              columnKey: c.key,
              texto: `A coluna «${rotulo(c)}» usa o valor fixo «${n}», que não está declarado no modelo.`,
            });
          }
        }
      }
    }

    if (c.source === 'constant') {
      const nome = c.constantName ?? c.key;
      if (!constantes.includes(nome)) {
        add({
          key: `constante-ausente:${c.key}`,
          severidade: 'bloqueio',
          columnKey: c.key,
          texto: `A coluna «${rotulo(c)}» usa o valor fixo «${nome}», que não está declarado no modelo.`,
        });
      }
    }
  }

  for (const k of sheet.totals?.sumColumns ?? []) {
    if (!chaves.includes(k)) {
      add({
        key: `total-coluna-extinta:${k}`,
        severidade: 'bloqueio',
        columnKey: k,
        texto: `A linha de totais soma a coluna «${k}», que não existe mais no modelo.`,
      });
    }
  }

  if (colunas.length === 0) {
    add({ key: 'sem-colunas', severidade: 'bloqueio', texto: `A aba «${sheet.name}» não tem nenhuma coluna configurada.` });
  } else if (!colunas.some(c => isSourceField(c.source))) {
    add({
      key: 'sem-campo-do-app',
      severidade: 'alerta',
      texto: 'Nenhuma coluna deste modelo lê dado do sistema — a planilha sairia igual para toda turma.',
    });
  }
}

/**
 * O modelo está inteiro? Serve ao SALVAR (antes de existir demanda) e ao GERAR.
 * Deduplica por `key`: o mesmo defeito não vira dois itens no painel.
 */
export function validarTemplate(template: MeasurementTemplate): ValidacaoDeModelo {
  const cru: ProblemaDeModelo[] = [];

  const abas = template.sheets ?? [];
  if (abas.length === 0) {
    cru.push({ key: 'sem-abas', severidade: 'bloqueio', texto: 'O modelo ainda não tem nenhuma aba configurada.' });
  }
  for (const s of abas) {
    if (s.kind !== 'rows') continue;
    validarAba(s, template, cru);
  }

  const porChave = new Map<string, ProblemaDeModelo>();
  for (const p of cru) if (!porChave.has(p.key)) porChave.set(p.key, p);
  const problemas = [...porChave.values()];

  return { problemas, podeGerar: !problemas.some(p => p.severidade === 'bloqueio') };
}

/** Só os que travam a geração. */
export const bloqueiosDe = (v: ValidacaoDeModelo): ProblemaDeModelo[] =>
  v.problemas.filter(p => p.severidade === 'bloqueio');
