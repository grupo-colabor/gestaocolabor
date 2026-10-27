/**
 * SMOKE DE COMPONENTE — card "Despesas Não Reembolsáveis" (NonReimbursableCard)
 *
 * Rodar com:  npm run smoke:nao-reembolsaveis-card
 *
 * Monta o componente de verdade (react-dom/client sobre happy-dom) com uma
 * lista de 45 demandas e confere o combinado:
 *   • começa recolhido (aria-expanded=false) e o cabeçalho inteiro expande;
 *   • visão padrão "Por demanda"; a troca para "Por item" NÃO recolhe o card
 *     e fica lembrada em localStorage;
 *   • paginação em 20 nas duas visões; clicar na página 2 muda a primeira
 *     linha, e um re-render do pai (mesma lista) mantém a página 2;
 *   • clicar numa demanda abre os itens dela; clicar no DEM-N (com
 *     onOpenDemand) chama o handler SEM expandir a linha;
 *   • "Por item": ordenar por Data inverte a primeira linha; rodapé = total;
 *   • mini-totais P1..PN aparecem quando `periods` tem 2+ entradas.
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
import { Home, Truck, Tag, Plus } from 'lucide-react';
import NonReimbursableCard from '../components/dashboard/NonReimbursableCard';
import { listNonReimbursableByDemand, type NonReimbursableSource } from '../domain/nonReimbursableExpenses';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);

/* ────────────────── fixtures: 45 demandas, 2 itens cada ────────────────── */
const N = 45;
const demands: any[] = [];
const measurements: any[] = [];
for (let i = 0; i < N; i++) {
  const id = `DEM-${1000 + i}`;
  const dia = String(1 + (i % 28)).padStart(2, '0');
  demands.push({ id, tipo: 'cliente', companyId: 'C1', trainingId: 'T1', instructorId: 'INS-1', startDate: `2026-08-${dia}`, endDate: `2026-08-${dia}`, corredor: 'Sul', demandState: 'MG' });
  measurements.push({
    id: `MEA-${id}`, demandId: id, status: 'LANCAMENTO',
    expenses: { classHours: 8, hourRate: 100 },
    attachments: [
      { id: `${id}-a`, name: `hotel-${i}.pdf`, url: 'https://x/a.pdf', category: 'HOSPEDAGEM', value: 100 + i, reembolsavel: false, date: `2026-08-${dia}T10:00:00.000Z` },
      { id: `${id}-b`, name: `almoco-${i}.jpg`, url: 'https://x/b.jpg', category: 'ALMOCO', value: 10 + (i % 7), reembolsavel: false, pagoPeloInstrutor: i % 2 === 0, date: `2026-08-${dia}T13:00:00.000Z` },
    ],
    otherExpenses: [],
  });
}
const SRC: NonReimbursableSource = {
  demands, measurements,
  instructorAllocations: [], participants: [], companions: [],
  instructors: [{ id: 'INS-1', name: 'Instrutor Um' }],
  companies: [{ id: 'C1', name: 'Vale' }],
  trainings: [{ id: 'T1', name: 'NR 35' }],
};
const lista = listNonReimbursableByDemand(SRC);
const fmtRaw = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
// O Intl separa "R$" do número com espaço não quebrável; `texto()` normaliza
// todo espaço para ' ', então o valor esperado passa pela mesma normalização.
const fmt = (v: number) => fmtRaw(v).replace(/\s+/g, ' ');
const STYLE = {
  hospedagem: { icon: Home, colorClass: 'text-green-700' },
  locomocao: { icon: Truck, colorClass: 'text-amber-700' },
  alimentacao: { icon: Tag, colorClass: 'text-blue-700' },
  outros: { icon: Plus, colorClass: 'text-purple-700' },
};

/* ────────────────────────── harness ────────────────────────── */
const container = win.document.createElement('div');
win.document.body.appendChild(container);
const root = createRoot(container as any);
const abertas: string[] = [];

