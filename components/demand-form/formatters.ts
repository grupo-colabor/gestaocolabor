/**
 * Formatadores de data compartilhados pelas seções do formulário de demanda.
 *
 * Movidos de `components/Demands.tsx` sem alteração de comportamento — as
 * seções extraídas (Locomoção/Hospedagem) precisam deles, e duplicar a lógica
 * de "formatar sem passar por new Date()" era a receita para as duas cópias
 * divergirem justamente no caso que motivou o cuidado (shift de timezone).
 */

export const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '---';

  const s = String(dateStr).trim();
  if (!s) return '---';

  // 1) Se vier só "YYYY-MM-DD" (date input)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  // 2) Se vier "YYYY-MM-DDTHH:mm..." (com ou sem Z / seconds)
  //    ✅ NÃO usar new Date() aqui (evita shift de timezone na Visualização)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const [datePart, timePartRaw] = s.split('T');
    const [y, m, d] = datePart.split('-');

    const hhmm = (timePartRaw || '').slice(0, 5); // "HH:mm"
    if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) {
      return `${d}/${m}/${y} ${hhmm}`;
    }

    // se por algum motivo não tiver HH:mm, cai só na data
    return `${d}/${m}/${y}`;
  }

  // 3) Fallback: tenta parsear com Date() (para formatos diferentes)
  const date = new Date(s);
  if (isNaN(date.getTime())) return s;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const baseDate = `${day}/${month}/${year}`;

  // Se tiver hora (string tem 'T' ou parece datetime), mostra HH:mm
  if (s.includes('T') || (s.includes(':') && s.length > 10)) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${baseDate} ${hours}:${minutes}`;
  }

  return baseDate;
};

export const formatDateOnlySafe = (dateStr?: string) => {
  if (!dateStr) return '---';

  const s = String(dateStr).trim();
  if (!s) return '---';

  // pega só a parte YYYY-MM-DD se vier ISO
  const datePart = s.includes('T') ? s.split('T')[0] : s;

  // se já for YYYY-MM-DD, formata sem Date()
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-');
    return `${d}/${m}/${y}`;
  }

  // fallback
  return formatDateTime(s).split(' ')[0];
};
