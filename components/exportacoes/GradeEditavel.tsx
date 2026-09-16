import React from 'react';
import { PencilLine } from 'lucide-react';
import type { MedicaoValeRow } from '../../domain/exports/datasets/medicaoVale';
import type { TemplateColumn } from '../../domain/exports/templates/types';
import { resolveManualValue, type ManualValueSource } from '../../domain/exports/templates/resolve';
import type { TemplateValuesIndex } from '../../domain/exports/templates/values';
import { toBrDate } from '../../domain/exports/shared';

export type EdicaoPendente = {
  scope: 'training' | 'demand';
  refId: string;
  columnKey: string;
  value: number | string | null;
};

const FONTE_LABEL: Record<ManualValueSource, string> = {
  demanda: 'sobrescrito na turma',
  treinamento: 'por treinamento',
  padrão: 'padrão do template',
  vazio: 'vazio',
};

/**
 * Campos manuais do template, editáveis na prévia. Duas partes:
 *   • preço HH POR TREINAMENTO (persistScope 'training') — um input por
 *     treinamento presente no recorte; vale para toda turma daquele
 *     treinamento que não tenha sobrescrita;
 *   • por TURMA — sobrescrita do preço, combustível, % e observação.
 * Nada é gravado aqui: as edições sobem para o pai como pendentes e só vão
 * ao banco no botão Salvar. O download fica travado enquanto houver pendente.
 */
const GradeEditavel: React.FC<{
  rows: MedicaoValeRow[];
  columns: TemplateColumn[];
  values: TemplateValuesIndex;
  onEdit: (e: EdicaoPendente) => void;
  trainingNames: Map<string, string>;
}> = ({ rows, columns, values, onEdit, trainingNames }) => {
  const manuais = columns.filter(c => c.source === 'manual' && c.editable);
  const porTreinamento = manuais.filter(c => c.persistScope === 'training');
  const porDemanda = manuais.filter(c => c.persistScope === 'demand' || c.overrideScope === 'demand');

  const treinamentos: string[] = Array.from(new Set<string>(rows.map(r => r.trainingId).filter(id => !!id))).sort((a, b) =>
    (trainingNames.get(a) ?? a).localeCompare(trainingNames.get(b) ?? b, 'pt-BR')
  );

  const parse = (col: TemplateColumn, raw: string): number | string | null => {
    if (col.format === 'text') return raw;
    if (raw.trim() === '') return null;
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return col.format === 'percent' ? n / 100 : n;
  };
  const show = (col: TemplateColumn, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '';
    if (col.format === 'percent') return String(Math.round(Number(v) * 10000) / 100);
    return String(v);
  };
  const inputClass = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <PencilLine size={14} /> Campos manuais da planilha
        </h3>
        <p className="text-[11px] text-slate-400 mt-1">
          O preço HH é lembrado por treinamento e pré-preenche as turmas; sobrescreva na turma quando precisar.
          Nada é gravado até clicar em <strong>Salvar</strong>.
        </p>
      </div>

      {porTreinamento.length > 0 && treinamentos.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Por treinamento</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {treinamentos.map(tid =>
              porTreinamento.map(col => {
                const atual = resolveManualValue(col, { trainingId: tid, demandId: '' }, values);
                return (
                  <label key={`${tid}:${col.key}`} className="text-xs">
                    <span className="block font-bold text-slate-600 truncate" title={trainingNames.get(tid) ?? tid}>
                      {trainingNames.get(tid) ?? tid}
                    </span>
                    <span className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{col.header}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={inputClass}
                        defaultValue={show(col, atual.fonte === 'treinamento' ? atual.value : null)}
                        placeholder="R$"
                        onBlur={e => onEdit({ scope: 'training', refId: tid, columnKey: col.key, value: parse(col, e.target.value) })}
                      />
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="p-3 font-black uppercase text-[10px]">Turma</th>
              <th className="p-3 font-black uppercase text-[10px]">Treinamento</th>
              <th className="p-3 font-black uppercase text-[10px]">Data</th>
              {porDemanda.map(col => (
                <th key={col.key} className="p-3 font-black uppercase text-[10px] whitespace-nowrap">{col.header}</th>
              ))}
              <th className="p-3 font-black uppercase text-[10px]">Fonte do preço</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const preco = porTreinamento[0] ? resolveManualValue(porTreinamento[0], r.refs, values) : null;
              return (
                <tr key={r.demand.id} className="border-t border-slate-100">
                  <td className="p-3 whitespace-nowrap">
                    <span className="font-black font-mono text-blue-600">{r.demand.id}</span>
                    <span className="block text-[10px] text-slate-400 font-mono">{r.input.clientDemandId || 'sem ID SAP'}</span>
                  </td>
                  <td className="p-3 max-w-[220px] truncate" title={r.input.trainingName}>{r.input.trainingName}</td>
                  <td className="p-3 whitespace-nowrap">{toBrDate(r.input.dataInicio)}</td>
                  {porDemanda.map(col => {
                    const atual = resolveManualValue(col, r.refs, values);
                    const proprio = atual.fonte === 'demanda' ? atual.value : null;
                    return (
                      <td key={col.key} className="p-2 min-w-[120px]">
                        <input
                          type="text"
                          inputMode={col.format === 'text' ? 'text' : 'decimal'}
                          className={inputClass}
                          defaultValue={show(col, proprio)}
                          placeholder={col.format === 'text' ? '' : show(col, atual.value) || '—'}
                          onBlur={e => onEdit({ scope: 'demand', refId: r.demand.id, columnKey: col.key, value: parse(col, e.target.value) })}
                        />
                      </td>
                    );
                  })}
                  <td className="p-3 whitespace-nowrap">
                    {preco && (
                      <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${preco.fonte === 'vazio' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {FONTE_LABEL[preco.fonte]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4 + porDemanda.length} className="p-8 text-center text-slate-300 font-bold">Nenhuma turma no recorte.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default GradeEditavel;
