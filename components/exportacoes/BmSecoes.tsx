import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileSignature, Table2 } from 'lucide-react';
import type { BmMina, BmResult } from '../../domain/exports/datasets/medicaoValeBm';
import type { MeasurementTemplate } from '../../domain/exports/templates/types';
import type { TemplateValuesIndex } from '../../domain/exports/templates/values';
import { getTemplateValue } from '../../domain/exports/templates/values';
import type { EdicaoPendente } from './GradeEditavel';
import { formatPreviewCell } from './formatCell';

const inputClass = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white';

/** Minas do BM agrupadas por corredor, na ordem de `bm.corredores`. */
const porCorredor = (bm: BmResult) => bm.corredores.map(c => ({ corredor: c, minas: bm.minas.filter(m => m.corredor === c) }));

/** Com corredor "Todos" (`bm.corredor` vazio) as seções ganham um título por corredor. */
const CorredorTitulo: React.FC<{ corredor: string; minas: number }> = ({ corredor, minas }) => (
  <p className="px-6 pt-3 pb-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">
    Corredor {corredor} · {minas} mina(s)
  </p>
);

/**
 * Bloco "Cabeçalho do BM" — recolhido; um formulário por (corredor, mina) do
 * recorte, pré-preenchido do cadastro (escopo 'context'). Salvar é explícito
 * (barra da grade); a primeira vez vem em branco com aviso. Com corredor
 * "Todos", as minas vêm agrupadas por corredor — o cadastro continua sendo
 * por corredor|mina.
 */
export const CabecalhoBm: React.FC<{
  template: MeasurementTemplate;
  bm: BmResult;
  values: TemplateValuesIndex;
  resetKey: number;
  onEdit: (e: EdicaoPendente) => void;
}> = ({ template, bm, values, resetKey, onEdit }) => {
  const [aberto, setAberto] = useState(false);
  /** Chave corredor|mina — com "Todos" a mesma mina pode existir em dois corredores. */
  const [minaAberta, setMinaAberta] = useState<string | null>(null);
  const campos = template.contextFields ?? [];
  const incompletas = bm.minas.filter(m => m.cabecalhoIncompleto.length > 0);
  const todos = !bm.corredor;
  const rotulo = (m: BmMina) => (todos ? `${m.corredor} | ${m.mina}` : m.mina);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setAberto(a => !a)} className="w-full px-6 py-4 flex items-center gap-3 text-left hover:bg-slate-50">
        {aberto ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        <span>
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <FileSignature size={14} /> Cabeçalho do BM
          </span>
          <span className="block text-[11px] text-slate-500 mt-1">
            {bm.minas.length === 0
              ? 'Nenhuma mina no recorte.'
              : incompletas.length === 0
                ? `${bm.minas.length} mina(s) com cabeçalho cadastrado.`
                : `${incompletas.length} de ${bm.minas.length} mina(s) sem cabeçalho completo: ${incompletas.map(rotulo).join(', ')}.`}
          </span>
        </span>
      </button>

      {aberto && (
        <div key={`cab-${resetKey}`} className="border-t border-slate-100">
          {incompletas.length > 0 && (
            <p className="px-6 py-2 text-[11px] text-amber-800 bg-amber-50">
              Primeira vez nesta mina: os campos nascem em branco. O BM sai com as células amarelas até você preencher e salvar.
            </p>
          )}
          {porCorredor(bm).map(g => (
            <div key={g.corredor}>
              {todos && <CorredorTitulo corredor={g.corredor} minas={g.minas.length} />}
              {g.minas.map(m => {
                const abertaMina = minaAberta === m.contextKey;
                return (
                  <div key={m.contextKey} className="border-t border-slate-100">
                    <button type="button" onClick={() => setMinaAberta(abertaMina ? null : m.contextKey)} className="w-full px-6 py-3 flex items-center gap-3 text-left hover:bg-slate-50">
                      {abertaMina ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      <span className="text-xs font-bold text-slate-700">{m.corredor} | {m.mina}</span>
                      <span className={`ml-auto text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${m.cabecalhoIncompleto.length ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-600'}`}>
                        {m.cabecalhoIncompleto.length ? `${m.cabecalhoIncompleto.length} em branco` : 'completo'}
                      </span>
                    </button>
                    {abertaMina && (
                      <div className="px-6 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50/60">
                        {campos.map(c => {
                          const atual = getTemplateValue(values, 'context', m.contextKey, c.key);
                          const vazio = atual === undefined || atual === null || atual === '';
                          return (
                            <label key={c.key} className="text-xs">
                              <span className="block font-bold text-slate-600">{c.label}</span>
                              <input
                                type="text"
                                className={`${inputClass} ${vazio && c.defaultValue === undefined ? 'bg-yellow-50 border-yellow-300' : ''}`}
                                defaultValue={vazio ? '' : String(atual)}
                                placeholder={c.defaultValue ?? ''}
                                onBlur={e =>
                                  onEdit({ scope: 'context', refId: m.contextKey, columnKey: c.key, value: e.target.value.trim() || null, templateId: template.id })
                                }
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Prévia por mina: descrição, unidade, preço, quantidade, total — sem edição. Com "Todos", agrupada por corredor. */
export const PreviaBm: React.FC<{ bm: BmResult; periodoLabel: string }> = ({ bm, periodoLabel }) => (
  <div className="space-y-4">
    {porCorredor(bm).map(g => (
      <div key={g.corredor} className="space-y-4">
        {!bm.corredor && <CorredorTitulo corredor={g.corredor} minas={g.minas.length} />}
        {g.minas.map(m => (
          <MinaPrevia key={m.contextKey} mina={m} periodoLabel={periodoLabel} />
        ))}
      </div>
    ))}
    {bm.minas.length === 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-300 font-bold text-sm">
        Nenhuma turma elegível com local no recorte.
      </div>
    )}
  </div>
);

const MinaPrevia: React.FC<{ mina: BmMina; periodoLabel: string }> = ({ mina, periodoLabel }) => {
  const total = mina.totalTreinamentos + mina.totalDespesas;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Table2 size={14} /> BM — {mina.corredor} | {mina.mina}
        </span>
        <span className="text-[11px] text-slate-400">{periodoLabel || 'sem período'} · {mina.turmas.length} turma(s)</span>
        {mina.cabecalhoIncompleto.length > 0 && (
          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">cabeçalho incompleto</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900 text-white">
              {['QQP', 'Descrição', 'Unidade', 'Preço unitário', 'Quantidade', 'Valor total'].map(h => (
                <th key={h} className="p-3 font-black uppercase tracking-wide text-[10px] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mina.linhas.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="p-3">{l.qqp}</td>
                <td className="p-3 max-w-[420px] truncate" title={l.descricao}>{l.descricao}</td>
                <td className="p-3">{String(l.unidade)}</td>
                <td className={`p-3 text-right tabular-nums ${l.preco === null ? 'bg-yellow-100' : ''}`}>{l.preco === null ? '—' : formatPreviewCell(l.preco, 'currency')}</td>
                <td className="p-3 text-right tabular-nums">{formatPreviewCell(l.quantidade, l.tipo === 'despesas' ? 'currency' : 'hours')}</td>
                <td className="p-3 text-right tabular-nums text-slate-500 italic">{formatPreviewCell((l.preco ?? 0) * l.quantidade, 'currency')}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-black">
              <td className="p-3" colSpan={5}>VALOR TOTAL DESTA MEDIÇÃO (R$)</td>
              <td className="p-3 text-right tabular-nums">{formatPreviewCell(total, 'currency')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
