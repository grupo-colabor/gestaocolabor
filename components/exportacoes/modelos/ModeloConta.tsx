/**
 * MODELOS DE MEDIÇÃO — montar a conta de uma coluna, por seleção
 *
 * NINGUÉM DIGITA FÓRMULA AQUI. A pessoa escolhe uma operação numa lista fechada
 * e depois as colunas, pelos CABEÇALHOS do arquivo dela. O que sai é uma
 * `FormulaSpec` (domain/exports/templates/formula.ts); o texto com placeholders
 * e, no fim, a fórmula viva do Excel são derivados — a tela nunca os mostra.
 *
 * Embaixo, a conta em português (`describeFormulaSpec`): "Carga horária ×
 * Preço unitário HH". É a única leitura que a tela oferece, e é a que a pessoa
 * consegue conferir.
 *
 * Reabrir uma coluna calculada reabre a conta preenchida — é para isso que a
 * spec é guardada no banco em vez do texto compilado.
 */
import React from 'react';
import { Calculator } from 'lucide-react';

import {
  describeFormulaSpec,
  FORMULA_OPS,
  isColunaRef,
  validateFormulaSpec,
  type FormulaOp,
  type FormulaRef,
  type FormulaSpec,
} from '../../../domain/exports/templates/formula';

export interface ColunaDisponivel {
  key: string;
  header: string;
}

export interface ConstanteDisponivel {
  nome: string;
  label: string;
}

