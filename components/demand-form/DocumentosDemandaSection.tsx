import React from 'react';
import { FileDown, ChevronUp, ChevronDown, FileCheck, FilePlus, Trash2 } from 'lucide-react';

import DataViewField from './DataViewField';
import type { DemandFormMode } from './types';

/**
 * Seção "Documentos da Demanda" do formulário.
 *
 * Extraída de `Demands.tsx` sem alteração de marcação. Ao contrário das seções
 * de logística, os handlers NÃO vieram junto: `downloadSavedPdf`/`markDocAsNA`
 * dependem do id da demanda e recarregam `dbDocs` no formulário que hospeda a
 * seção — continuam lá e chegam aqui como callbacks.
 *
 * `labelListaTurma` existe porque o slot "LISTA_TURMA" muda de nome conforme o
 * tipo de demanda: numa demanda de cliente é a lista de presença da turma; numa
 * demanda interna é um documento de apoio qualquer. O doc_type persistido é o
 * mesmo — só o rótulo muda.
 */

export type PendingPdfs = {
  classList: File | null;
  instructorRelease: File | null;
};

export type DbDocs = Record<string, { name: string; path: string | null; is_na?: boolean }>;

interface DocumentosDemandaSectionProps {
  mode: DemandFormMode;
  /** CREATE muda só o texto do dropzone ("será enviado ao criar"). */
  modalMode: 'CREATE' | 'EDIT' | null;
  isOpen: boolean;
  onToggle: () => void;
  pendingPdfs: PendingPdfs;
  dbDocs: DbDocs;
  onPdfSelect: (key: 'classList' | 'instructorRelease', file: File) => void;
  onRemovePendingPdf: (key: 'classList' | 'instructorRelease') => void;
  onDownloadSavedPdf: (docType: 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR') => void;
  onMarkDocAsNA: (docType: 'LISTA_TURMA' | 'LIBERACAO_INSTRUTOR') => void;
  /** Rótulo do slot LISTA_TURMA. Default = comportamento atual do form de cliente. */
  labelListaTurma?: string;
}

const DocumentosDemandaSection: React.FC<DocumentosDemandaSectionProps> = ({
  mode,
  modalMode,
  isOpen,
  onToggle,
  pendingPdfs,
  dbDocs,
  onPdfSelect,
  onRemovePendingPdf,
  onDownloadSavedPdf,
  onMarkDocAsNA,
  labelListaTurma = 'Lista da Turma (PDF)',
}) => {
  // No VIEW o rótulo aparece sem o sufixo "(PDF)" — mesma regra do original,
  // onde o FORM dizia "Lista da Turma (PDF)" e o VIEW só "Lista da Turma".
  const labelListaTurmaView = labelListaTurma.replace(/\s*\(PDF\)\s*$/i, '');

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      <button onClick={onToggle} className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-slate-50 transition no-print">
        <div className="flex items-center gap-3"><div className="p-2 bg-rose-50 rounded-lg text-rose-600"><FileDown size={20} /></div><h3 className="font-bold text-slate-800 uppercase text-sm">Documentos da Demanda</h3></div>
        {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {isOpen && (
        <div className="px-6 py-6 border-t border-slate-100 bg-white">
          {mode === 'FORM' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* Lista da Turma */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-gray-500 uppercase">
                  {labelListaTurma}
                </label>

                {pendingPdfs.classList ? (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileCheck size={18} className="text-blue-600 shrink-0" />
                      <span className="text-xs font-bold text-slate-700 truncate" title={pendingPdfs.classList.name}>
                        {pendingPdfs.classList.name}
                      </span>
                    </div>

                    <button
                      onClick={() => onRemovePendingPdf('classList')}
                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                      title="Remover PDF"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative group">
                    <input
                      type="file"
                      accept="application/pdf"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onPdfSelect('classList', f);

                        // 🔧 permite selecionar o MESMO arquivo novamente
                        e.currentTarget.value = '';
                      }}
                      disabled={false}
                    />

                    <div
                      className={`p-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-all
                        border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50/30
                      `}
                    >
                      <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        {modalMode === 'CREATE'
                          ? 'Selecionar PDF (será enviado ao criar)'
                          : 'Anexar Lista de Presença'}
                      </span>
                    </div>
                  </div>
                )}
              </div>


              {/* Liberação do Instrutor */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-gray-500 uppercase">Liberação do Instrutor (PDF)</label>

                {pendingPdfs.instructorRelease ? (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileCheck size={18} className="text-blue-600 shrink-0" />
                      <span className="text-xs font-bold text-slate-700 truncate" title={pendingPdfs.instructorRelease.name}>{pendingPdfs.instructorRelease.name}</span>
                    </div>
                    <button onClick={() => onRemovePendingPdf('instructorRelease')} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative group">
                    <input
                      type="file"
                      accept=".pdf"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onPdfSelect('instructorRelease', f);
                        e.currentTarget.value = '';
                      }}
                    />
                    <div className={`p-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-all
                      ${'border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50/30'}
                    `}>
                      <FilePlus size={24} className="text-slate-300 group-hover:text-blue-500" />
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        {modalMode === 'CREATE' ? 'Selecionar PDF (será enviado ao criar)' : 'Anexar Liberação'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(() => {
                const lista = dbDocs['LISTA_TURMA'];
                const liberacao = dbDocs['LIBERACAO_INSTRUTOR'];

                const listaValue = lista?.is_na ? 'N/A' : (lista?.name || '---');
                const liberacaoValue = liberacao?.is_na ? 'N/A' : (liberacao?.name || '---');

                const canDownloadLista = !!lista?.path && !lista?.is_na;
                const canDownloadLiberacao = !!liberacao?.path && !liberacao?.is_na;

                return (
                  <>
                    <DataViewField
                      label={labelListaTurmaView}
                      value={listaValue}
                      isPdf={canDownloadLista}
                      onDownload={canDownloadLista ? () => onDownloadSavedPdf('LISTA_TURMA') : undefined}
                    />
                    {!lista?.path && !lista?.is_na && (
                      <button
                        onClick={() => onMarkDocAsNA('LISTA_TURMA')}
                        className="
                          mt-2
                          flex items-center justify-center gap-2
                          px-4 py-2
                          rounded-xl
                          border border-red-300
                          text-red-600
                          text-[11px]
                          font-black uppercase tracking-widest
                          transition-all
                          hover:bg-red-50
                          hover:border-red-400
                        "
                      >
                        N/A
                      </button>
                    )}

                    <DataViewField
                      label="Liberação do Instrutor"
                      value={liberacaoValue}
                      isPdf={canDownloadLiberacao}
                      onDownload={canDownloadLiberacao ? () => onDownloadSavedPdf('LIBERACAO_INSTRUTOR') : undefined}
                    />
                    {!liberacao?.path && !liberacao?.is_na && (
                      <button
                        onClick={() => onMarkDocAsNA('LIBERACAO_INSTRUTOR')}
                        className="
                          mt-2
                          flex items-center justify-center gap-2
                          px-4 py-2
                          rounded-xl
                          border border-red-300
                          text-red-600
                          text-[11px]
                          font-black uppercase tracking-widest
                          transition-all
                          hover:bg-red-50
                          hover:border-red-400
                        "
                      >
                        N/A
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentosDemandaSection;