function render(props: Partial<React.ComponentProps<typeof NonReimbursableCard>> = {}) {
  act(() => {
    root.render(
      <NonReimbursableCard
        list={lista}
        formatCurrency={fmtRaw}
        bucketStyle={STYLE as any}
        onOpenDemand={id => abertas.push(id)}
        {...props}
      />
    );
  });
}
const q = (sel: string) => container.querySelector(sel) as any;
const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as any[];
const click = (el: any) => act(() => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
const texto = (el: any) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const header = () => q('button[aria-expanded]');
const linhasDemanda = () => qa('tbody > tr[aria-expanded]');
const primeiraLinha = () => texto(linhasDemanda()[0]?.querySelector('td:nth-child(2)'));
const pagina = (n: number) => qa('button').find((b: any) => texto(b) === String(n));
const botaoVisao = (label: string) => qa('button[aria-pressed]').find((b: any) => texto(b) === label);

console.log('\n— Recolhido por padrão; cabeçalho expande');
render();
eq('aria-expanded=false ao montar', header().getAttribute('aria-expanded'), 'false');
check('lista ausente ao montar', !q('#dashboard-nao-reembolsaveis-lista'));
check('resumo visível mesmo recolhido', texto(container).includes(fmt(lista.total)) && texto(container).includes(`${lista.qtdItens} itens em ${lista.medicoes} medições`));
click(header());
eq('aria-expanded=true após clique', header().getAttribute('aria-expanded'), 'true');
check('lista presente', !!q('#dashboard-nao-reembolsaveis-lista'));

console.log('\n— Visão padrão "Por demanda", paginação em 20');
eq('"Por demanda" pressionado', botaoVisao('Por demanda')?.getAttribute('aria-pressed'), 'true');
eq('20 linhas de demanda na página 1', linhasDemanda().length, 20);
eq('primeira linha = maior total da lista', primeiraLinha(), lista.demandas[0].demandId);
check('paginação presente (45 > 20)', !!pagina(2) && !!pagina(3));
check('rodapé com o total do card', texto(q('tfoot')).includes(fmt(lista.total)));
click(pagina(2));
eq('página 2: primeira linha muda (21ª da lista)', primeiraLinha(), lista.demandas[20].demandId);
render(); // re-render do pai com a MESMA lista
eq('re-render do pai mantém a página 2', primeiraLinha(), lista.demandas[20].demandId);

console.log('\n— Expandir demanda e link do DEM-N');
const linha = linhasDemanda()[0];
click(linha);
eq('linha expandida', linha.getAttribute('aria-expanded'), 'true');
eq('2 itens da demanda listados', qa('tbody > tr[aria-expanded] + tr tbody tr').length, 2);
check('indicador "Pago pelo instrutor" no item par', texto(container).includes('Pago pelo instrutor'));
const link = linhasDemanda()[1].querySelector('td:nth-child(2) button');
click(link);
eq('onOpenDemand chamado com o DEM-N', abertas, [lista.demandas[21].demandId]);
eq('clicar no DEM-N NÃO expandiu a linha', linhasDemanda()[1].getAttribute('aria-expanded'), 'false');

console.log('\n— Trocar para "Por item" não recolhe; fica lembrado');
click(botaoVisao('Por item'));
eq('card continua expandido', header().getAttribute('aria-expanded'), 'true');
eq('"Por item" pressionado', botaoVisao('Por item')?.getAttribute('aria-pressed'), 'true');
eq('localStorage lembra a visão', win.localStorage.getItem('dashboard.naoReemb.visao'), 'item');
const linhasItem = () => qa('tbody > tr');
eq('20 itens na página 1', linhasItem().length, 20);
const primeiroItem = () => texto(linhasItem()[0]);
check('ordem padrão: maior valor primeiro (hotel DEM-1044 = R$ 144,00)', primeiroItem().includes('DEM-1044') && primeiroItem().includes(fmt(144)));
check('rodapé por item = total do card', texto(q('tfoot')).includes(fmt(lista.total)));
check('paginação presente nos itens (90 > 20)', !!pagina(5));

console.log('\n— Ordenar por Data');
const thData = qa('thead button').find((b: any) => texto(b).startsWith('Data'));
click(thData);
check('Data desc: último dia do mês primeiro (28/08/2026)', primeiroItem().includes('28/08/2026'));
click(thData);
check('Data asc: primeiro dia primeiro (01/08/2026)', primeiroItem().includes('01/08/2026'));
eq('aria-sort reflete a ordenação', qa('th[aria-sort]').map((t: any) => t.getAttribute('aria-sort')), ['ascending', 'none']);

console.log('\n— Nova montagem lê a visão lembrada; mini-totais por período');
act(() => { root.unmount(); });
const root2 = createRoot(container as any);
act(() => {
  root2.render(
    <NonReimbursableCard
      list={lista}
      formatCurrency={fmtRaw}
      bucketStyle={STYLE as any}
      periods={[{ label: 'P1', color: '#111', value: lista.total }, { label: 'P2', color: '#222', value: lista.total / 2 }]}
    />
  );
});
eq('nova montagem: recolhido', header().getAttribute('aria-expanded'), 'false');
click(header());
eq('nova montagem: visão lembrada = "Por item"', botaoVisao('Por item')?.getAttribute('aria-pressed'), 'true');
check('mini-totais P1 e P2 no resumo', texto(container).includes('P1') && texto(container).includes('P2') && texto(container).includes(fmt(lista.total / 2)));
check('sem onOpenDemand o DEM-N é texto (sem botão)', !qa('tbody > tr td:first-child button').length);

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
