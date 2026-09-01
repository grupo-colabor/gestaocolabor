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
import { computeInstructorHoursByDemand, effectiveDemandHours } from '../domain/instructorHours';
import { applyMeasurementOverrides } from '../domain/measurementOverrides';
import { fetchDemandParticipants } from './demandParticipants';
import { fetchCompanionAllocations } from './companionAllocations';
import { isNightDemand } from '../domain/demandDays';
import { getDemandCategoria, isInternalDemand } from '../domain/demandLabel';
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
    // Demanda interna: carga horária em horasPrevistas (consumida por
    // computeInstructorHoursByDemand) e identificação por categoria +
    // descrição, que alimentam as colunas Treinamento e Categoria da planilha.
    tipo: (row.tipo ?? 'cliente') as 'cliente' | 'interna',
    categoriaInterna: row.categoria_interna ?? null,
    horasPrevistas: row.horas_previstas ?? null,
    descricaoInterna: row.descricao_interna ?? null,
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
  const [
    demandRows, allocationRows, measurementRows, trainingRows, instructorRows,
    companyRows, participantRows, companionRows,
  ] =
    await Promise.all([
      fetchDemands(),
      fetchInstructorAllocations(),
      fetchMeasurements(),
      fetchTrainings(),
      fetchInstructors(),
      fetchCompanies(),
      // Participantes de demanda interna: sem eles, a linha inserida pelo bloco
      // da medição sairia com os dias da demanda inteira mesmo quando a pessoa
      // participou só de parte.
      fetchDemandParticipants(),
      // Acompanhantes de demanda de cliente (F3). Uma linha POR DIA: são elas
      // que dão os dias dele e, com isso, a proporção de horas.
      fetchCompanionAllocations(),
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
  const hoursRowsDoRateio = computeInstructorHoursByDemand({
    demands,
    instructorAllocations,
    trainings,
    measurements,
    periodStart: dataInicio,
    periodEnd: dataFim,
  });

  // Índices usados dos dois lados do override (a carga da demanda) e da
  // montagem das linhas — declarados aqui em cima porque o override vem antes.
  const demandsById = new Map(demands.map(d => [d.id, d]));
  const trainingsById = buildTrainingsById(trainings);
  const measurementByDemandId = new Map(measurements.map(m => [m.demandId, m]));

  /**
   * Medição multi-pessoa: os blocos são OVERRIDE por pessoa, nunca soma.
   *
   * O rateio acima continua sendo a fonte única de horas — cinco leitores
   * dependem dele além desta planilha. O que muda aqui é só o recorte final:
   * bloco com `horas` informadas SUBSTITUI a hora daquela pessoa (os dias
   * seguem do rateio), e bloco de quem não tem linha de rateio — o participante
   * de interna — ENTRA como linha nova. Sem isso o participante continuaria
   * valendo zero na planilha, que é justamente o que a F2 resolve.
   *
   * Medição sem `participantes` não altera nada: toda demanda de cliente sai
   * exatamente como saía. Regra e tabela de precedência em
   * domain/measurementOverrides.ts.
   */
  const hoursRows = applyMeasurementOverrides({
    rows: hoursRowsDoRateio,
    measurements: measurements.map(m => ({ ...m, demandId: m.demandId })) as any,
    demands: demands as any,
    participants: (participantRows ?? []).map(p => ({
      demandId: p.demand_id,
      instructorId: p.instructor_id,
      startDate: p.start_date,
      endDate: p.end_date,
    })),
    companions: (companionRows ?? []).map(c => ({
      demandId: c.demand_id,
      instructorId: c.instructor_id,
      startDate: c.start_date,
    })),
    // A carga da demanda para o default proporcional do acompanhante sai da
    // MESMA função que o rateio usa (classHours > horasPrevistas > prática >
    // treinamento). Recalcular a carga aqui criaria a segunda definição dela.
    demandHours: (demandId: string) => {
      const d = demandsById.get(demandId);
      return d ? effectiveDemandHours(d, trainingsById, measurementByDemandId) : 0;
    },
    periodStart: dataInicio,
    periodEnd: dataFim,
  });

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
      // Interna sem empresa cai em '(sem empresa)' pelo nomeEmpresa; com
      // empresa vinculada usa o nome dela, igual a uma demanda de cliente.
      empresa: nomeEmpresa(demand.companyId),
      // Interna não tem treinamento: a coluna passa a mostrar a descrição, que
      // é o que identifica a demanda para quem confere o pagamento.
      trainingName: isInternalDemand(demand)
        ? ((demand.descricaoInterna || '').trim() || '—')
        : (trainingNameById.get(String(demand.trainingId)) ?? '—'),
      categoria: getDemandCategoria(demand),
      // CHAVES DE TARIFA. Interna vale menos que treinamento e hora noturna
      // vale mais, então a tarifa é por (instrutor, empresa, tipo, noturno).
      // A regra do noturno é a do domínio (fim >= 19:00 ou vira o dia) — a
      // mesma que marca (N) na agenda; nunca reimplementar aqui.
      tipo: isInternalDemand(demand) ? 'Interna' : 'Treinamento',
      noturno: isNightDemand(demand),
      // 5ª chave (D4): só ACOMPANHANTE se separa. Linha sem papel — todas as
      // do rateio — é 'Titular', que é o que mantém a planilha de hoje
      // batendo com a aba Tarifas de hoje.
      papel: row.papel === 'ACOMPANHANTE' ? 'Acompanhante' : 'Titular',
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
