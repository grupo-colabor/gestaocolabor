import React, { useEffect, useState } from 'react';
import { BookmarkPlus, Check, Loader2, Pencil, Play, Save, Star, StarOff, Trash2 } from 'lucide-react';
import type { AnyDataset } from '../../domain/exports/registry';
import { PRESET_NAME_MAX, type ExportPreset } from '../../domain/exports/presets';
import ExportBanner from './ExportBanner';

/**
 * Barra "Modelos" da aba Exportações (migration 021). Só para datasets de
 * tabela. Lista os modelos do módulo atual (aplicar, regravar com a tela,
 * renomear, excluir, marcar como padrão) e salva a escolha atual com um nome.
 *
 * Toda regra (nome, período fora, padrão único, coluna inexistente) mora em
 * domain/exports/presets.ts; aqui só se pede e se mostra. Erro de banco chega
 * em `erro` e vira banner; avisos de aplicação chegam em `avisos`.
 */
const ModelosBar: React.FC<{
  dataset: AnyDataset;
  presets: ExportPreset[];
  carregando: boolean;
  ocupado: boolean;
  erro: string | null;
  avisos: string[];
  onAplicar: (p: ExportPreset) => void;
  onSalvar: (nome: string, isDefault: boolean) => Promise<boolean>;
  onAtualizar: (p: ExportPreset) => void;
  onRenomear: (p: ExportPreset, nome: string) => void;
  onExcluir: (p: ExportPreset) => void;
  onPadrao: (p: ExportPreset, isDefault: boolean) => void;
}> = ({ dataset, presets, carregando, ocupado, erro, avisos, onAplicar, onSalvar, onAtualizar, onRenomear, onExcluir, onPadrao }) => {
  const [selecionado, setSelecionado] = useState<string>('');
  const [nome, setNome] = useState('');
  const [comoPadrao, setComoPadrao] = useState(false);

  // Seleção segue a lista: some o selecionado → primeiro da lista.
  useEffect(() => {
    if (presets.length === 0) { setSelecionado(''); return; }
    if (!presets.some(p => p.id === selecionado)) setSelecionado(presets[0].id);
  }, [presets, selecionado]);

  const atual = presets.find(p => p.id === selecionado);
  const travado = carregando || ocupado || !!erro;

  const salvar = async () => {
    if (travado) return;
    const ok = await onSalvar(nome, comoPadrao);
    if (ok) { setNome(''); setComoPadrao(false); }
  };

  const renomear = () => {
    if (!atual || travado) return;
    const novo = window.prompt(`Novo nome para "${atual.name}":`, atual.name);
    if (novo === null) return;
    onRenomear(atual, novo);
  };

  const excluir = () => {
    if (!atual || travado) return;
    if (!window.confirm(`Excluir o modelo "${atual.name}"?`)) return;
    onExcluir(atual);
  };

  const atualizar = () => {
    if (!atual || travado) return;
    if (!window.confirm(`Regravar "${atual.name}" com os filtros, colunas e opções que estão na tela agora?`)) return;
    onAtualizar(atual);
  };

  const btn = 'px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <BookmarkPlus size={14} /> Modelos — {dataset.label}
          {carregando && <Loader2 size={12} className="animate-spin" />}
        </h3>
        <span className="text-[11px] text-slate-400">
          Um modelo guarda filtros (sem o período), colunas com a ordem e opções. O período fica sempre o da tela.
        </span>
      </div>

      {erro && (
        <ExportBanner tipo="erro">
          <strong>Modelos indisponíveis.</strong> Falha ao ler ou gravar em <code className="text-xs">export_presets</code>: <code className="text-xs">{erro}</code>
        </ExportBanner>
      )}
      {avisos.length > 0 && (
        <ExportBanner tipo="aviso">
          <strong>Modelo aplicado com ressalvas.</strong>
          <ul className="list-disc ml-4 mt-1">
            {avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </ExportBanner>
      )}

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <select
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white flex-1 min-w-0"
            value={selecionado}
            onChange={e => setSelecionado(e.target.value)}
            disabled={presets.length === 0 || travado}
            aria-label="Modelo salvo"
          >
            {presets.length === 0 && <option value="">Nenhum modelo salvo neste módulo</option>}
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.isDefault ? '★ ' : ''}{p.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => atual && onAplicar(atual)} disabled={!atual || travado} className={`${btn} bg-slate-900 text-white border-slate-900 hover:bg-slate-800`} title="Aplicar filtros, colunas e opções do modelo (o período da tela é mantido)">
            <Play size={12} /> Aplicar
          </button>
          <button type="button" onClick={() => atual && onPadrao(atual, !atual.isDefault)} disabled={!atual || travado} className={`${btn} bg-white text-slate-600 border-slate-200 hover:border-slate-400`} title={atual?.isDefault ? 'Deixar de ser o modelo padrão deste módulo' : 'Usar como padrão: aplicado ao abrir este módulo'}>
            {atual?.isDefault ? <StarOff size={12} /> : <Star size={12} />} {atual?.isDefault ? 'Tirar padrão' : 'Padrão'}
          </button>
          <button type="button" onClick={atualizar} disabled={!atual || travado} className={`${btn} bg-white text-slate-600 border-slate-200 hover:border-slate-400`} title="Regravar este modelo com o que está na tela">
            <Save size={12} /> Regravar
          </button>
          <button type="button" onClick={renomear} disabled={!atual || travado} className={`${btn} bg-white text-slate-600 border-slate-200 hover:border-slate-400`} title="Renomear">
            <Pencil size={12} /> Renomear
          </button>
          <button type="button" onClick={excluir} disabled={!atual || travado} className={`${btn} bg-white text-red-600 border-red-200 hover:border-red-400`} title="Excluir">
            <Trash2 size={12} /> Excluir
          </button>
        </div>

        <div className="flex items-center gap-2 md:border-l md:border-slate-100 md:pl-3">
          <input
            type="text"
            value={nome}
            maxLength={PRESET_NAME_MAX}
            onChange={e => setNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void salvar(); }}
            placeholder="Nome do novo modelo"
            disabled={travado}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 w-48"
            aria-label="Nome do novo modelo"
          />
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer whitespace-nowrap" title="Aplicado automaticamente ao abrir este módulo">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600" checked={comoPadrao} onChange={e => setComoPadrao(e.target.checked)} disabled={travado} />
            padrão
          </label>
          <button type="button" onClick={() => void salvar()} disabled={travado || !nome.trim()} className={`${btn} bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500`} title="Salvar o que está na tela como modelo">
            {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Salvar como modelo
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelosBar;
