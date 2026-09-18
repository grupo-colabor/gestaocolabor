/**
 * MODELOS DE MEDIÇÃO — dizer o que cada coluna do arquivo recebe
 *
 * Uma linha por coluna da planilha, NA ORDEM DA PLANILHA, com o cabeçalho
 * exatamente como está no arquivo do cliente. Ao lado, de onde o valor vem:
 * campo do sistema, digitado na hora, calculado, ou em branco.
 *
 * O QUE ESTA TELA NUNCA MOSTRA: chave de coluna, caminho de campo
 * (`demand.clientDemandId`), sintaxe de Excel. Os campos aparecem pelo rótulo
 * de negócio do catálogo, agrupados por assunto — e o grupo vem do catálogo,
 * não de uma lista daqui, para não existirem duas verdades.
 *
 * Coluna sem origem escolhida fica PENDENTE e impede salvar: um modelo salvo
 * pela metade viraria módulo e geraria planilha com buraco.
 */
import React, { useMemo, useState } from 'react';
import { AlertCircle, Calculator, CheckCircle2, ChevronDown, Plus, Sigma, Trash2 } from 'lucide-react';

import {
  SOURCE_FIELDS,
  SOURCE_FIELD_GROUPS,
  type SourceField,
} from '../../../domain/exports/templates/sourceFields';
import type { FormulaSpec } from '../../../domain/exports/templates/formula';
import { describeFormulaSpec } from '../../../domain/exports/templates/formula';
import {
  COLUMN_ORIGENS,
  type ColumnOrigem,
  type MappingColumn,
  type MappingConstant,
  type TemplateMapping,
} from '../../../domain/exports/templates/mapping';
import type { TemplateFormat, TemplatePersistScope } from '../../../domain/exports/templates/types';
import ModeloConta, { contaCompleta } from './ModeloConta';
import ExportBanner from '../ExportBanner';

const FORMATOS: { valor: TemplateFormat; label: string }[] = [
  { valor: 'text', label: 'Texto' },
  { valor: 'integer', label: 'Número inteiro' },
  { valor: 'hours', label: 'Horas' },
  { valor: 'currency', label: 'Dinheiro (R$)' },
  { valor: 'percent', label: 'Percentual (%)' },
  { valor: 'date', label: 'Data' },
  { valor: 'time', label: 'Hora' },
];

/** A coluna já está resolvida? É o que a contagem e o bloqueio de salvar usam. */
export function colunaConfigurada(c: MappingColumn): boolean {
  switch (c.origem) {
    case 'campo':
      return !!c.campo;
    case 'calculado':
      return !!c.formula && contaCompleta(c.formula);
    case 'constante':
      return !!c.constante;
    case 'digitado':
    case 'branco':
    case 'sequencia':
      return true;
    default:
      return false;
  }
}

/** O que a linha mostra como resumo quando está fechada. */
function resumo(c: MappingColumn, constantes: MappingConstant[]): string {
  switch (c.origem) {
    case 'campo':
      return c.campo && SOURCE_FIELDS[c.campo] ? SOURCE_FIELDS[c.campo].label : 'Escolha o campo';
    case 'digitado':
      return c.escopo === 'training'
        ? `Digitado — um valor por treinamento${c.sobrescreverNaTurma ? ', com ajuste por turma' : ''}`
        : 'Digitado — um valor por turma';
    case 'calculado':
      return c.formula && contaCompleta(c.formula)
        ? describeFormulaSpec(c.formula, { coluna: () => undefined, constante: n => constantes.find(k => k.nome === n)?.label })
        : 'Monte a conta';
    case 'constante':
      return c.constante ? `Valor fixo: ${constantes.find(k => k.nome === c.constante)?.label ?? c.constante}` : 'Escolha o valor fixo';
    case 'branco':
      return 'Sempre em branco';
    case 'sequencia':
      return 'Numeração (1, 2, 3…)';
    default:
      return '';
  }
}

