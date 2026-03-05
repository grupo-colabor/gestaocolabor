import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ITEMS_PER_PAGE_OPTIONS } from '../hooks/usePagination';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  startIdx: number;
  entityLabel: string;
  onPageChange: (page: number) => void;
  onItemsPerPageChange: (n: number) => void;
  hideSizeSelector?: boolean;
}

/** Gera a sequência de páginas/reticências para exibir nos botões */
function buildPageRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [];
  const delta = 1; // vizinhos ao redor da página atual

  const left = current - delta;
  const right = current + delta;

  pages.push(1);

  if (left > 2) pages.push('...');

  for (let p = Math.max(2, left); p <= Math.min(total - 1, right); p++) {
    pages.push(p);
  }

  if (right < total - 1) pages.push('...');

  pages.push(total);

  return pages;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  startIdx,
  entityLabel,
  onPageChange,
  onItemsPerPageChange,
  hideSizeSelector = false,
}) => {
  if (totalItems === 0) return null;

  const from = startIdx + 1;
  const to = Math.min(startIdx + itemsPerPage, totalItems);
  const pageRange = buildPageRange(currentPage, totalPages);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white rounded-b-xl gap-4 flex-wrap">
      {/* Contador */}
      <p className="text-xs text-slate-500 font-medium whitespace-nowrap">
        Mostrando{' '}
        <span className="font-bold text-slate-700">{from}–{to}</span>{' '}
        de{' '}
        <span className="font-bold text-slate-700">{totalItems}</span>{' '}
        {entityLabel}
      </p>

      {/* Controles */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Seletor de itens por página */}
        {!hideSizeSelector && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">Por página:</span>
            <select
              value={itemsPerPage}
              onChange={e => onItemsPerPageChange(Number(e.target.value))}
              className="border border-slate-200 rounded-lg text-xs px-2 py-1.5 text-slate-600 bg-white outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
            >
              {ITEMS_PER_PAGE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        {/* Navegação */}
        <div className="flex items-center gap-1">
          {/* Anterior */}
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </button>

          {/* Números das páginas */}
          {pageRange.map((item, idx) =>
            item === '...' ? (
              <span
                key={`ellipsis-${idx}`}
                className="px-2 py-1.5 text-xs text-slate-400 select-none"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                onClick={() => onPageChange(item)}
                className={`min-w-[32px] px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                  item === currentPage
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {item}
              </button>
            )
          )}

          {/* Próximo */}
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Próxima página"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Pagination;
