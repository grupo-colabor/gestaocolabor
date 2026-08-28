import React from 'react';
import { Paperclip, ExternalLink, Trash2, Unlink } from 'lucide-react';

import type { Attachment } from '../../types';
import { isNaoReembolsavel } from '../../domain/measurementTotals';
import { resolveAttachmentLink } from '../../domain/measurementAttachment';
import { supabase } from '../../lib/supabase';

/**
 * LINHA DE ITEM DE DESPESA — uma só, para as seis categorias
 *
 * Extraída de dentro do `CategoryBlock` (Measurement.tsx). O `CategoryBlock` já
 * era compartilhado pelas seis seções, mas a linha vivia solta lá dentro, sem
 * dono e sem contrato de layout — e foi exatamente aí que o bug apareceu.
 *
 * ⚠️ O BUG QUE ESTA LINHA PRECISA NÃO REPETIR
 *
 * A linha original era `flex` sem `flex-wrap`, e os controles da direita
 * (valor, flag de reembolso, lixeira) somam ~258px fixos. O bloco do nome era o
 * único com `min-w-0`, então TODA falta de espaço caía nele. Nas colunas
 * largas (Hospedagem e Locomoção, `lg:grid-cols-2`, ~432px) sobravam ~174px e o
 * link aparecia; nas estreitas (Café/Almoço/Jantar em `md:grid-cols-3`, ~267px,
 * e Outras Despesas em `w-80`, ~256px) sobravam ~9px ou menos e o link era
 * clipado a zero por `overflow-hidden` + `truncate`. O `<a>` estava lá, com o
 * href certo — invisível.
 *
 * Correção estrutural: `flex-wrap` + os controles agrupados num bloco só, e o
 * nome com `min-w-[7rem]`. Faltando espaço, os controles descem para a segunda
 * linha em vez de espremer o nome. Em coluna larga nada muda — continua tudo
 * numa linha, idêntico ao que Hospedagem já mostrava.
 *
 * Consequência: a linha não depende mais da largura de quem a hospeda. Uma
 * seção nova em coluna estreita não reintroduz o bug.
 */

export interface ExpenseItemRowProps {
  attachment: Attachment;
  onUpdateValue: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  showReembolsavel?: boolean;
  onToggleReembolsavel?: (id: string) => void;
}

const ExpenseItemRow: React.FC<ExpenseItemRowProps> = ({
  attachment: a,
  onUpdateValue,
  onRemove,
  showReembolsavel,
  onToggleReembolsavel,
}) => {
  // Resolução em tempo de leitura: se o item tem `bucket` + `path` mas perdeu a
  // `url`, o link é reconstruído aqui. Nada é gravado.
  const link = resolveAttachmentLink(a, {
    resolveStorageUrl: (bucket, path) =>
      supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? null,
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-slate-50 p-2 rounded-lg border border-slate-100 group">
      {/* Nome / link — `min-w-[7rem]` é o que força os controles a quebrarem de
          linha em coluna estreita, em vez de espremer o nome até sumir. */}
      <div className="flex-1 min-w-[7rem] overflow-hidden flex items-center gap-2">
        {link.kind === 'unlinked' ? (
          <span className="text-slate-300" title="Item sem referência de arquivo no registro"><Unlink size={12} /></span>
        ) : (
          <span className="text-slate-300"><Paperclip size={12} /></span>
        )}

        {link.kind === 'link' ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-600 font-medium truncate hover:underline flex items-center gap-1"
            title={link.label}
          >
            {link.label}
            <ExternalLink size={10} className="flex-shrink-0" />
          </a>
        ) : link.kind === 'unlinked' ? (
          <p
            className="text-[10px] text-slate-400 font-medium italic truncate"
            title="O arquivo não está referenciado neste item — nada a abrir."
          >
            {link.label}
          </p>
        ) : (
          <p className="text-[10px] text-slate-600 font-medium truncate" title={link.label}>
            {link.label}
          </p>
        )}
      </div>

      {/* Controles: um bloco só, para quebrarem juntos. */}
      <div className="flex items-center gap-3 ml-auto">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-2 py-0.5 shadow-inner">
          <span className="text-[9px] font-bold text-slate-400">R$</span>
          <input
            type="text"
            className="w-20 bg-transparent text-[11px] font-black text-slate-700 outline-none text-right"
            value={a.value}
            placeholder="0,00"
            onChange={e => onUpdateValue(a.id, e.target.value)}
          />
        </div>
        {showReembolsavel && (
          <button
            type="button"
            onClick={() => onToggleReembolsavel?.(a.id)}
            title={isNaoReembolsavel(a)
              ? 'Cliente NAO reembolsa este item — clique para voltar a reembolsavel'
              : 'Marcar como nao reembolsavel pelo cliente'}
            className={`shrink-0 px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border transition-all ${
              isNaoReembolsavel(a)
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : 'bg-white text-slate-300 border-slate-200 hover:text-amber-600 hover:border-amber-200'
            }`}
          >
            {isNaoReembolsavel(a) ? 'Nao reemb.' : 'Reembolsavel'}
          </button>
        )}
        <button onClick={() => onRemove(a.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default ExpenseItemRow;
