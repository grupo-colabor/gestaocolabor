/**
 * PESSOAS DE UMA DEMANDA PARA A MEDIÇÃO — leitura pura, fonte única
 *
 * A lista de quem recebe pagamento numa demanda vem do CADASTRO, nunca do JSON
 * da medição — senão alguém adicionado depois do primeiro save nunca
 * apareceria. A regra já existia dentro de `components/Measurement.tsx`
 * (`pessoasDaMedicao`), com um gate deliberado: lá a lista sai VAZIA quando não
 * há uma segunda categoria de pessoa (interna sem participante, cliente sem
 * acompanhante), para o painel dessas demandas continuar idêntico ao de antes.
 *
 * O motor de Exportações precisa da lista SEMPRE — inclusive titular único e
 * cliente dividido por dias (um titular por trecho do rateio). Por isso esta
 * função existe separada, e sem o gate. `Measurement.tsx` continua com a sua
 * cópia na F1; unificar as duas é trabalho de outra leva.
 *
 * Regras preservadas da tela:
 *   • TITULARES vêm de `resolveDemandInstructors` (linhas de
 *     instructor_allocations, com fallback para demands.instructor_id) —
 *     distintos, na ordem de início da alocação;
 *   • interna  → titulares + PARTICIPANTES (`demand_participants`) que não
 *     coincidam com um titular (dado torto não vira duas seções nem dois
 *     pagamentos);
 *   • cliente  → titulares + ACOMPANHANTES distintos de `companion_allocations`
 *     (UMA LINHA POR DIA lá; aqui é gente, não dia), excluindo quem já é
 *     titular na mesma demanda.
 *
 * Sem import de React, Supabase ou ExcelJS: roda no smoke em Node.
 */
import { resolveDemandInstructors, type InstructorAllocationLike } from './demandInstructors';
import type { MeasurementRole } from './measurementTotals';

export interface PeopleDemandLike {
  id: string;
  tipo?: 'cliente' | 'interna' | string | null;
  instructorId?: string | null;
}

export interface ParticipantLike {
  demandId: string;
  instructorId: string;
}

export interface CompanionLike {
  demandId: string;
  instructorId: string;
}

export interface MeasurementPerson {
  instructorId: string;
  papel: MeasurementRole;
  /** De onde veio o vínculo — informativo, para a coluna Origem do export. */
  vinculo: 'alocacao' | 'principal' | 'participante' | 'acompanhante';
}

export function resolveMeasurementPeople(
  demand: PeopleDemandLike,
  instructorAllocations: InstructorAllocationLike[],
  participants: ParticipantLike[],
  companions: CompanionLike[]
): MeasurementPerson[] {
  const lista: MeasurementPerson[] = [];
  const vistos = new Set<string>();

  for (const t of resolveDemandInstructors(demand.id, demand.instructorId ?? undefined, instructorAllocations)) {
    if (!t.instructorId || vistos.has(t.instructorId)) continue;
    vistos.add(t.instructorId);
    lista.push({
      instructorId: t.instructorId,
      papel: 'TITULAR',
      vinculo: t.source === 'allocation' ? 'alocacao' : 'principal',
    });
  }

  if (demand.tipo === 'interna') {
    for (const p of participants) {
      if (p.demandId !== demand.id || !p.instructorId || vistos.has(p.instructorId)) continue;
      vistos.add(p.instructorId);
      lista.push({ instructorId: p.instructorId, papel: 'PARTICIPANTE', vinculo: 'participante' });
    }
    return lista;
  }

  for (const c of companions) {
    if (c.demandId !== demand.id || !c.instructorId || vistos.has(c.instructorId)) continue;
    vistos.add(c.instructorId);
    lista.push({ instructorId: c.instructorId, papel: 'ACOMPANHANTE', vinculo: 'acompanhante' });
  }
  return lista;
}