const ModeloMapeamento: React.FC<{
  mapping: TemplateMapping;
  onChange: (m: TemplateMapping) => void;
  /** Mostrado no topo (avisos da planilha, diff de arquivo trocado). */
  topo?: React.ReactNode;
}> = ({ mapping, onChange, topo }) => {
  const [aberta, setAberta] = useState<string | null>(null);

  const configuradas = mapping.columns.filter(colunaConfigurada).length;
  const pendentes = mapping.columns.length - configuradas;

  const colunasDisponiveis = useMemo(
    () => mapping.columns.map(c => ({ key: c.key, header: c.header })),
    [mapping.columns]
  );
  const constantesDisponiveis = useMemo(
    () => mapping.constants.map(k => ({ nome: k.nome, label: k.label })),
    [mapping.constants]
  );
  const rotuloColuna = (key: string) => mapping.columns.find(c => c.key === key)?.header || key;

  const patchColuna = (key: string, patch: Partial<MappingColumn>) =>
    onChange({ ...mapping, columns: mapping.columns.map(c => (c.key === key ? { ...c, ...patch } : c)) });

  /** Trocar de origem limpa o que era da origem anterior — nada de resíduo. */
  const trocarOrigem = (key: string, origem: ColumnOrigem) => {
    const limpo: Partial<MappingColumn> = {
      origem,
      campo: undefined,
      formula: undefined,
      constante: undefined,
      escopo: undefined,
      sobrescreverNaTurma: undefined,
    };
    if (origem === 'digitado') limpo.escopo = 'demand';
    patchColuna(key, limpo);
  };

  /* ───────── constantes ───────── */
  const [novaConst, setNovaConst] = useState({ label: '', valor: '' });

  const usosDaConstante = (nome: string): string[] => {
    const usos: string[] = [];
    for (const c of mapping.columns) {
      if (c.constante === nome) usos.push(c.header || c.key);
      if (c.formula && JSON.stringify(c.formula).includes(`"constante":"${nome}"`)) usos.push(c.header || c.key);
    }
    return [...new Set(usos)];
  };

  const addConstante = () => {
    const label = novaConst.label.trim();
    if (!label) return;
    // O NOME é interno (chave no jsonb e nas contas); a pessoa só vê o rótulo.
    const base = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'valor';
    let nome = base;
    let n = 2;
    while (mapping.constants.some(k => k.nome === nome)) nome = `${base}_${n++}`;

    const cru = novaConst.valor.trim().replace('%', '').replace(',', '.');
    const numero = Number(cru);
    // "20%" digitado vira 0.2; um número solto fica número; o resto é texto.
    const valor = novaConst.valor.includes('%') && Number.isFinite(numero)
      ? numero / 100
      : Number.isFinite(numero) && cru !== ''
        ? numero
        : novaConst.valor.trim();

    onChange({ ...mapping, constants: [...mapping.constants, { nome, label, valor }] });
    setNovaConst({ label: '', valor: '' });
  };

  const removerConstante = (k: MappingConstant) => {
    const usos = usosDaConstante(k.nome);
    if (usos.length > 0) {
      const ok = window.confirm(
        `“${k.label}” está sendo usado em: ${usos.join(', ')}.\n\n` +
        'Apagando, essas colunas ficam sem o valor e o modelo não vai poder gerar até você arrumá-las. Apagar mesmo assim?'
      );
      if (!ok) return;
    }
    onChange({ ...mapping, constants: mapping.constants.filter(x => x.nome !== k.nome) });
  };

  /* ───────── totais ───────── */
  const alternarTotal = (key: string) =>
    onChange({
      ...mapping,
      totals: mapping.totals.includes(key) ? mapping.totals.filter(k => k !== key) : [...mapping.totals, key],
    });

  const somaveis = mapping.columns.filter(c =>
    c.origem === 'calculado' || c.origem === 'constante' ||
    (c.origem === 'campo' && ['currency', 'hours', 'integer', 'percent'].includes(c.formato ?? '')) ||
    (c.origem === 'digitado' && ['currency', 'hours', 'integer'].includes(c.formato ?? ''))
  );

  return (
    <div className="space-y-4">
      {topo}

      {/* ───────── contagem ───────── */}
      <div className="bg-slate-900 text-white rounded-2xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Colunas configuradas</span>
          <span className="text-xl font-black">
            {configuradas} de {mapping.columns.length}
          </span>
        </div>
        {pendentes > 0 ? (
          <span className="text-xs font-bold text-amber-300 flex items-center gap-2">
            <AlertCircle size={14} /> Faltam {pendentes} coluna(s) para poder salvar
          </span>
        ) : (
          <span className="text-xs font-bold text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={14} /> Todas as colunas estão configuradas
          </span>
        )}
      </div>

      {/* ───────── colunas ───────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {mapping.columns.map(c => {
          const ok = colunaConfigurada(c);
          const expandida = aberta === c.key;
          return (
            <div key={c.key} className={expandida ? 'bg-slate-50' : ''}>
              <button
                type="button"
                onClick={() => setAberta(expandida ? null : c.key)}
                className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-800 truncate">
                    {c.header || <em className="text-slate-400 font-normal">coluna sem nome no arquivo</em>}
                  </span>
                  <span className={`block text-xs truncate ${ok ? 'text-slate-500' : 'text-amber-600 font-bold'}`}>
                    {ok ? resumo(c, mapping.constants) : 'Ainda não configurada'}
                  </span>
                </span>
                {ok ? (
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle size={16} className="text-amber-500 shrink-0" />
                )}
                <ChevronDown size={16} className={`text-slate-400 shrink-0 transition ${expandida ? 'rotate-180' : ''}`} />
              </button>

              {expandida && (
                <div className="px-5 pb-5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                        Esta coluna recebe
                      </span>
                      <select
                        value={c.origem}
                        onChange={e => trocarOrigem(c.key, e.target.value as ColumnOrigem)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        {COLUMN_ORIGENS.map(o => (
                          <option key={o.origem} value={o.origem}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="block text-[11px] text-slate-400 mt-1">
                        {COLUMN_ORIGENS.find(o => o.origem === c.origem)?.ajuda}
                      </span>
                    </label>

                    {c.origem !== 'branco' && (
                      <label className="block">
                        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                          Como o valor aparece
                        </span>
                        <select
                          value={c.formato ?? 'text'}
                          onChange={e => patchColuna(c.key, { formato: e.target.value as TemplateFormat })}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                        >
                          {FORMATOS.map(f => (
                            <option key={f.valor} value={f.valor}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  {/* campo do sistema */}
                  {c.origem === 'campo' && (
                    <label className="block">
                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                        Qual informação do sistema
                      </span>
                      <select
                        value={c.campo ?? ''}
                        onChange={e => patchColuna(c.key, { campo: e.target.value as SourceField })}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value="">Escolha…</option>
                        {SOURCE_FIELD_GROUPS.map(g => {
                          const doGrupo = (Object.keys(SOURCE_FIELDS) as SourceField[]).filter(
                            k => SOURCE_FIELDS[k].grupo === g
                          );
                          if (doGrupo.length === 0) return null;
                          return (
                            <optgroup key={g} label={g}>
                              {doGrupo.map(k => (
                                <option key={k} value={k}>
                                  {SOURCE_FIELDS[k].label}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    </label>
                  )}

                  {/* digitado na hora */}
                  {c.origem === 'digitado' && (
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Onde este valor fica guardado
                      </span>
                      {([
                        ['training', 'Um valor por treinamento', 'Serve para todas as turmas do mesmo treinamento. É o caso do preço da hora.'],
                        ['demand', 'Um valor por turma', 'Vale só para aquela turma. É o caso de uma observação ou de um custo avulso.'],
                      ] as [TemplatePersistScope, string, string][]).map(([escopo, label, ajuda]) => (
                        <label key={escopo} className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={`escopo-${c.key}`}
                            checked={(c.escopo ?? 'demand') === escopo}
                            onChange={() =>
                              patchColuna(c.key, {
                                escopo,
                                sobrescreverNaTurma: escopo === 'training' ? c.sobrescreverNaTurma : undefined,
                              })
                            }
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-bold text-slate-700">{label}</span>
                            <span className="block text-[11px] text-slate-500">{ajuda}</span>
                          </span>
                        </label>
                      ))}
                      {(c.escopo ?? 'demand') === 'training' && (
                        <label className="flex items-start gap-2 cursor-pointer pl-6">
                          <input
                            type="checkbox"
                            checked={!!c.sobrescreverNaTurma}
                            onChange={e => patchColuna(c.key, { sobrescreverNaTurma: e.target.checked || undefined })}
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-bold text-slate-700">Permitir sobrescrever nesta turma</span>
                            <span className="block text-[11px] text-slate-500">
                              O valor do treinamento vale por padrão, mas dá para trocar numa turma específica.
                            </span>
                          </span>
                        </label>
                      )}
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!c.destacarVazio}
                          onChange={e => patchColuna(c.key, { destacarVazio: e.target.checked || undefined })}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-bold text-slate-700">Avisar quando ficar em branco</span>
                          <span className="block text-[11px] text-slate-500">
                            A célula sai em amarelo e a turma aparece no painel de pendências.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {/* calculado */}
                  {c.origem === 'calculado' && (
                    <ModeloConta
                      spec={c.formula ?? null}
                      colunas={colunasDisponiveis.filter(x => x.key !== c.key)}
                      constantes={constantesDisponiveis}
                      onChange={(f: FormulaSpec) => patchColuna(c.key, { formula: f })}
                    />
                  )}

                  {/* valor fixo */}
                  {c.origem === 'constante' && (
                    <label className="block">
                      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                        Qual valor fixo
                      </span>
                      <select
                        value={c.constante ?? ''}
                        onChange={e => patchColuna(c.key, { constante: e.target.value })}
                        disabled={mapping.constants.length === 0}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      >
                        <option value="">
                          {mapping.constants.length === 0 ? 'Cadastre um valor fixo mais abaixo' : 'Escolha…'}
                        </option>
                        {mapping.constants.map(k => (
                          <option key={k.nome} value={k.nome}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ───────── valores fixos ───────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-1">
          <Calculator size={14} /> Valores fixos do modelo
        </h3>
        <p className="text-[11px] text-slate-400 mb-4">
          Valores que não mudam de turma para turma e que as contas podem usar — por exemplo
          “percentual de despesa = 20%” ou o número do contrato. Escreva 20% para percentual.
        </p>

        {mapping.constants.length > 0 && (
          <ul className="space-y-2 mb-4">
            {mapping.constants.map(k => {
              const usos = usosDaConstante(k.nome);
              return (
                <li key={k.nome} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-700 truncate">{k.label}</span>
                    <span className="block text-[11px] text-slate-500">
                      {typeof k.valor === 'number' && k.valor > 0 && k.valor < 1
                        ? `${(k.valor * 100).toLocaleString('pt-BR')}%`
                        : String(k.valor)}
                      {usos.length > 0 && ` · usado em ${usos.join(', ')}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removerConstante(k)}
                    title="Apagar"
                    className="text-slate-400 hover:text-red-600 p-1"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[180px]">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nome</span>
            <input
              value={novaConst.label}
              onChange={e => setNovaConst(v => ({ ...v, label: e.target.value }))}
              placeholder="percentual de despesa"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </label>
          <label className="w-36">
            <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Valor</span>
            <input
              value={novaConst.valor}
              onChange={e => setNovaConst(v => ({ ...v, valor: e.target.value }))}
              placeholder="20%"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </label>
          <button
            type="button"
            onClick={addConstante}
            disabled={!novaConst.label.trim()}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
          >
            <Plus size={14} /> Adicionar
          </button>
        </div>
      </div>

      {/* ───────── totais ───────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-1">
          <Sigma size={14} /> Linha de totais
        </h3>
        <p className="text-[11px] text-slate-400 mb-4">
          Marque as colunas que devem somar no fim da tabela. A soma cobre exatamente as turmas do mês.
        </p>
        {somaveis.length === 0 ? (
          <ExportBanner tipo="aviso">
            Nenhuma coluna com valor numérico ainda. Configure as colunas de dinheiro, horas ou
            quantidade e elas aparecem aqui.
          </ExportBanner>
        ) : (
          <div className="flex flex-wrap gap-2">
            {somaveis.map(c => {
              const marcada = mapping.totals.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => alternarTotal(c.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                    marcada
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {c.header || rotuloColuna(c.key)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModeloMapeamento;
