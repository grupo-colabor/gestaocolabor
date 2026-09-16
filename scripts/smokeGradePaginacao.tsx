/**
 * SMOKE DE COMPONENTE — paginação da grade "Por turma" (GradeEditavel)
 *
 * Rodar com:  npm run smoke:grade-paginacao
 *
 * Regressão real: a paginação parecia travada — clicar em "2" mantinha as
 * mesmas 25 linhas. Causa: `porDemanda` era recriado a cada render e entrava
 * nas dependências do useMemo de `turmas`; a lista ganhava referência nova a
 * cada ciclo e o usePagination (que volta à página 1 quando a lista muda)
 * desfazia o clique no mesmo render.
 *
 * O teste monta o componente de verdade (react-dom/client sobre happy-dom),
 * abre o bloco "Por turma", clica na página 2 e confere que a primeira turma
 * listada MUDA; depois força um re-render do pai (nova prop `pendentes`) e
 * confere que a página 2 se mantém; por fim muda o toggle e confere que
 * volta à página 1 (comportamento esperado do hook).
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import { Window } from 'happy-dom';

// ---- ambiente de DOM antes de importar React DOM ----
const win = new Window({ url: 'http://localhost/' });
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
g.Text = win.Text;
g.Event = win.Event;
g.MouseEvent = win.MouseEvent;
g.localStorage = win.localStorage;
g.getComputedStyle = win.getComputedStyle.bind(win);
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GradeEditavel from '../components/exportacoes/GradeEditavel';
import { VALE_TURMAS_COLUMNS } from '../domain/exports/templates/vale';
import { emptyTemplateValuesIndex } from '../domain/exports/templates/values';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

/* ────────────────────────── fixtures: 60 turmas ────────────────────────── */
const rows: any[] = Array.from({ length: 60 }, (_, i) => {
  const id = `DEM-${String(1000 + i)}`;
  return {
    demand: { id },
    refs: { trainingId: 'T_PRE', demandId: id },
    trainingId: 'T_PRE',
    input: {
      demandId: id, clientDemandId: `SAP-${i}`, trainingName: 'NR 35', titulares: ['Titular'],
      dataInicio: '2026-08-10', local: 'Brucutu',
    },
  };
});
const trainingNames = new Map([['T_PRE', 'NR 35']]);

/* ────────────────────────── harness ────────────────────────── */
const container = win.document.createElement('div');
win.document.body.appendChild(container);
const root = createRoot(container as any);

function render(props: Partial<React.ComponentProps<typeof GradeEditavel>> = {}) {
  act(() => {
    root.render(
      <GradeEditavel
        rows={rows}
        allRows={rows}
        columns={VALE_TURMAS_COLUMNS}
        values={emptyTemplateValuesIndex()}
        onEdit={() => {}}
        trainingNames={trainingNames}
        demandasComPendencia={new Set()}
        pendentes={0}
        salvando={false}
        onSalvar={() => {}}
        onDescartar={() => {}}
        resetKey={0}
        {...props}
      />
    );
  });
}

const $$ = (sel: string) => Array.from(container.querySelectorAll(sel)) as any[];
const textoDe = (el: any) => String(el?.textContent ?? '').trim();
const primeiraTurma = () => textoDe($$('tbody tr td span.font-mono')[0]);
const clicar = (el: any) => act(() => { el.click(); });
const botaoPagina = (label: string) => $$('button').find(b => textoDe(b) === label);
const botaoTexto = (parte: string) => $$('button').find(b => textoDe(b).includes(parte));

console.log('\n[GRADE] paginação "Por turma"');
render();

// Abre o bloco "Por turma" e desliga o filtro "só com pendência" (fixtures não têm pendência).
clicar(botaoTexto('Por turma'));
const toggle = $$('input[type="checkbox"]').find((i: any) => textoDe(i.parentElement).includes('só turmas com pendência'));
check('bloco "Por turma" abre e mostra o toggle', !!toggle);
clicar(toggle);

check('página 1 mostra 25 turmas', $$('tbody tr').length === 25, `veio ${$$('tbody tr').length}`);
const antes = primeiraTurma();
check('primeira turma da página 1 é DEM-1000', antes === 'DEM-1000', antes);

const p2 = botaoPagina('2');
check('existe o botão da página 2', !!p2);
clicar(p2);
const depois = primeiraTurma();
check('clicar em "2" MUDA a primeira turma', depois !== antes, `continua ${depois}`);
check('página 2 começa em DEM-1025', depois === 'DEM-1025', depois);
check('página 2 mostra 25 turmas', $$('tbody tr').length === 25);

// Re-render do pai NÃO pode voltar à página 1. O harness passa um `values`
// NOVO a cada render — é o que acontece na tela ao digitar um preço — e a
// lista de turmas continua a mesma, então a página tem de se manter.
render({ pendentes: 1, values: emptyTemplateValuesIndex() });
check('re-render do pai (values novo, como ao editar) mantém a página 2', primeiraTurma() === 'DEM-1025', primeiraTurma());

// Seta "próxima" → página 3 (10 turmas restantes).
clicar($$('button[aria-label="Próxima página"]')[0]);
check('seta próxima vai para a página 3', primeiraTurma() === 'DEM-1050', primeiraTurma());
check('página 3 tem as 10 turmas restantes', $$('tbody tr').length === 10, `veio ${$$('tbody tr').length}`);

// Toggle refiltra e volta à página 1 — comportamento esperado do hook.
clicar(toggle);
check('religar "só com pendência" refiltra (0 turmas) e mostra a mensagem', $$('tbody tr').length === 1 && textoDe($$('tbody tr')[0]).includes('desligue o filtro'));
clicar(toggle);
check('desligar de novo volta à página 1', primeiraTurma() === 'DEM-1000', primeiraTurma());

act(() => root.unmount());
console.log(falhas === 0 ? '\n✅ SMOKE GRADE PAGINACAO: OK' : `\n❌ SMOKE GRADE PAGINACAO: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
