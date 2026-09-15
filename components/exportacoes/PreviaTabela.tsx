import React from 'react';
import type { CellValue, ExportTable } from '../../domain/exports/types';
import { formatPreviewCell, isNumericKind } from './formatCell';
import Pagination from '../Pagination';
import { usePagination } from '../../hooks/usePagination';

/**
 * Prévia paginada da tabela que vai para o arquivo — as mesmas colunas, na
 * mesma ordem, com os mesmos valores. Só renderiza a página atual.
 */
const PreviaTabela: React.FC<{ table: ExportTable }> = ({ table }) => {
  const pag = usePagination<CellValue[]>(table.rows, 'exportacoes.previa.pageSize');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900 text-white">
              {table.columns.map(c => (
                <th key={c.key} className={`p-3 font-black uppercase tracking-wide text-[10px] whitespace-nowrap ${isNumericKind(c.kind) ? 'text-right' : ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pag.paginatedItems.map((row, i) => (
              <tr key={pag.startIdx + i} className="border-b border-slate-100 hover:bg-slate-50">
                {row.map((v, j) => {
                  const kind = table.columns[j].kind;
                  const vazio = v === null || v === undefined || v === '';
                  return (
                    <td
                      key={table.columns[j].key}
                      className={`p-3 whitespace-nowrap max-w-[260px] truncate ${isNumericKind(kind) ? 'text-right tabular-nums' : ''} ${vazio ? 'text-slate-300' : 'text-slate-700'}`}
                      title={vazio ? undefined : String(v)}
                    >
                      {formatPreviewCell(v, kind)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, table.columns.length)} className="p-10 text-center text-slate-300 font-bold">
                  Nenhuma linha com os filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {table.rows.length > 0 && (
        <Pagination
          currentPage={pag.currentPage}
          totalPages={pag.totalPages}
          totalItems={table.rows.length}
          itemsPerPage={pag.itemsPerPage}
          startIdx={pag.startIdx}
          entityLabel="linhas"
          onPageChange={pag.setCurrentPage}
          onItemsPerPageChange={pag.handleItemsPerPageChange}
        />
      )}
    </div>
  );
};

export default PreviaTabela;
