/**
 * EXPORTAÇÃO DE MEDIÇÃO DE INSTRUTORES (.xlsx) — camada de I/O
 *
 * Busca os dados no Supabase, converte para o domínio, delega a montagem da
 * planilha a `medicaoWorkbook.ts` (camada pura) e dispara o download.
 *
 * As horas vêm de `computeInstructorHoursByDemand` (domain/instructorHours.ts)
 * — a mesma fonte do Dashboard, que rateia a carga pelos dias reais de cada
 * instrutor e usa `training.practical_hours` em demandas HÍBRIDAS (migration
 * 006). Nada de cálculo de horas é reimplementado aqui.
 *
 * Escopo do período: só demandas CONCLUÍDAS, com as horas recortadas pelos
 * dias que caem dentro do intervalo (inclusivo nas duas pontas) — uma demanda
 * que atravessa qualquer uma das bordas entra proporcionalmente aos dias que
 * ficam dentro. Mês fechado e ciclo personalizado são o MESMO caminho de
 * cálculo: o modo mês só resolve (ano, mês) para (primeiro dia, último dia)
 * antes de chamar.
 */
import { fetchCompanies } from './companies';
import { fetchDemands } from './demands';
import { fetchInstructorAllocations } from './instructorAllocations';
import { fetchMeasurements } from './measurements';
import { fetchTrainings } from './trainings';
import { fetchInstructors } from './instructors';
import { computeInstructorHoursByDemand } from '../domain/instructorHours';
import {
  buildTrainingsById,
  getModalityLabel,
  resolveDemandModality,
} from '../domain/modalityOptions';
import { formatCPF } from '../utils/cpf';
import {
  buildMedicaoWorkbook,
  formatDias,
  resolvePeriodo,
  type MedicaoInstructorBlock,
  type MedicaoPeriodo,
} from './medicaoWorkbook';
import type {
  Demand,
  DemandStatus,
  Instructor,
  InstructorAllocation,
  Measurement,
  Training,
} from '../types';

// Reexporta a API pura para quem consome o export (a UI importa de um lugar só).
export {
  buildMedicaoWorkbook,
  countDaysInclusive,
  formatDias,
  monthBounds,
  resolvePeriodo,
  sanitizeSheetName,
} from './medicaoWorkbook';
export type {
  MedicaoDetailRow,
  MedicaoInstructorBlock,
  MedicaoPeriodo,
  MedicaoPeriodoResolvido,
} from './medicaoWorkbook';

export type MedicaoExportResult =
  | { status: 'OK'; fileName: string; periodoLabel: string; instrutores: number; linhas: number }
  | { status: 'VAZIO'; periodoLabel: string };

/* ========================================================================== */
/* Mapeamento DB -> domínio                                                   */
/* ========================================================================== */
/* Espelha os mappers do App.tsx, restrito aos campos usados pelo cálculo de
 * horas e pelas colunas da planilha. O export não lê o contexto do React de
 * propósito: busca do banco na hora, para não depender de estado stale. */

