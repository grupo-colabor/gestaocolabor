/**
 * DOCUMENTO DA DEMANDA — Word, e-mail e WhatsApp
 *
 * Camada pura: recebe um modelo de exibição já resolvido (nomes, datas
 * formatadas, blocos de logística) e devolve o texto ou os parágrafos do .docx.
 * Não conhece React, contexto nem Supabase — quem monta o modelo é a tela.
 *
 * Existe porque demanda de cliente e demanda interna produzem o MESMO
 * documento, exceto por três linhas de identificação: cliente é
 * empresa + treinamento + categoria do treinamento + carga horária do
 * treinamento; interna é empresa (opcional) + categoria + descrição + horas
 * previstas. Tudo o mais — período, local, região, instrutor, os dois blocos de
 * logística, status e observações — é idêntico, e duplicar ~300 linhas de
 * montagem de docx para mudar três campos seria garantir que as duas cópias
 * divergissem na primeira manutenção.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx';

/** Par rótulo/valor de uma linha de identificação. */
export interface DemandDocLinha {
  /** Texto em negrito, JÁ com emoji e ": " no fim, como sai no documento. */
  label: string;
  value: string;
}

export interface DemandDocLocomocao {
  instructorName?: string;
  transportType?: string | null;
  rentalCompany?: string | null;
  rentalLocator?: string | null;
  rentalAgencyLocation?: string | null;
  /** Já formatado para exibição. */
  rentalCheckIn?: string | null;
  rentalCheckOut?: string | null;
}

export interface DemandDocHospedagem {
  instructorName?: string;
  accommodationType?: string | null;
  hotelName?: string | null;
  hotelCity?: string | null;
  /** Já formatado para exibição. */
  hotelCheckIn?: string | null;
  hotelCheckOut?: string | null;
  hotelPayment?: string | null;
}

export interface DemandDocFields {
  id: string;
  /** Cabeçalho, sem emoji: 'DEMANDA DE TREINAMENTO' | 'DEMANDA INTERNA'. */
  tituloDocumento: string;
  /** Rótulo da empresa no Word — muda entre 'Empresa / Cliente' e 'Empresa'. */
  empresaLabel: string;
  empresa: string;
  /**
   * Identificação no texto (e-mail/WhatsApp), entre Empresa e Instrutor.
   * Cliente: [Treinamento]. Interna: [Categoria, Descrição].
   */
  identificacaoTexto: DemandDocLinha[];
  /**
   * Identificação no Word, dentro de INFORMAÇÕES GERAIS, entre Empresa e
   * Modalidade. Cliente: [Treinamento, Categoria, Carga Horária].
   * Interna: [Categoria, Descrição, Carga Horária].
   */
  identificacaoWord: DemandDocLinha[];
  modalidade: string;
  /** 'dd/mm/aaaa hh:mm até dd/mm/aaaa hh:mm'. */
  periodo: string;
  /** Lista de dias já formatada, ou null quando o modo é contínuo. */
  diasEspecificos: string | null;
  local: string;
  corredor: string;
  estado: string;
  regiao: string;
  solicitante: string;
  instrutor: string;
  status: string;
  observacoes: string;
  loco: DemandDocLocomocao[];
  hosp: DemandDocHospedagem[];
}

/* ========================================================================== */
/* Texto (e-mail e WhatsApp)                                                  */
/* ========================================================================== */

/**
 * Corpo em texto puro. `isWhatsApp` só troca a ênfase dos títulos por *asterisco*,
 * que é a marcação de negrito do WhatsApp.
 */
export function buildDemandTextContent(f: DemandDocFields, isWhatsApp = false): string {
  const b = (text: string) => (isWhatsApp ? `*${text}*` : text);

  let content = `
${b(`📄 ${f.tituloDocumento}`)}
----------------------------------
ID: #${f.id}
Empresa: ${f.empresa}
${f.identificacaoTexto.map(l => `${l.label}: ${l.value}`).join('\n')}
Instrutor: ${f.instrutor}

${b('📘 INFORMAÇÕES GERAIS')}
• Período: ${f.periodo}${f.diasEspecificos ? `\n• Dias específicos: ${f.diasEspecificos}` : ''}
• Unidade/Local: ${f.local}
• Modalidade: ${f.modalidade}
• Região: ${f.regiao}
• Corredor: ${f.corredor}
• Estado: ${f.estado}
• Solicitante: ${f.solicitante}

`;

  const multiLoco = f.loco.length > 1;
  const multiHosp = f.hosp.length > 1;

  for (const block of f.loco) {
    const label = multiLoco && block.instructorName ? ` (${block.instructorName})` : '';
    content += `\n${b(`🚗 LOGÍSTICA — LOCOMOÇÃO${label}`)}`;
    content += `\n• Meio de Transporte: ${block.transportType || 'N/A'}`;
    if (block.transportType === 'Carro Alugado') {
      content += `
• Locadora: ${block.rentalCompany || 'N/A'}
• Localizador: ${block.rentalLocator || 'A definir'}
• Local da Agência: ${block.rentalAgencyLocation || 'N/A'}
• Check-in: ${block.rentalCheckIn || 'N/A'}
• Check-out: ${block.rentalCheckOut || 'N/A'}`;
    }
  }

  for (const block of f.hosp) {
    const label = multiHosp && block.instructorName ? ` (${block.instructorName})` : '';
    content += `\n\n${b(`🏨 LOGÍSTICA — HOSPEDAGEM${label}`)}`;
    content += `\n• Hospedagem: ${block.accommodationType === 'Hotel' ? 'Hotel Requerido' : 'N/A'}`;
    if (block.accommodationType === 'Hotel') {
      content += `
• Hotel: ${block.hotelName || 'A definir'}
• Cidade / Estado: ${block.hotelCity || 'N/A'}
• Check-in: ${block.hotelCheckIn || 'N/A'}
• Check-out: ${block.hotelCheckOut || 'N/A'}
• Pagamento: ${block.hotelPayment || 'N/A'}`;
    }
  }

  content += `

${b('📌 STATUS ATUAL')}
• Status: ${f.status}

${b('📝 OBSERVAÇÕES')}
${f.observacoes}
    `.trim();

  return content;
}

