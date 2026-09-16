import React from 'react';
import { Paperclip, ExternalLink, Trash2, Unlink } from 'lucide-react';

import type { Attachment } from '../../types';
import { isNaoReembolsavel, isPagoPeloInstrutor } from '../../domain/measurementTotals';
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
 * (valor, flags, lixeira) somam ~340px fixos. O bloco do nome era o único com
 * `min-w-0`, então TODA falta de espaço caía nele. Nas colunas largas
 * (Hospedagem e Locomoção, `lg:grid-cols-2`, ~432px) sobravam ~90px e o link
 * aparecia; nas estreitas (Café/Almoço/Jantar em `md:grid-cols-3`, ~267px, e
 * Outras Despesas em `w-80`, ~256px) o link era clipado a zero por
 * `overflow-hidden` + `truncate`. O `<a>` estava lá, com o href certo — invisível.
 *
 * Correção estrutural: `flex-wrap` + os controles agrupados num bloco só, e o
 * nome com `min-w-[7rem]`. Faltando espaço, os controles descem para a segunda
 * linha em vez de espremer o nome. Uma seção nova em coluna estreita não
 * reintroduz o bug.
 *
 * AS DUAS FLAGS (lado a lado, à direita do valor, rótulo diz o estado):
 *   • NÃO REEMBOLSA  — `reembolsavel === false`: o CLIENTE não reembolsa a
 *     Colabor; o item fica fora da Medição Vale / BM. Âmbar quando ativo.
 *   • PAGO PELO INSTRUTOR — `pagoPeloInstrutor === true`: o instrutor pagou do
 *     bolso e a Colabor reembolsa a ele; entra no Excel de pagamento. Azul
 *     quando ativo. Independentes: as quatro combinações são válidas
 *     (domain/measurementTotals.ts).
 */

export interface ExpenseItemRowProps {
  attachment: Attachment;
  onUpdateValue: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  /** Flag da Vale. Escondida em demanda interna (toda despesa de interna é custo Colabor). */
  showReembolsavel?: boolean;
  onToggleReembolsavel?: (id: string) => void;
  /** Flag do Excel de pagamento. Sempre visível quando o handler existe. */
  onTogglePagoPeloInstrutor?: (id: string) => void;
  /**
   * Nome de quem recebe o reembolso de um item SEM dono lançado nesta seção
   * (o titular). Quando informado e o item sem `instructorId` está marcado
   * como pago pelo instrutor, a linha avisa para quem o reembolso vai.
   */
  donoPadraoNome?: string;
}

const ExpenseItemRow: React.FC<ExpenseItemRowProps> = ({
  attachment: a,
  onUpdateValue,
  onRemove,
  showReembolsavel,
  onToggleReembolsavel,
  onTogglePagoPeloInstrutor,
  donoPadraoNome,
}) => {
  // Resolução em tempo de leitura: se o item tem `bucket` + `path` mas perdeu a
  // `url`, o link é reconstruído aqui. Nada é gravado.
  const link = resolveAttachmentLink(a, {
    resolveStorageUrl: (bucket, path) =>
      supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? null,
  });

  const naoReembolsa = isNaoReembolsavel(a);
  const pagoPeloInstrutor = isPagoPeloInstrutor(a);
  const avisoDono = pagoPeloInstrutor && !a.instructorId && donoPadraoNome;

  const flagBase = 'shrink-0 px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border transition-all';
  const flagInativa = 'bg-white text-slate-300 border-slate-200';

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
            title="Fica fora da medição da Vale (o cliente não reembolsa este item)."
            className={`${flagBase} ${
              naoReembolsa
                ? 'bg-amber-100 text-amber-700 border-amber-300'
                : `${flagInativa} hover:text-amber-600 hover:border-amber-200`
            }`}
          >
            Não reembolsa
          </button>
        )}
        {onTogglePagoPeloInstrutor && (
          <button
            type="button"
            onClick={() => onTogglePagoPeloInstrutor(a.id)}
            title="Entra no Excel de pagamento do instrutor (ele pagou; a Colabor reembolsa)."
            className={`${flagBase} ${
              pagoPeloInstrutor
                ? 'bg-blue-100 text-blue-700 border-blue-300'
                : `${flagInativa} hover:text-blue-600 hover:border-blue-200`
            }`}
          >
            Pago pelo instrutor
          </button>
        )}
        <button onClick={() => onRemove(a.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Item sem dono marcado como pago: diz para quem o reembolso vai, em vez
          de deixar a atribuição implícita na regra "sem dono → titular". */}
      {avisoDono && (
        <p className="basis-full text-[9px] font-bold text-blue-600">
          Lançamento sem pessoa — o reembolso vai para {donoPadraoNome} (titular).
        </p>
      )}
    </div>
  );
};

export default ExpenseItemRow;
