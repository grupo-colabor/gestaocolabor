import React from 'react';

/**
 * MINI-CARD DE RESUMO DE DESPESA — casca visual compartilhada
 *
 * Nasceu no topo do modal do Painel de Medição (a fileira Hospedagem /
 * Locomoção / Alimentação / Outros / Total Geral) e passou a ser reusada pelo
 * card "Custo das Demandas Internas" do Dashboard (aba INTERNAS), que mostra
 * as MESMAS quatro categorias mais a Hora/Aula. Extraído em vez de duplicado
 * justamente porque são as mesmas categorias: se a paleta ou a tipografia
 * mudar num lugar, tem de mudar nos dois.
 *
 * É casca pura — não sabe formatar moeda nem de onde vem o número. Os dois
 * call sites têm `formatCurrency` próprios e ligeiramente diferentes (o do
 * painel tolera string e NaN), então o valor chega aqui JÁ FORMATADO. Isso
 * mantém a extração sem risco: nada do comportamento do painel muda.
 */
export interface ExpenseSummaryCardProps {
  /** Rótulo curto, renderizado em uppercase. */
  label: string;
  /** Valor já formatado pelo call site (ex.: `formatCurrency(x)`). */
  value: React.ReactNode;
  /** Ícone lucide (o componente, não o elemento). */
  icon: any;
  /**
   * Classe do texto do valor — é onde vive a cor por categoria. O "Total
   * Geral" do painel passa cor + fundo juntos aqui (`text-slate-900
   * bg-slate-200/50`); preservado como estava.
   */
  colorClass?: string;
  /**
   * Superfície do mini-card. Padrão `bg-white`, que é o do painel (o corpo do
   * modal é slate-50). No Dashboard os mini-cards ficam DENTRO de um card
   * branco, então lá se passa `bg-slate-50` — mesma casca, fundo invertido,
   * para cada um continuar se destacando do seu próprio chão.
   */
  surfaceClass?: string;
  /** Extras de grid (ex.: `col-span-2`). */
  className?: string;
}

export const ExpenseSummaryCard: React.FC<ExpenseSummaryCardProps> = ({
  label,
  value,
  icon: Icon,
  colorClass = 'text-slate-900',
  surfaceClass = 'bg-white',
  className = '',
}) => (
  /* `min-w-0` porque item de grid nasce com `min-width:auto` e estouraria a
     coluna em vez de deixar o texto quebrar quando a tela aperta. */
  <div className={`p-4 ${surfaceClass} rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center min-w-0 ${className}`}>
    <div className="flex items-center gap-1.5 mb-1 min-w-0">
      <Icon size={12} className="text-slate-400 shrink-0" />
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">{label}</span>
    </div>
    <span className={`text-sm font-black ${colorClass}`}>{value}</span>
  </div>
);

export default ExpenseSummaryCard;
