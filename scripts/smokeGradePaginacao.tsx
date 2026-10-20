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
import { emptyTemplateValuesIndex, indexTemplateValues } from '../domain/exports/templates/values';

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

/* ────────────────────────── [HÍBRIDA] dois preços na grade ────────────────────────── */
console.log('\n[GRADE] híbrida: dois preços por treinamento e por turma');
{
  const rowsH: any[] = [
    { demand: { id: 'DEM-H1' }, refs: { trainingId: 'T_HIB', demandId: 'DEM-H1' }, trainingId: 'T_HIB',
      hibrida: { ok: true, presencial: 8, online: 32, hours: 40 },
      input: { demandId: 'DEM-H1', clientDemandId: 'SAP-H1', trainingName: 'NR 20 Intermediário', titulares: ['Titular'], dataInicio: '2026-08-10' } },
    { demand: { id: 'DEM-P1' }, refs: { trainingId: 'T_PRE', demandId: 'DEM-P1' }, trainingId: 'T_PRE', hibrida: null,
      input: { demandId: 'DEM-P1', clientDemandId: 'SAP-P1', trainingName: 'NR 35', titulares: ['Titular'], dataInicio: '2026-08-11' } },
  ];
  const namesH = new Map([['T_HIB', 'NR 20 Intermediário'], ['T_PRE', 'NR 35']]);
  const hibridas = new Map<string, any>([['T_HIB', { ok: true, presencial: 8, online: 32, hours: 40 }]]);
  const valoresSoPresencial = indexTemplateValues([
    { scope: 'training', column_key: 'precoHH', training_id: 'T_HIB', demand_id: null, value: 250 },           // preço único antigo
    { scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
  ]);
  const props = { rows: rowsH, allRows: rowsH, trainingNames: namesH, hibridas, hybridSplit: true, values: valoresSoPresencial, resetKey: 1 };
  render(props);

  clicar(botaoTexto('Por treinamento'));
  const card = () => container.querySelector('[data-hibrida="T_HIB"]') as any;
  check('o card da híbrida existe', !!card());
  check('selo "falta online" com só o presencial preenchido', textoDe(card()).includes('falta online'));
  check('dois campos de preço no card', card().querySelectorAll('input').length === 2, String(card()?.querySelectorAll('input').length));
  check('com as horas de cada parte (8h / 32h)', textoDe(card()).includes('8h') && textoDe(card()).includes('32h'));
  check('o presencial vem preenchido (290) e o online vazio', (card().querySelectorAll('input')[0] as any).value === '290' && (card().querySelectorAll('input')[1] as any).value === '');
  check('o preço único antigo aparece, sem ser usado', textoDe(card()).includes('Preço único anterior: R$ 250'));
  check('contador: 2 treinamentos, 0 com preço (híbrida incompleta não conta)', textoDe(botaoTexto('Por treinamento')).includes('2 treinamentos, 0 com preço'));
  check('o presencial puro continua com um campo só', (container.querySelectorAll('label.text-xs.bg-white')[0] as any)?.querySelectorAll('input').length === 1);

  // Os dois preços: "com preço" e o contador sobe.
  const valoresCompletos = indexTemplateValues([
    { scope: 'training', column_key: 'precoHHPresencial', training_id: 'T_HIB', demand_id: null, value: 290 },
    { scope: 'training', column_key: 'precoHHOnline', training_id: 'T_HIB', demand_id: null, value: 200 },
    { scope: 'demand', column_key: 'precoHHOnline', training_id: null, demand_id: 'DEM-H1', value: 180 },
  ]);
  render({ ...props, values: valoresCompletos, resetKey: 2 });
  check('com os dois preços: selo "com preço"', textoDe(card()).includes('com preço') && !textoDe(card()).includes('falta'));
  check('contador: 2 treinamentos, 1 com preço', textoDe(botaoTexto('Por treinamento')).includes('2 treinamentos, 1 com preço'));
  check('sem preço único antigo, sem a nota', !textoDe(card()).includes('Preço único anterior'));

  // Por turma: a híbrida tem dois campos de sobrescrita de preço e duas fontes.
  const toggleH = $$('input[type="checkbox"]').find((i: any) => textoDe(i.parentElement).includes('só turmas com pendência'));
  if (toggleH && (toggleH as any).checked) clicar(toggleH);
  const linhaH = () => container.querySelector('[data-turma="DEM-H1"]') as any;
  const linhaP = () => container.querySelector('[data-turma="DEM-P1"]') as any;
  check('a turma híbrida aparece na grade "Por turma"', !!linhaH());
  check('marcada como híbrido · duas linhas', textoDe(linhaH()).includes('híbrido · duas linhas'));
  check('um campo de preço a mais que a turma presencial (presencial + online)', linhaH().querySelectorAll('input').length === linhaP().querySelectorAll('input').length + 1);
  check('sobrescrita do online na turma (180) preenchida no campo online', Array.from(linhaH().querySelectorAll('input') as any[]).some((i: any) => i.value === '180'));
  check('duas badges de fonte: presencial "treinamento", online "sobrescrito"', textoDe(linhaH()).includes('treinamento') && textoDe(linhaH()).includes('sobrescrito'));
  check('contador de exceções conta a híbrida sobrescrita', textoDe(botaoTexto('Por turma')).includes('1 com exceção'));

  // Sem hybridSplit (modelo do banco): a híbrida volta a ter um campo só.
  render({ ...props, hybridSplit: false, resetKey: 3 });
  check('sem hybridSplit: o card da híbrida não existe e o treinamento tem um campo só', !card() && container.querySelectorAll('label.text-xs.bg-white').length === 2);
}

act(() => root.unmount());
console.log(falhas === 0 ? '\n✅ SMOKE GRADE PAGINACAO: OK' : `\n❌ SMOKE GRADE PAGINACAO: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
