/**
 * MODELOS DE MEDIÇÃO — conferir com turmas de verdade antes de salvar
 *
 * A defesa contra mapear errado. Nenhuma validação pega "a pessoa ligou a
 * coluna Treinamento ao campo Local": os dois são texto, os dois preenchem, o
 * arquivo sai bonito e errado. Erro de mapeamento é erro de LEITURA HUMANA, e a
 * única defesa é mostrar o resultado.
 *
 * Por isso aqui aparecem as 3 primeiras turmas REAIS do recorte, com o valor
 * que cada coluna vai receber e, embaixo, de onde ele veio em português
 * ("Treinamento → NR-35 Trabalho em Altura").
 *
 * Coluna calculada mostra o RESULTADO (`evaluateFormulaSpec`), não a fórmula:
 * quem confere não escreve Excel. O que vai para o arquivo continua sendo a
 * fórmula viva.
 *
 * SEM TURMA NO RECORTE NÃO É ERRO. Um modelo pode ser configurado em janeiro
 * para uma empresa cuja primeira turma é em março. A tela diz isso e deixa
 * salvar — travar aqui seria impedir o trabalho por causa de um calendário.
 */
import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';

import { SOURCE_FIELDS, type SourceField } from '../../../domain/exports/templates/sourceFields';
import { describeFormulaSpec, evaluateFormulaSpec } from '../../../domain/exports/templates/formula';
import type { MeasurementTemplate, TemplateColumn } from '../../../domain/exports/templates/types';
import type { RowsSheetInput } from '../../../domain/exports/templates/resolve';
import { resolveManualValue } from '../../../domain/exports/templates/resolve';
import type { TemplateValuesIndex } from '../../../domain/exports/templates/values';
import { formatTemplateCell } from '../formatCell';
import ExportBanner from '../ExportBanner';

const TURMAS_NA_CONFERENCIA = 3;

/** De onde este valor veio, em português, para aparecer sob a célula. */
function origemEmPortugues(c: TemplateColumn, constantes: Record<string, unknown>): string {
  if (c.source === 'sequence') return 'Numeração automática';
  if (c.source === 'blank') return 'Sempre em branco';
  if (c.source === 'manual') {
    return c.persistScope === 'training'
      ? 'Digitado — um valor por treinamento'
      : 'Digitado — um valor por turma';
  }
  if (c.source === 'constant') {
    const nome = c.constantName ?? c.key;
    return `Valor fixo do modelo (${String(constantes[nome] ?? '—')})`;
  }
  if (c.source === 'formula') return 'Calculado';
  const def = SOURCE_FIELDS[c.source as SourceField];
  return def ? def.label : 'Campo que não existe mais no sistema';
}

const ModeloConferencia: React.FC<{
  template: MeasurementTemplate;
  /** As turmas do recorte, já resolvidas pelo dataset. */
  linhas: RowsSheetInput[];
  values: TemplateValuesIndex;
}> = ({ template, linhas, values }) => {
  const sheet = template.sheets.find(s => s.kind === 'rows');
  const colunas = sheet?.columns ?? [];
  const amostra = linhas.slice(0, TURMAS_NA_CONFERENCIA);
  const constantes = template.constants ?? {};
  const ordem = colunas.map(c => c.key);

  /** O valor de uma coluna para uma turma, já formatado como vai sair. */
  const valorDaCelula = useMemo(
    () =>
      (c: TemplateColumn, linha: RowsSheetInput, indice: number): string => {
        const fmt = (v: unknown) =>
          v === null || v === undefined || v === '' ? '' : formatTemplateCell(v as any, c.format);

        if (c.source === 'sequence') return String(indice + 1);
        if (c.source === 'blank') return '';
        if (c.source === 'manual') return fmt(resolveManualValue(c, linha.refs, values).value);
        if (c.source === 'constant') return fmt(constantes[c.constantName ?? c.key]);
        if (c.source === 'formula') {
          if (!c.formulaSpec) return '';
          const bruto = (key: string): number | null => {
            const alvo = colunas.find(x => x.key === key);
            if (!alvo) return null;
            if (alvo.source === 'manual') {
              const v = resolveManualValue(alvo, linha.refs, values).value;
              return typeof v === 'number' ? v : Number(v) || 0;
            }
            if (alvo.source === 'constant') {
              const v = constantes[alvo.constantName ?? alvo.key];
              return typeof v === 'number' ? v : 0;
            }
            const def = SOURCE_FIELDS[alvo.source as SourceField];
            if (!def) return null;
            const v = def.get(linha.input);
            return typeof v === 'number' ? v : Number(v) || 0;
          };
          const r = evaluateFormulaSpec(c.formulaSpec, { valorDaColuna: bruto, ordem, constantes });
          return r === null ? '' : fmt(r);
        }
        const def = SOURCE_FIELDS[c.source as SourceField];
        return def ? fmt(def.get(linha.input)) : '';
      },
    [colunas, constantes, ordem, values]
  );

  if (colunas.length === 0) {
    return <ExportBanner tipo="aviso">Configure as colunas antes de conferir.</ExportBanner>;
  }

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-1">
        <Eye size={14} /> Confira antes de salvar
      </h3>
      <p className="text-[11px] text-slate-400 mb-4">
        {amostra.length > 0
          ? `Estas são as ${amostra.length} primeiras turmas reais do período. Veja se cada coluna recebeu o que você esperava — embaixo de cada valor está de onde ele veio.`
          : 'Nenhuma turma no período selecionado.'}
      </p>

      {amostra.length === 0 ? (
        <ExportBanner tipo="aviso">
          <strong>Não há turma concluída no período para conferir.</strong> Isso não impede de salvar:
          o modelo fica pronto e a conferência acontece quando houver turma. Se quiser conferir agora,
          troque o período no filtro acima.
        </ExportBanner>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="text-xs min-w-full">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-3 py-2 text-left font-bold sticky left-0 bg-slate-800 z-10">Turma</th>
                {colunas.map(c => (
                  <th key={c.key} className="px-3 py-2 text-left font-bold whitespace-nowrap max-w-[200px] truncate">
                    {c.header || '(sem nome)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {amostra.map((linha, i) => (
                <tr key={linha.refs.demandId} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-3 py-2 font-bold text-slate-700 align-top sticky left-0 bg-inherit whitespace-nowrap">
                    {linha.input.demandId}
                  </td>
                  {colunas.map(c => {
                    const valor = valorDaCelula(c, linha, i);
                    return (
                      <td key={c.key} className="px-3 py-2 align-top border-l border-slate-100 max-w-[220px]">
                        <span className={`block truncate ${valor ? 'text-slate-800' : 'text-slate-300 italic'}`} title={valor}>
                          {valor || 'em branco'}
                        </span>
                        <span className="block text-[10px] text-slate-400 mt-0.5 truncate" title={origemEmPortugues(c, constantes)}>
                          {c.source === 'formula' && c.formulaSpec
                            ? describeFormulaSpec(c.formulaSpec, {
                                coluna: k => colunas.find(x => x.key === k)?.header,
                                constante: n => template.constantDefs?.find(d => d.name === n)?.label,
                              })
                            : origemEmPortugues(c, constantes)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {linhas.length > amostra.length && (
        <p className="text-[11px] text-slate-400 mt-3">
          O período tem {linhas.length} turma(s); aqui estão as {amostra.length} primeiras.
        </p>
      )}
    </div>
  );
};

export default ModeloConferencia;
