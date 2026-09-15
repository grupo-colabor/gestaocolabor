import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

/**
 * Banner de erro/aviso da aba. Erro de carga é BLOQUEANTE: a mensagem vem do
 * banco (ou do fetch) e os botões de download ficam desabilitados enquanto
 * ele estiver na tela. Nunca "0 linhas" no lugar de um erro.
 */
const ExportBanner: React.FC<{ tipo: 'erro' | 'aviso'; children: React.ReactNode }> = ({ tipo, children }) => {
  const erro = tipo === 'erro';
  return (
    <div
      role={erro ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        erro ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'
      }`}
    >
      {erro ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <Info size={18} className="mt-0.5 shrink-0" />}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
};

export default ExportBanner;
