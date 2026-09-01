import React from 'react';

/**
 * Indicador "+N pessoas" da listagem e do cabeçalho do modal.
 *
 * UM componente para os dois vínculos que não são alocação de titular:
 * PARTICIPANTE (demanda interna, `demand_participants`) e ACOMPANHANTE
 * (demanda de cliente, `companion_allocations`). A aparência é a mesma nos
 * dois de propósito — o que diferencia é o tooltip, que nomeia o vínculo e
 * lista as pessoas.
 *
 * Por que discreto: o badge nasceu verde-sólido com ícone e ficou brigando com
 * o nome do instrutor, que é a informação principal da coluna. Aqui ele é um
 * "+N" pequeno em cinza claro — presente para quem procura, invisível para
 * quem está lendo a linha.
 *
 * Distinto, ainda assim, do badge "+N" de INSTRUTORES ALOCADOS (slate-600
 * sólido, logo acima na mesma célula): eles podem aparecer juntos na mesma
 * linha e não podem ser lidos como a mesma contagem.
 */
export interface PersonCountBadgeProps {
  /** Quantas pessoas o vínculo tem. Nada é renderizado quando é 0. */
  count: number;
  /** Tooltip completo — inclui o rótulo do vínculo e os nomes. */
  title: string;
  className?: string;
}

const PersonCountBadge: React.FC<PersonCountBadgeProps> = ({ count, title, className = '' }) => {
  if (!count) return null;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 w-fit ${className}`}
      title={title}
    >
      +{count}
    </span>
  );
};

export default PersonCountBadge;
