/**
 * FILTROS DA MEDIÇÃO — o Site/Planta preenche o Corredor
 *
 * Vale para os módulos de medição por template (Medição Vale, BM da Vale e os
 * modelos de medição por empresa), que filtram por `corredor` e `site`.
 *
 * QUEM DECIDE O RECORTE CONTINUA SENDO O CORREDOR. Nada aqui muda a seleção
 * das turmas, a elegibilidade ou os totais: o filtro de corredor é o mesmo de
 * sempre (`filters.ts`), e o site só o PREENCHE. Quem escolhe um site está
 * dizendo em que planta trabalhou, não inventando uma regra de corte nova.
 *
 * O casamento de nome é o de `domain/locationCorridor` — a mesma função que o
 * formulário de demanda de cliente usa para a cascata Local → Corredor. Aqui
 * não há segunda leitura da tabela nem segunda regra de comparação.
 *
 * AS DECISÕES DE BORDA, que o código sozinho não explica:
 *
 *   • "Todos" no site (valor vazio) NÃO mexe no corredor. Limpar o site é
 *     alargar o recorte; mexer no corredor por causa disso seria a tela
 *     desfazendo uma escolha que a pessoa fez de propósito.
 *
 *   • Local SEM associação mantém o corredor como estava e AVISA. A
 *     alternativa — limpar o corredor — esconderia turmas sem dizer por quê.
 *
 *   • Trocar o corredor só LIMPA o site quando o cadastro diz que ele é de
 *     OUTRO corredor. Site sem associação fica: ausência de cadastro não é
 *     prova de incompatibilidade, e a demanda pode ter um local que ninguém
 *     associou ainda. Limpar nesse caso apagaria um recorte legítimo
 *     (corredor da demanda + local da demanda) por falta de cadastro.
 *
 *   • A lista de sites nunca esconde nada: com um corredor escolhido, os
 *     locais dele vêm primeiro e os demais logo abaixo, em grupo próprio.
 */
import {
  findLocationAssociation,
  localPertenceAoCorredor,
  separarLocaisPorCorredor,
  type LocationAssociationLike,
} from '../locationCorridor';

/** O par de filtros que este vínculo governa. */
export interface SiteCorredor {
  corredor: string;
  site: string;
}

/** O novo par + o que dizer à pessoa (`null` = nada a dizer). */
export interface VinculoResultado extends SiteCorredor {
  aviso: string | null;
}

export const AVISO_LOCAL_SEM_CORREDOR =
  'Este local não tem corredor associado — cadastre em Cadastros → Associações.';

export const avisoSiteLimpo = (corredor: string): string =>
  `Site limpo: não pertence ao corredor ${corredor}`;

/** Rótulo do segundo grupo do select de site. */
export const GRUPO_SEM_ASSOCIACAO = 'Sem associação a este corredor';

/**
 * A pessoa escolheu um Site/Planta.
 *   • com associação  → corredor preenchido com o do cadastro;
 *   • sem associação  → corredor como estava, mais o aviso;
 *   • "Todos" (vazio) → nada muda.
 */
export function aoEscolherSite(
  site: string,
  atual: SiteCorredor,
  associacoes: LocationAssociationLike[]
): VinculoResultado {
  if (!site) return { corredor: atual.corredor, site: '', aviso: null };
  const assoc = findLocationAssociation(site, associacoes);
  const corredor = String(assoc?.corredor ?? '').trim();
  if (!corredor) return { corredor: atual.corredor, site, aviso: AVISO_LOCAL_SEM_CORREDOR };
  return { corredor, site, aviso: null };
}

/**
 * A pessoa escolheu um Corredor. O site cai só quando o cadastro o dá a outro
 * corredor — ver as decisões de borda no cabeçalho.
 */
export function aoEscolherCorredor(
  corredor: string,
  atual: SiteCorredor,
  associacoes: LocationAssociationLike[]
): VinculoResultado {
  if (!corredor || !atual.site) return { corredor, site: atual.site, aviso: null };
  const assoc = findLocationAssociation(atual.site, associacoes);
  const doCadastro = String(assoc?.corredor ?? '').trim();
  if (!doCadastro) return { corredor, site: atual.site, aviso: null };
  if (localPertenceAoCorredor(atual.site, corredor, associacoes)) {
    return { corredor, site: atual.site, aviso: null };
  }
  return { corredor, site: '', aviso: avisoSiteLimpo(corredor) };
}

/**
 * Os sites do select, em dois grupos. `locais` são os que aparecem nas
 * demandas da carga (`buildFilterOptions().sites`), então a lista continua
 * sendo a dos locais que existem de verdade — a associação só os ORDENA.
 */
export function gruposDeSite(
  locais: string[],
  corredor: string,
  associacoes: LocationAssociationLike[]
): { associados: string[]; outros: string[] } {
  return separarLocaisPorCorredor(locais, corredor, associacoes);
}
