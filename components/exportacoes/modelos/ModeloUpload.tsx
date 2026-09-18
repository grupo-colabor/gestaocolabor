/**
 * MODELOS DE MEDIÇÃO — enviar a planilha-base e confirmar o que o app leu
 *
 * Quem usa esta tela não é desenvolvedor. Três regras que ela cumpre:
 *
 *   1. NADA É DECIDIDO EM SILÊNCIO. O app SUGERE a aba e a linha do cabeçalho
 *      e mostra as primeiras linhas com o número da linha ao lado, do jeito que
 *      aparecem no Excel. A pessoa confirma olhando, ou corrige. Um palpite
 *      mudo sobre qual linha é o cabeçalho é o erro que só aparece na medição
 *      do cliente.
 *   2. TODO ERRO EM PORTUGUÊS, DIZENDO O QUE FAZER. As mensagens vêm prontas
 *      de services/exports/templateFile.ts (.xls antigo, arquivo grande, PDF
 *      por engano) — aqui só se mostra.
 *   3. AVISO NÃO É BLOQUEIO. Aba oculta ou protegida aparece em amarelo e a
 *      pessoa segue.
 *
 * A guarda de assinatura de bytes roda dentro de `readTemplateFile`, antes do
 * parser, e de novo no upload — ver o cabeçalho de templateStorage.ts.
 */
import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Loader2, Pencil, Upload } from 'lucide-react';

import {
  avisosDasColunas,
  columnsAt,
  suggestHeader,
  suggestSheet,
  type SheetSnapshot,
  type WorkbookSnapshot,
} from '../../../domain/exports/templates/inspect';
import { readTemplateFile } from '../../../services/exports/templateFile';
import ExportBanner from '../ExportBanner';

export interface PlanilhaConfirmada {
  arquivo: File;
  snapshot: WorkbookSnapshot;
  sheetName: string;
  headerRow: number;
  firstDataRow: number;
  /** Cabeçalhos exatos, na ordem das colunas — vira a impressão digital. */
  headers: string[];
  colunas: { index: number; letter: string; header: string; key: string; semCabecalho: boolean }[];
}

const LINHAS_NA_PREVIA = 5;

