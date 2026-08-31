/**
 * HELPER CENTRAL — Data + hora de INÍCIO/FIM da demanda
 *
 * Fonte única de verdade para converter os inputs `type=date` + `type=time` do
 * form de demanda no valor que vai para `demands.start_date` / `demands.end_date`
 * — e de volta, ao reabrir o registro.
 *
 * ┌─ POR QUE ISTO EXISTE ────────────────────────────────────────────────────┐
 * │ `start_date`/`end_date` são `timestamptz` no Postgres, mas o app grava    │
 * │ ali um HORÁRIO DE PAREDE (wall clock): a string naive "YYYY-MM-DDTHH:mm" │
 * │ que o usuário digitou. O Postgres a resolve no fuso da sessão (UTC), e o  │
 * │ PostgREST devolve "YYYY-MM-DDTHH:mm:00+00:00" — mesma parede, sufixo de   │
 * │ fuso a mais. Todo o domínio (isNightDemand, getDayHorarioInicio,          │
 * │ getDemandDays, formatDateTime, medição) lê ESSA PAREDE por fatia de       │
 * │ string, nunca por instante.                                              │
 * │                                                                          │
 * │ Logo: passar start_date/end_date por `new Date()` + getHours()/getDate()  │
 * │ reinterpreta a parede como instante UTC e desloca −3h em                 │
 * │ America/Sao_Paulo. Foi exatamente esse o bug do form de demanda interna   │
 * │ (08:00 digitado virava 05:00 ao reabrir, e o re-save gravava o 05:00).    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * REGRA: para início/fim de demanda, converta SÓ por string. `Date` aqui é
 * apenas fallback para formatos legados que não casam com o shape ISO.
 *
 * ⚠️ NÃO use `isoToLocalDTL` (seção "LOGÍSTICA", no fim deste arquivo) em
 * start_date/end_date. Aquilo é para colunas que guardam INSTANTE de verdade.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

const pad2 = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_START_TIME = '08:00';
export const DEFAULT_END_TIME = '18:00';

/**
 * Valor gravado (naive ou ISO com offset) → "YYYY-MM-DD" para o input `type=date`.
 * Devolve o DIA QUE O USUÁRIO DIGITOU, sem reinterpretar fuso — é isso que faz
 * a borda de meia-noite (fim 02:00 do dia seguinte) não voltar um dia.
 */
export const toDemandDateInput = (v?: string | null): string => {
  const s = (v ?? '').trim();
  if (!s) return '';

  if (DATE_ONLY_RE.test(s)) return s;

  const m = DATE_TIME_RE.exec(s);
  if (m) return m[1];

  // Fallback: formato legado/estranho — aí sim tenta Date, em horário local.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.includes('T') ? s.split('T')[0] : '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Valor gravado → "HH:mm" para o input `type=time`. */
export const toDemandTimeInput = (v?: string | null): string => {
  const s = (v ?? '').trim();
  if (!s) return '';

  const m = DATE_TIME_RE.exec(s);
  if (m) return m[2];

  // "YYYY-MM-DD" não tem hora: devolver '' deixa o form aplicar o default.
  // Cair no new Date() aqui parseava a data como UTC e devolvia 21:00.
  if (DATE_ONLY_RE.test(s)) return '';

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Inputs date + time → "YYYY-MM-DDTHH:mm" (o valor que vai para o banco). */
export const buildDemandDateTime = (
  date?: string | null,
  time?: string | null,
  fallbackTime: string = DEFAULT_START_TIME
): string => {
  const d = (date ?? '').trim();
  if (!d) return '';
  const t = (time ?? '').trim() || fallbackTime;
  return `${d}T${t}`;
};

/**
 * Valor gravado → "YYYY-MM-DDTHH:mm" para reabrir o form.
 *
 * É o round-trip completo: o que entrou pelo `buildDemandDateTime` volta
 * idêntico, tenha o banco devolvido com ou sem sufixo de fuso.
 */
export const toDemandDateTimeInput = (
  v?: string | null,
  fallbackTime: string = DEFAULT_START_TIME
): string => {
  const date = toDemandDateInput(v);
  if (!date) return '';
  return buildDemandDateTime(date, toDemandTimeInput(v), fallbackTime);
};

/* ────────────────────────────── LOGÍSTICA ───────────────────────────────────
 * Colunas de logística (`rental_check_in`, `hotel_check_in`, …) guardam
 * INSTANTE — são gravadas com toISOString() e lidas de volta em horário local.
 * O par abaixo é simétrico, então o round-trip fecha. Só existe aqui para não
 * ficarem duas cópias (Demands.tsx e InternalDemands.tsx) divergindo.
 * ────────────────────────────────────────────────────────────────────────── */

/** ISO (instante) → "YYYY-MM-DDTHH:mm" local, para input datetime-local. */
export const isoToLocalDTL = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Extrai "YYYY-MM-DD" de qualquer string ISO, sem conversão de fuso. */
export const isoToDateOnly = (iso?: string | null): string => {
  const s = (iso ?? '').trim();
  if (!s) return '';
  if (DATE_ONLY_RE.test(s)) return s;
  return s.includes('T') ? s.split('T')[0] : '';
};

/** "YYYY-MM-DDTHH:mm" local → ISO (instante) para coluna timestamptz. */
export const toIsoFromDateTimeLocalSafe = (dt?: string | null): string | null => {
  const s = (dt ?? '').trim();
  if (!s) return null;
  if (!DATE_TIME_RE.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * "YYYY-MM-DD" → ISO (instante) para coluna timestamptz.
 * Ancorado ao MEIO-DIA local: em 00:00 o offset joga a data ISO para o dia
 * anterior em fusos a leste de Greenwich, e a leitura (isoToDateOnly, por fatia)
 * devolveria o dia errado.
 */
export const toIsoFromDateInputSafe = (dateStr?: string | null): string | null => {
  const s = (dateStr ?? '').trim();
  if (!s) return null;
  const dateOnly = s.slice(0, 10);
  if (!DATE_ONLY_RE.test(dateOnly)) return null;
  const d = new Date(`${dateOnly}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
