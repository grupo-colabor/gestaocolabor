/**
 * PERMISSÕES DE AÇÃO SOBRE A DEMANDA — fonte única
 *
 * Move a tabela que vivia dentro de `components/Demands.tsx` para que o
 * formulário de demanda interna use exatamente o MESMO guard, e não uma cópia.
 * Duas tabelas de permissão em arquivos diferentes divergem na primeira vez que
 * alguém mexe só numa delas — e o sintoma seria um perfil conseguindo editar
 * numa tela o que não consegue na outra.
 *
 * ⚠️ Não confundir com o `ROLE_PERMISSIONS` do App.tsx, que controla QUAIS VIEWS
 * cada perfil enxerga. Este aqui é o nível de baixo: dado que o perfil já está
 * na tela, o que ele pode fazer com a demanda.
 */

export type DemandAction =
  | 'create_demand'
  | 'edit_demand'
  | 'delete_demand'
  | 'cancel_demand';

const DEMAND_ROLE_ACTIONS: Record<string, DemandAction[]> = {
  admin: ['create_demand', 'edit_demand', 'delete_demand', 'cancel_demand'],
  analista: ['create_demand', 'edit_demand', 'delete_demand', 'cancel_demand'],
  coordenador: [],
};

export const canPerformDemandAction = (
  role: string | undefined,
  action: DemandAction
) => {
  if (!role) return false;
  return DEMAND_ROLE_ACTIONS[role]?.includes(action);
};