/** A linha como o Excel a mostraria, para a pessoa reconhecer. */
const LinhasDaPlanilha: React.FC<{
  aba: SheetSnapshot;
  headerRow: number;
  onEscolherCabecalho: (linha: number) => void;
}> = ({ aba, headerRow, onEscolherCabecalho }) => {
  const largura = Math.min(aba.columnCount, 8);
  const linhas = aba.rows.slice(0, LINHAS_NA_PREVIA);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-xs">
        <tbody>
          {linhas.map((celulas, i) => {
            const numero = i + 1;
            const eCabecalho = numero === headerRow;
            return (
              <tr
                key={numero}
                className={eCabecalho ? 'bg-emerald-50' : numero > headerRow ? 'bg-white' : 'bg-slate-50'}
              >
                <td className="px-2 py-1.5 text-[10px] font-black text-slate-400 border-r border-slate-200 w-10 text-center align-top">
                  {numero}
                </td>
                {Array.from({ length: largura }).map((_, c) => (
                  <td
                    key={c}
                    className={`px-2 py-1.5 border-r border-slate-100 max-w-[160px] truncate ${
                      eCabecalho ? 'font-bold text-emerald-900' : 'text-slate-600'
                    }`}
                    title={celulas[c]?.text || ''}
                  >
                    {celulas[c]?.text || ''}
                  </td>
                ))}
                <td className="px-2 py-1.5 w-28 text-right">
                  {eCabecalho ? (
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
                      cabeçalho
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onEscolherCabecalho(numero)}
                      className="text-[10px] font-bold text-slate-400 hover:text-slate-900 underline"
                    >
                      é esta
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {aba.rowCount > LINHAS_NA_PREVIA && (
        <p className="text-[11px] text-slate-400 px-3 py-2 bg-slate-50 border-t border-slate-200">
          Mostrando as {LINHAS_NA_PREVIA} primeiras linhas de {aba.rowCount}.
        </p>
      )}
    </div>
  );
};

const ModeloUpload: React.FC<{
  /** Rótulo do que está sendo enviado, para o título ("Gerdau"). */
  empresaLabel: string;
  /** Texto do botão final. */
  acaoLabel?: string;
  onConfirmar: (p: PlanilhaConfirmada) => void;
  onCancelar?: () => void;
  /** Mostrado acima da confirmação (usado pela troca de arquivo-base). */
  avisoExtra?: React.ReactNode;
  /** Trava o botão final (ex.: troca de arquivo que exige reconferência). */
  bloqueado?: boolean;
}> = ({ empresaLabel, acaoLabel = 'Confirmar e mapear as colunas', onConfirmar, onCancelar, avisoExtra, bloqueado }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [snapshot, setSnapshot] = useState<WorkbookSnapshot | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);

  const aba = useMemo(
    () => snapshot?.sheets.find(s => s.name === sheetName) ?? null,
    [snapshot, sheetName]
  );

  /** A sugestão do app para esta aba — só para dizer se a confiança é alta. */
  const sugestao = useMemo(() => (aba ? suggestHeader(aba) : null), [aba]);

  /**
   * As colunas da linha ESCOLHIDA. Sem heurística: se a pessoa corrigiu a
   * linha, o app não pode "discordar" e voltar para o palpite dele.
   */
  const colunas = useMemo(() => (aba ? columnsAt(aba, headerRow) : []), [aba, headerRow]);
  const avisosColunas = useMemo(() => avisosDasColunas(colunas), [colunas]);

  /** Avisos da aba (oculta, protegida) + os das colunas da linha escolhida. */
  const avisos = useMemo(() => {
    const daAba = (sugestao?.avisos ?? []).filter(a => /oculta|protegida/i.test(a));
    return [...daAba, ...avisosColunas];
  }, [sugestao, avisosColunas]);

  const escolher = async (f: File) => {
    setErro(null);
    setLendo(true);
    setSnapshot(null);
    setArquivo(null);
    try {
      const snap = await readTemplateFile(await f.arrayBuffer());
      const escolha = suggestSheet(snap);
      setSnapshot(snap);
      setArquivo(f);
      setSheetName(escolha.sheetName);
      setHeaderRow(escolha.header.headerRow);
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setLendo(false);
    }
  };

  const confirmar = () => {
    if (!arquivo || !snapshot || !aba) return;
    onConfirmar({
      arquivo,
      snapshot,
      sheetName,
      headerRow,
      firstDataRow: headerRow + 1,
      headers: colunas.map(c => c.header),
      colunas,
    });
  };

  return (
    <div className="space-y-4">
      {/* ───────── escolher o arquivo ───────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
          Planilha que {empresaLabel || 'a empresa'} usa na medição
        </h3>
        <p className="text-[11px] text-slate-400 mb-4">
          Envie o arquivo em branco, no formato .xlsx. É nele que a medição vai ser escrita todo mês,
          então mande o modelo oficial — não uma planilha já preenchida.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void escolher(f);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={lendo}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-md disabled:opacity-60"
          >
            {lendo ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {arquivo ? 'Escolher outro arquivo' : 'Escolher arquivo'}
          </button>
          {arquivo && (
            <span className="text-sm text-slate-600 flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-emerald-600" />
              {arquivo.name}
            </span>
          )}
        </div>
      </div>

      {erro && (
        <ExportBanner tipo="erro">
          <strong>Não deu para usar este arquivo.</strong> {erro}
        </ExportBanner>
      )}

      {/* ───────── confirmar aba e cabeçalho ───────── */}
      {snapshot && aba && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          {avisoExtra}

          {snapshot.sheets.length > 1 && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Em qual aba a medição deve ser escrita?
              </label>
              <div className="flex flex-wrap gap-2">
                {snapshot.sheets.map(s => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setSheetName(s.name);
                      setHeaderRow(suggestHeader(s).headerRow);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                      s.name === sheetName
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {s.name}
                    {s.hidden && <span className="ml-1 text-[9px] uppercase opacity-70">oculta</span>}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                As outras abas do arquivo saem na medição exatamente como estão — nada nelas é alterado.
              </p>
            </div>
          )}

          <div
            className={`rounded-xl px-4 py-3 border ${
              sugestao?.confianca === 'alta'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <p className="text-sm font-bold flex items-center gap-2">
              {sugestao?.confianca === 'alta' ? <CheckCircle2 size={16} /> : <Pencil size={16} />}
              Achei o cabeçalho na linha {headerRow}. Confere?
            </p>
            <p className="text-[11px] mt-1 leading-relaxed">
              Se estiver errado, clique em <strong>“é esta”</strong> na linha certa, abaixo. Os dados das
              turmas começam na linha seguinte ({headerRow + 1}).
            </p>
          </div>

          {avisos.length > 0 && (
            <ExportBanner tipo="aviso">
              <ul className="list-disc ml-4 space-y-0.5">
                {avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </ExportBanner>
          )}

          <LinhasDaPlanilha aba={aba} headerRow={headerRow} onEscolherCabecalho={setHeaderRow} />

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-slate-500">
              <strong>{colunas.length}</strong> coluna(s) encontrada(s) nessa linha.
            </p>
            <div className="flex items-center gap-2">
              {onCancelar && (
                <button
                  type="button"
                  onClick={onCancelar}
                  className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900"
                >
                  Cancelar
                </button>
              )}
              <button
                type="button"
                onClick={confirmar}
                disabled={colunas.length === 0 || bloqueado}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {acaoLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModeloUpload;