function mapSpecificDates(raw: any): Demand['specificDates'] {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? safeParseArray(raw) : null;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  return arr.map((sd: any) => {
    if (typeof sd === 'string') {
      // Coluna text[]: pode guardar o objeto serializado ou a data pura.
      const parsed = safeParseObject(sd);
      if (parsed?.data) {
        return {
          data: String(parsed.data).slice(0, 10),
          horarioInicio: parsed.horarioInicio ?? '08:00',
          horarioFim: parsed.horarioFim ?? '18:00',
        };
      }
      return { data: sd.slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
    }
    if (sd && typeof sd === 'object') {
      return {
        data: String(sd.data ?? '').slice(0, 10),
        horarioInicio: sd.horarioInicio ?? '08:00',
        horarioFim: sd.horarioFim ?? '18:00',
      };
    }
    return { data: String(sd).slice(0, 10), horarioInicio: '08:00', horarioFim: '18:00' };
  });
}

function safeParseArray(raw: string): any[] | null {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeParseObject(raw: string): any | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapDemand(row: any): Demand {
  return {
    id: row.id,
    // Demanda interna: sem empresa/treinamento, carga horária em horasPrevistas.
    // Os 3 campos entram aqui já nesta fase só para ficarem disponíveis ao
    // cálculo de horas e ao workbook (fases 4-5); nada abaixo os consome ainda.
    tipo: (row.tipo ?? 'cliente') as 'cliente' | 'interna',
    categoriaInterna: row.categoria_interna ?? null,
    horasPrevistas: row.horas_previstas ?? null,
    companyId: row.company_id ?? '',
    trainingId: row.training_id ?? '',
    regionId: row.region_id ?? '',
    trainingLocal: row.training_local ?? '',
    demandState: row.demand_state ?? undefined,
    modality: row.modality ?? 'PRESENCIAL',
    dateMode: row.date_mode ?? 'CONTINUO',
    specificDates: mapSpecificDates(row.specific_dates),
    status: (row.status ?? 'NOVA') as DemandStatus,
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    practiceStartDate: row.practice_start_date ?? undefined,
    practiceEndDate: row.practice_end_date ?? undefined,
    instructorId: row.instructor_id ?? undefined,
  } as Demand;
}

function mapTraining(row: any): Training {
  return {
    id: row.id,
    name: row.name ?? '',
    hours: row.hours ?? 0,
    practicalHours: row.practical_hours ?? null,
    modality: row.modality ?? 'PRESENCIAL',
    status: row.status ?? 'ATIVO',
  } as Training;
}

function mapMeasurement(row: any): Measurement {
  return {
    id: row.id,
    demandId: row.demand_id,
    status: row.status,
    expenses: { ...(row.expenses ?? {}) },
    attachments: row.attachments ?? [],
    otherExpenses: row.other_expenses ?? [],
    updatedAt: row.updated_at ?? row.created_at ?? '',
  } as Measurement;
}

function mapInstructor(row: any): Pick<Instructor, 'id' | 'name' | 'cpf'> {
  return {
    id: row.id,
    name: row.full_name ?? '(sem nome)',
    cpf: row.cpf ?? undefined,
  };
}

function mapAllocation(row: any): InstructorAllocation {
  return {
    id: row.id,
    demandId: row.demand_id,
    instructorId: row.instructor_id,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}


/* ========================================================================== */
/* Busca + montagem dos dados                                                 */
/* ========================================================================== */

/**
 * Busca tudo que a medição do período precisa e devolve um bloco por instrutor
 * com alocação dentro dele (ordenado por nome).
 *
 * `dataInicio`/`dataFim` são 'YYYY-MM-DD' e INCLUSIVOS nas duas pontas. Quem
 * escolheu mês fechado já chega aqui com o par resolvido por `resolvePeriodo`
 * — não existe branch por modo daqui pra baixo.
 *
 * Toda a busca passa pelos services existentes, que paginam via
 * `fetchAllPaginated` (.range() em lote de 1000 até esgotar) e propagam erro
 * — `demands`, `instructor_allocations` e `measurements` já estouram ou estão
 * perto de estourar o corte silencioso de 1000 linhas do PostgREST.
 */
export async function fetchMedicaoData(dataInicio: string, dataFim: string): Promise<MedicaoInstructorBlock[]> {
  const [demandRows, allocationRows, measurementRows, trainingRows, instructorRows, companyRows] = await Promise.all([
    fetchDemands(),
    fetchInstructorAllocations(),
    fetchMeasurements(),
    fetchTrainings(),
    fetchInstructors(),
    fetchCompanies(),
  ]);

  const demands = (demandRows ?? []).map(mapDemand);
  const instructorAllocations = (allocationRows ?? []).map(mapAllocation);
  const measurements = (measurementRows ?? []).map(mapMeasurement);
  const trainings = (trainingRows ?? []).map(mapTraining);
  const instructors = (instructorRows ?? []).map(mapInstructor);

  // O critério de inclusão da demanda não muda com o período: continua sendo
  // só demanda CONCLUÍDA (regra do próprio computeInstructorHoursByDemand). O
  // que o período faz é recortar os DIAS — simétrico nas duas bordas, então
  // demanda que começou antes de dataInicio conta só os dias de dataInicio em
  // diante, igual ao que já valia na virada de mês.
  const hoursRows = computeInstructorHoursByDemand({
    demands,
    instructorAllocations,
    trainings,
    measurements,
    periodStart: dataInicio,
    periodEnd: dataFim,
  });

  const demandsById = new Map(demands.map(d => [d.id, d]));
  const trainingsById = buildTrainingsById(trainings);
  const trainingNameById = new Map(trainings.map(t => [String(t.id), t.name]));
  const instructorsById = new Map(instructors.map(i => [i.id, i]));

  // Empresa vem do cadastro (companies.name, via demands.company_id) — nunca
  // de texto digitado. Isso é o que garante grafia idêntica entre a coluna
  // Empresa da aba de detalhe e a aba Tarifas, de onde o SUMIFS puxa o valor.
  const companyNameById = new Map(
    (companyRows ?? []).map(c => [c.id, (c.name || c.razao_social || '').trim()])
  );

  /**
   * Os dois casos ruins ficam VISÍVEIS na planilha em vez de virarem uma
   * empresa em branco: demanda sem cliente vinculado é uma coisa, cadastro de
   * empresa que não veio na busca é outra (e essa segunda é sintoma de bug,
   * não de dado faltando).
   */
  const nomeEmpresa = (companyId?: string | null): string => {
    if (!companyId) return '(sem empresa)';
    const nome = companyNameById.get(companyId);
    if (!nome) return '(empresa não encontrada)';
    return nome;
  };

  const blocks = new Map<string, MedicaoInstructorBlock>();

  for (const row of hoursRows) {
    const demand = demandsById.get(row.demandId);
    if (!demand) continue;

    let block = blocks.get(row.instructorId);
    if (!block) {
      const instructor = instructorsById.get(row.instructorId);
      block = {
        instructorId: row.instructorId,
        nome: instructor?.name ?? `Instrutor ${row.instructorId}`,
        cpf: instructor?.cpf ? formatCPF(instructor.cpf) : '',
        linhas: [],
      };
      blocks.set(row.instructorId, block);
    }

    const local = [demand.trainingLocal, demand.demandState].filter(Boolean).join(' - ');

    block.linhas.push({
      demandId: demand.id,
      empresa: nomeEmpresa(demand.companyId),
      trainingName: trainingNameById.get(String(demand.trainingId)) ?? '—',
      dias: row.dias,
      local: local || '—',
      modalidade: getModalityLabel(resolveDemandModality(demand, trainingsById)),
      // 2 casas: mesmo arredondamento do export do Dashboard, evita ruído de float.
      horas: Math.round((row.horas + Number.EPSILON) * 100) / 100,
    });
  }

  const result = [...blocks.values()];
  for (const block of result) {
    block.linhas.sort((a, b) => (a.dias[0] ?? '').localeCompare(b.dias[0] ?? '') || a.demandId.localeCompare(b.demandId));
  }
  result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return result;
}


function triggerDownload(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Ponta a ponta: resolve o período, busca, monta o workbook e dispara o
 * download. Período sem nenhuma alocação devolve `{ status: 'VAZIO' }` e NÃO
 * gera arquivo. Falha de busca propaga o erro (nada de array vazio silencioso).
 */
export async function exportMedicao(periodo: MedicaoPeriodo): Promise<MedicaoExportResult> {
  const resolvido = resolvePeriodo(periodo);

  const blocks = await fetchMedicaoData(resolvido.dataInicio, resolvido.dataFim);
  if (blocks.length === 0) return { status: 'VAZIO', periodoLabel: resolvido.label };

  const workbook = await buildMedicaoWorkbook(blocks, resolvido);
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

  triggerDownload(buffer, resolvido.fileName);

  return {
    status: 'OK',
    fileName: resolvido.fileName,
    periodoLabel: resolvido.label,
    instrutores: blocks.length,
    linhas: blocks.reduce((acc, b) => acc + b.linhas.length, 0),
  };
}
