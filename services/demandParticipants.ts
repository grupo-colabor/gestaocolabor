/**
 * PARTICIPANTES DE DEMANDA INTERNA
 *
 * Participante = instrutor do cadastro vinculado a uma demanda INTERNA como
 * titular pleno, no mesmo nível do instrutor principal. Não é acompanhante de
 * ninguém. Motivação: a equipe vinha clonando uma interna por pessoa (5
 * demandas para uma mesma reunião) porque a interna comporta um instrutor só.
 *
 * ⚠️ ESTE MÓDULO NÃO FALA COM `instructor_allocations`, DE PROPÓSITO.
 * Aquela tabela modela DIVISÃO de dias, e os dois comportamentos dela são
 * errados aqui:
 *   • `addInstructorAllocation` faz split destrutivo — o novo alocado APAGA
 *     os dias de quem já estava. Participantes ficam todos nos mesmos dias,
 *     então cada um apagaria o anterior.
 *   • `computeInstructorHoursByDemand` rateia a carga por
 *     (dias do instrutor / união dos dias alocados) — duas pessoas no mesmo
 *     período de uma interna de 16h dariam 16h CADA.
 * O pagamento do participante virá dos blocos da medição (F2), nunca daqui.
 * `smoke:participantes` tem uma guarda de fonte que falha se alguém importar
 * `instructorAllocations` neste arquivo.
 *
 * PERÍODO: `start_date`/`end_date` são `date` (dia inteiro) e são
 * TUDO-OU-NADA — os dois nulos = participa do período inteiro da demanda; os
 * dois preenchidos = recorte próprio. O CHECK
 * `demand_participants_periodo_check` (migration 016) recusa meio período; o
 * formulário valida antes para o erro chegar amigável.
 *
 * `tipo` NÃO é enviado pelo app: a coluna tem DEFAULT 'interna' e compõe a FK
 * `(demand_id, tipo) -> demands (id, tipo)`, que é quem garante, no banco, que
 * participante só existe em demanda interna.
 */
import { supabase } from '../lib/supabase';
import { fetchAllPaginated } from './pagination';

export type DemandParticipantRow = {
  id: string;
  demand_id: string;
  /** Sempre 'interna' — discriminador da FK composta. Escrito pelo DEFAULT. */
  tipo?: string;
  instructor_id: string;
  /** 'YYYY-MM-DD' ou null. Null nos dois = período inteiro da demanda. */
  start_date: string | null;
  end_date: string | null;
  created_at?: string;
  updated_at?: string;
};

/** O que o app envia num insert — o resto vem de DEFAULT no banco. */
export type NewDemandParticipant = {
  demand_id: string;
  instructor_id: string;
  start_date?: string | null;
  end_date?: string | null;
};

const SELECT_FIELDS = 'id, demand_id, tipo, instructor_id, start_date, end_date, created_at, updated_at';

/**
 * Busca todos os participantes.
 *
 * Pagina via `fetchAllPaginated`: select() sem .range() é cortado
 * silenciosamente em ~1000 linhas pelo PostgREST/Supabase — sem erro e sem
 * aviso. Um participante faltando aqui some da agenda e da checagem de
 * conflito, que é o tipo de falha que ninguém percebe até dar choque de
 * agenda. `.order('id')` é o que torna a paginação estável entre páginas.
 *
 * Erro PROPAGA (não devolve lista vazia): leitura silenciosamente parcial é
 * pior que tela quebrada — ver o mesmo endurecimento em resourceAllocations.
 */
export async function fetchDemandParticipants(): Promise<DemandParticipantRow[]> {
  return fetchAllPaginated<DemandParticipantRow>((from, to) =>
    supabase
      .from('demand_participants')
      .select(SELECT_FIELDS)
      .order('id', { ascending: true })
      .range(from, to)
  );
}

/**
 * Cria um participante. O `id` vem do banco (uuid com DEFAULT
 * gen_random_uuid()) — o chamador NÃO inventa id, ao contrário de
 * `instructor_allocations`, cujo `ALOC-${Date.now()}` já precisou de gambiarra
 * para não colidir dentro do mesmo milissegundo.
 *
 * Erros que valem tradução para quem está na tela:
 *   • 23505 (unique_violation)  -> já é participante desta demanda;
 *   • 23503 (foreign_key)       -> demanda não é interna, ou instrutor sumiu;
 *   • 23514 (check_violation)   -> período pela metade.
 * A mensagem crua do Postgres não diz nada disso para o usuário, então quem
 * chama recebe um Error com texto legível — mas o erro original vai junto em
 * `cause`, para o console continuar útil.
 */
export async function insertDemandParticipant(
  payload: NewDemandParticipant
): Promise<DemandParticipantRow> {
  const { data, error } = await supabase
    .from('demand_participants')
    .insert({
      demand_id: payload.demand_id,
      instructor_id: payload.instructor_id,
      start_date: payload.start_date ?? null,
      end_date: payload.end_date ?? null,
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    console.error('[demand_participants] insert error', error);
    throw new Error(describeWriteError(error), { cause: error });
  }

  if (!data) {
    // insert().select().single() sem erro e sem linha = RLS filtrou o retorno.
    throw new Error(
      'Participante não foi gravado (nenhuma linha retornada) — verifique permissões (RLS).'
    );
  }

  return data as DemandParticipantRow;
}

/**
 * Remove um participante.
 *
 * ENDURECIDO com "throw se 0 linhas": diferente de um delete por `demand_id`
 * (onde zero é estado legítimo), aqui o id veio de uma linha que a tela acabou
 * de listar. Zero linhas significa RLS bloqueando ou linha já removida por
 * outra sessão — nos dois casos a UI não pode dizer "removido" e seguir, senão
 * o participante reaparece no próximo reload. Mesmo padrão de
 * `deleteCompanionAllocationById`.
 */
export async function deleteDemandParticipantById(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('demand_participants')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[demand_participants] delete error', error);
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      'Nenhuma linha excluída (demand_participants) — verifique permissões (RLS).'
    );
  }
}

/** Traduz os códigos de erro do Postgres que esta tabela pode devolver. */
function describeWriteError(error: { code?: string; message?: string }): string {
  switch (error?.code) {
    case '23505':
      return 'Este instrutor já é participante desta demanda.';
    case '23503':
      return 'Não foi possível vincular: participante só existe em demanda interna, e o instrutor precisa estar no cadastro.';
    case '23514':
      return 'Período do participante inválido: preencha início e fim juntos (ou deixe os dois vazios para o período todo da demanda).';
    default:
      return `Erro ao salvar participante: ${error?.message ?? 'causa desconhecida'}`;
  }
}

/**
 * Recorta (ou limpa) o período próprio de um participante.
 *
 * `null` nos dois é um estado VÁLIDO e significativo: "participa da demanda
 * inteira". É para lá que volta o participante cujo período ficou inteiramente
 * fora do novo período da demanda — período vazio é inválido (o CHECK exige
 * start <= end) e apagar a pessoa seria decidir por ela.
 */
export async function updateDemandParticipantPeriod(
  id: string,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from('demand_participants')
    .update({ start_date: startDate, end_date: endDate, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Nenhuma linha atualizada (demand_participants) — verifique permissões (RLS).');
  }
}
