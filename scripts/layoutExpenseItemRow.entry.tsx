/**
 * ENTRADA DO SMOKE DE LAYOUT — smoke:layout-despesa
 *
 * Monta a linha de item de despesa (ExpenseItemRow, o componente de verdade)
 * dentro de cartões com as TRÊS larguras que o painel de Medição produz:
 * estreito (Outras Despesas, w-80 ≈ 256px), médio (Café/Almoço/Jantar em
 * md:grid-cols-3 ≈ 267px) e largo (Hospedagem/Locomoção em lg:grid-cols-2
 * ≈ 432px). O runner (smokeLayoutDespesa.ts) abre este bundle num Chromium
 * headless e mede: nenhum botão pode sair do cartão nem ter texto cortado.
 *
 * Não roda no app; é só fixture de layout.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import ExpenseItemRow from '../components/measurement/ExpenseItemRow';
import type { Attachment } from '../types';

const item = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id,
  name: 'Lançamento Avulso',
  url: '#',
  type: 'text/plain',
  date: '2026-09-01T10:00:00',
  category: 'ALMOCO',
  value: '1234,56',
  ...over,
});

const noop = () => {};

const LARGURAS: { id: string; px: number; rotulo: string }[] = [
  { id: 'estreito', px: 256, rotulo: 'Outras Despesas (w-80)' },
  { id: 'medio', px: 267, rotulo: 'Café/Almoço/Jantar (md:grid-cols-3)' },
  { id: 'largo', px: 432, rotulo: 'Hospedagem/Locomoção (lg:grid-cols-2)' },
];

function App() {
  return (
    <div className="p-6 space-y-6 bg-slate-100 min-h-screen">
      {LARGURAS.map(l => (
        <div key={l.id} className="space-y-2">
          <p className="text-xs text-slate-500">{l.rotulo} — {l.px}px</p>
          <div data-card={l.id} style={{ width: l.px }} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-2">
            {/* item com as duas flags marcadas (rótulos no estado "ativo") */}
            <ExpenseItemRow
              attachment={item(`${l.id}-1`, { reembolsavel: false, pagoPeloInstrutor: true })}
              onUpdateValue={noop}
              onRemove={noop}
              showReembolsavel
              onToggleReembolsavel={noop}
              onTogglePagoPeloInstrutor={noop}
            />
            {/* item sem flag marcada, com nome longo de arquivo */}
            <ExpenseItemRow
              attachment={item(`${l.id}-2`, { name: 'comprovante-restaurante-mina-de-brucutu-2026-08-13.pdf', url: 'https://example.invalid/x.pdf', type: 'application/pdf' })}
              onUpdateValue={noop}
              onRemove={noop}
              showReembolsavel
              onToggleReembolsavel={noop}
              onTogglePagoPeloInstrutor={noop}
              donoPadraoNome="Clayton Ribeiro"
            />
            {/* item sem dono marcado como pago: aviso na linha de baixo */}
            <ExpenseItemRow
              attachment={item(`${l.id}-3`, { pagoPeloInstrutor: true })}
              onUpdateValue={noop}
              onRemove={noop}
              showReembolsavel={false}
              onTogglePagoPeloInstrutor={noop}
              donoPadraoNome="Clayton Ribeiro"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