/** Um seletor de operando: uma coluna do arquivo ou um valor fixo do modelo. */
const SeletorOperando: React.FC<{
  label: string;
  valor: FormulaRef | null;
  colunas: ColunaDisponivel[];
  constantes: ConstanteDisponivel[];
  onChange: (r: FormulaRef) => void;
}> = ({ label, valor, colunas, constantes, onChange }) => {
  // O `value` do <select> precisa de uma string; o prefixo diz de qual lado
  // veio, para a tela não confundir uma coluna chamada "taxa" com o valor fixo
  // "taxa". Isso é interno ao <select> e nunca aparece para quem usa.
  const atual = valor ? (isColunaRef(valor) ? `c:${valor.coluna}` : `k:${valor.constante}`) : '';
  return (
    <label className="block">
      <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
      <select
        value={atual}
        onChange={e => {
          const v = e.target.value;
          if (!v) return;
          onChange(v.startsWith('c:') ? { coluna: v.slice(2) } : { constante: v.slice(2) });
        }}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <option value="">Escolha…</option>
        <optgroup label="Colunas da planilha">
          {colunas.map(c => (
            <option key={c.key} value={`c:${c.key}`}>
              {c.header || '(coluna sem nome)'}
            </option>
          ))}
        </optgroup>
        {constantes.length > 0 && (
          <optgroup label="Valores fixos do modelo">
            {constantes.map(k => (
              <option key={k.nome} value={`k:${k.nome}`}>
                {k.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
};

const SeletorColuna: React.FC<{
  label: string;
  valor: string;
  colunas: ColunaDisponivel[];
  onChange: (key: string) => void;
}> = ({ label, valor, colunas, onChange }) => (
  <label className="block">
    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
    <select
      value={valor}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
    >
      <option value="">Escolha…</option>
      {colunas.map(c => (
        <option key={c.key} value={c.key}>
          {c.header || '(coluna sem nome)'}
        </option>
      ))}
    </select>
  </label>
);

const SeletorConstante: React.FC<{
  label: string;
  valor: string;
  constantes: ConstanteDisponivel[];
  onChange: (nome: string) => void;
}> = ({ label, valor, constantes, onChange }) => (
  <label className="block">
    <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
    <select
      value={valor}
      onChange={e => onChange(e.target.value)}
      disabled={constantes.length === 0}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
    >
      <option value="">{constantes.length === 0 ? 'Cadastre um valor fixo primeiro' : 'Escolha…'}</option>
      {constantes.map(k => (
        <option key={k.nome} value={k.nome}>
          {k.label}
        </option>
      ))}
    </select>
  </label>
);

/** A spec vazia de cada operação, para a troca de operação não herdar lixo. */
function specInicial(op: FormulaOp): FormulaSpec {
  switch (op) {
    case 'multiplicar':
      return { op, a: { coluna: '' }, b: { coluna: '' } };
    case 'subtrair':
      return { op, a: { coluna: '' }, b: { coluna: '' } };
    case 'somarIntervalo':
      return { op, de: '', ate: '' };
    case 'somarComPercentual':
      return { op, de: '', ate: '', pct: { coluna: '' } };
    case 'somarConstante':
      return { op, a: { coluna: '' }, constante: '' };
  }
}

/** A conta está completa? Operando vazio ainda não é conta. */
export function contaCompleta(spec: FormulaSpec): boolean {
  const cheio = (r: FormulaRef) => (isColunaRef(r) ? !!r.coluna : !!r.constante);
  switch (spec.op) {
    case 'multiplicar':
    case 'subtrair':
      return cheio(spec.a) && cheio(spec.b);
    case 'somarIntervalo':
      return !!spec.de && !!spec.ate;
    case 'somarComPercentual':
      return !!spec.de && !!spec.ate && cheio(spec.pct);
    case 'somarConstante':
      return cheio(spec.a) && !!spec.constante;
  }
}

const ModeloConta: React.FC<{
  spec: FormulaSpec | null;
  colunas: ColunaDisponivel[];
  constantes: ConstanteDisponivel[];
  onChange: (s: FormulaSpec) => void;
}> = ({ spec, colunas, constantes, onChange }) => {
  const atual = spec ?? specInicial('multiplicar');
  const rotuloColuna = (key: string) => colunas.find(c => c.key === key)?.header || key;
  const rotuloConstante = (nome: string) => constantes.find(k => k.nome === nome)?.label || nome;

  const completa = contaCompleta(atual);
  const problemas = completa
    ? validateFormulaSpec(atual, { colunas: colunas.map(c => c.key), constantes: constantes.map(k => k.nome) })
    : [];

  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
      <label className="block">
        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
          Que conta esta coluna faz?
        </span>
        <select
          value={atual.op}
          onChange={e => onChange(specInicial(e.target.value as FormulaOp))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {FORMULA_OPS.map(o => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-slate-500 -mt-1">{FORMULA_OPS.find(o => o.op === atual.op)?.ajuda}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(atual.op === 'multiplicar' || atual.op === 'subtrair') && (
          <>
            <SeletorOperando
              label={atual.op === 'multiplicar' ? 'Multiplicar' : 'De'}
              valor={atual.a}
              colunas={colunas}
              constantes={constantes}
              onChange={a => onChange({ ...atual, a })}
            />
            <SeletorOperando
              label={atual.op === 'multiplicar' ? 'Por' : 'Subtrair'}
              valor={atual.b}
              colunas={colunas}
              constantes={constantes}
              onChange={b => onChange({ ...atual, b })}
            />
          </>
        )}

        {(atual.op === 'somarIntervalo' || atual.op === 'somarComPercentual') && (
          <>
            <SeletorColuna
              label="Somar da coluna"
              valor={atual.de}
              colunas={colunas}
              onChange={de => onChange({ ...atual, de })}
            />
            <SeletorColuna
              label="Até a coluna"
              valor={atual.ate}
              colunas={colunas}
              onChange={ate => onChange({ ...atual, ate })}
            />
          </>
        )}

        {atual.op === 'somarComPercentual' && (
          <SeletorOperando
            label="Acrescentar o percentual de"
            valor={atual.pct}
            colunas={colunas}
            constantes={constantes}
            onChange={pct => onChange({ ...atual, pct })}
          />
        )}

        {atual.op === 'somarConstante' && (
          <>
            <SeletorOperando
              label="Somar"
              valor={atual.a}
              colunas={colunas}
              constantes={constantes}
              onChange={a => onChange({ ...atual, a })}
            />
            <SeletorConstante
              label="Com o valor fixo"
              valor={atual.constante}
              constantes={constantes}
              onChange={constante => onChange({ ...atual, constante })}
            />
          </>
        )}
      </div>

      {(atual.op === 'somarIntervalo' || atual.op === 'somarComPercentual') && (
        <p className="text-[11px] text-slate-400">
          A soma inclui as colunas do meio, na ordem em que elas aparecem na planilha.
        </p>
      )}

      {/* A conta em português — a única leitura que a tela oferece. */}
      <div className="flex items-start gap-2 bg-white rounded-lg px-3 py-2 border border-slate-200">
        <Calculator size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <span className="text-sm text-slate-700">
          {completa ? (
            describeFormulaSpec(atual, { coluna: rotuloColuna, constante: rotuloConstante })
          ) : (
            <span className="text-slate-400">Escolha as colunas da conta.</span>
          )}
        </span>
      </div>

      {problemas.length > 0 && (
        <ul className="text-xs text-red-700 list-disc ml-4 space-y-0.5">
          {problemas.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ModeloConta;