/* ========================================================================== */
/* Word (.docx)                                                               */
/* ========================================================================== */

const HEADING_BORDER = {
  bottom: { color: 'e2e8f0', space: 1, style: BorderStyle.SINGLE, size: 6 },
} as const;

const secao = (text: string) =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    border: HEADING_BORDER,
    spacing: { before: 400, after: 200 },
  });

const linha = (label: string, value: string) =>
  new Paragraph({ children: [new TextRun({ text: label, bold: true }), new TextRun(value)] });

/** Parágrafos do documento, na ordem. Separado para poder ser testado sem I/O. */
export function buildDemandWordChildren(f: DemandDocFields, geradoEm: string): any[] {
  return [
    new Paragraph({
      text: `📄 ${f.tituloDocumento}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: '📌 Documento oficial para alinhamento com instrutor',
          italics: true,
          color: '64748b',
          size: 20,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Identificador: #${f.id}`, bold: true, size: 20 })],
      spacing: { after: 400 },
    }),

    new Paragraph({
      text: '📘 INFORMAÇÕES GERAIS',
      heading: HeadingLevel.HEADING_2,
      border: HEADING_BORDER,
      spacing: { before: 200, after: 200 },
    }),
    linha(f.empresaLabel, f.empresa),
    ...f.identificacaoWord.map(l => linha(l.label, l.value)),
    linha('🌐 Modalidade: ', f.modalidade),
    linha('📅 Período: ', f.periodo),
    ...(f.diasEspecificos ? [linha('📅 Dias específicos: ', f.diasEspecificos)] : []),
    linha('📍 Local / Unidade: ', f.local),
    linha('🏢 Corredor: ', f.corredor),
    linha('📌 Estado: ', f.estado),
    linha('🌎 Região: ', f.regiao),
    linha('🧑‍💼 Solicitante: ', f.solicitante),

    secao('👨‍🏫 INSTRUTOR'),
    linha('👤 Instrutor alocado: ', f.instrutor),

    // ── Locomoção: um ou mais blocos ──────────────────────────────────────
    ...(() => {
      const multi = f.loco.length > 1;
      const rows: any[] = [];
      for (const b of f.loco) {
        const label = multi && b.instructorName ? ` (${b.instructorName})` : '';
        rows.push(secao(`🚗 LOGÍSTICA — LOCOMOÇÃO${label}`));
        rows.push(linha('Meio de Transporte: ', b.transportType || 'N/A'));
        if (b.transportType === 'Carro Alugado') {
          rows.push(linha('Locadora: ', b.rentalCompany || 'N/A'));
          rows.push(linha('Localizador: ', b.rentalLocator || 'A definir'));
          rows.push(linha('Local da Agência: ', b.rentalAgencyLocation || 'N/A'));
          rows.push(linha('Check-in: ', b.rentalCheckIn || 'N/A'));
          rows.push(linha('Check-out: ', b.rentalCheckOut || 'N/A'));
        }
      }
      return rows;
    })(),

    // ── Hospedagem: um ou mais blocos ─────────────────────────────────────
    ...(() => {
      const multi = f.hosp.length > 1;
      const rows: any[] = [];
      for (const b of f.hosp) {
        const label = multi && b.instructorName ? ` (${b.instructorName})` : '';
        rows.push(secao(`🏨 LOGÍSTICA — HOSPEDAGEM${label}`));
        rows.push(linha('Hospedagem: ', b.accommodationType === 'Hotel' ? 'Hotel Requerido' : 'N/A'));
        if (b.accommodationType === 'Hotel') {
          rows.push(linha('Hotel: ', b.hotelName || 'A definir'));
          rows.push(linha('Cidade / Estado: ', b.hotelCity || 'N/A'));
          rows.push(linha('Check-in: ', b.hotelCheckIn || 'N/A'));
          rows.push(linha('Check-out: ', b.hotelCheckOut || 'N/A'));
          rows.push(linha('Pagamento: ', b.hotelPayment || 'N/A'));
        }
      }
      return rows;
    })(),

    secao('📌 STATUS DA DEMANDA'),
    linha('Status Atual: ', f.status),

    secao('📝 OBSERVAÇÕES'),
    new Paragraph({
      children: [new TextRun({ text: f.observacoes, italics: true })],
      spacing: { before: 100 },
    }),

    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `\nGerado automaticamente via Colabor Training Manager em ${geradoEm}`,
          size: 16,
          color: '94a3b8',
        }),
      ],
      spacing: { before: 1000 },
    }),
  ];
}

/** Monta o .docx e dispara o download no navegador. */
export async function downloadDemandWord(f: DemandDocFields, fileName: string): Promise<void> {
  const doc = new Document({
    sections: [{ properties: {}, children: buildDemandWordChildren(f, new Date().toLocaleString('pt-BR')) }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
