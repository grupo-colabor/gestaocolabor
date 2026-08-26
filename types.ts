export type LogisticsType = 'COMPLETA' | 'SIMPLIFICADA';
export type Status = 'ATIVO' | 'INATIVO';
export type DemandStatus = 'NOVA' | 'PENDENTE' | 'ALOCADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
export type Modality = 'PRESENCIAL' | 'ONLINE' | 'HIBRIDO' | 'TUTORIA' | 'ONLINE_AO_VIVO';
export type Segment = 'Indústria' | 'Comércio' | 'Serviços' | 'Educação' | 'Saúde' | 'Outros';

export type MeasurementStatus =
  | 'NAO_INICIADA'
  | 'LANCAMENTO'
  | 'CONFERENCIA'
  | 'PRONTA_FATURAMENTO'
  | 'FATURADA';

export type ExpenseCategory = 'HOSPEDAGEM' | 'LOCOMOCAO' | 'CAFE' | 'ALMOCO' | 'JANTAR' | 'OUTROS';

export type TrainingCategory =
  | 'Segurança do Trabalho'
  | 'Manutenção Industrial'
  | 'Operação de Equipamentos'
  | 'Emergência'
  | 'Operação Ferroviária'
  | 'Técnicos Elétrica'
  | 'Técnicos Solda'
  | 'Treinamentos Comportamentais';

export type AgendaType =
  | 'TREINAMENTO'
  | 'FOLGA'
  | 'INDISPONIVEL'
  | 'FERIAS'
  | 'DESCANSO'
  | 'OUTRO'
  | 'ESCRITORIO' // mantém por compatibilidade com registros antigos
  | 'ESCRITORIO_ALPHAVILLE'
  | 'ESCRITORIO_BH'
  | 'ESCRITORIO_VITORIA'
  | 'HOME_OFFICE'
  | 'EXTERNO'
  | 'MANUTENÇÃO'
  | 'DESLOCAMENTO'
  | 'EVENTO'
  | 'RESERVADO'
  | 'APOIO';


export type TransportType = 'Carro Alugado' | 'Carro Próprio' | 'Táxi' | 'Carro Aplicativo' | 'Outros' | 'N/A' | null;
export type RentalCompany = 'Localiza' | 'Movida' | 'Outro';
export type PaymentMethod = 'Faturado' | 'N/A' | 'PIX' | 'Balcão' | null;
export type AccommodationType = 'Hotel' | 'N/A' | null;

export interface Address {
  cep?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
}

export interface Contact {
  name?: string;
  role?: string;
  phone?: string;
  email?: string;
}

export interface Company {
  id: string;
  razaoSocial: string;
  name: string; // Nome Fantasia
  cnpj?: string;
  logisticsType: LogisticsType;
  status: Status;
  segment?: Segment;
  address?: Address;
  contact?: Contact;
  observations?: string;
}

export interface Region {
  id: string;
  name: string;
  status: Status;
}

export interface Area {
  id: string;
  name: string;
  status: Status;
}

export interface Training {
  id: string;
  name: string;
  nr?: string; // Código interno
  category: TrainingCategory;
  hours: number;
  /** Só relevante para modality HIBRIDO: horas da parte presencial (a única ministrada por instrutor — o restante é EAD). */
  practicalHours?: number | null;
  modality: Modality;
  status: Status;
  descriptionShort?: string;
  descriptionDetailed?: string;
  prerequisites?: string;
  targetAudience?: string;
  emitsCertificate: boolean;
  validityMonths?: number;
  areaId: string; // Compatibilidade com base legada
}

export interface InstructorSkill {
  trainingId: string;
  level: 1 | 2 | 3 | 4; // 1: Iniciante, 2: Intermediário, 3: Avançado, 4: Especialista
}

export interface Instructor {
  id: string;
  name: string;
  regionIds: string[];
  status: Status;
  skills: InstructorSkill[];
  observations?: string;
  email?: string;
  cpf?: string;
  residenceLocation?: string;
  address?: string | null;
  currentLocation?: string;
  agendaRole?: string;
  operationalNotes?: string;
}

export interface Schedule {
  id: string;
  instructorId: string;
  demandId: string;
  startDate: string;
  endDate: string;
}

export interface InstructorAllocation {
  id: string;
  demandId: string;
  instructorId: string;
  startDate: string;
  endDate: string;
}

export interface CompanionAllocation {
  id: string;
  demandId: string;
  instructorId: string;
  startDate: string;
  endDate: string;
}

export interface LogisticAllocation {
  id: string;
  demandId: string;
  resourceType: 'CENTRO_TREINAMENTO_MOVEL';
  startDate: string;
  endDate: string;
}

export interface LogisticaLocomocao {
  id: string;
  instructorName?: string;
  transportType?: TransportType;
  rentalCompany?: RentalCompany;
  rentalOtherCompany?: string;
  rentalAgencyLocation?: string;
  rentalLocator?: string;
  carCategory?: string;
  rentalCheckIn?: string;
  rentalCheckOut?: string;
  receiptUrls?: string[] | null;
  // Usado quando transportType === 'Outros'; check-in/check-out reaproveitam rentalCheckIn/rentalCheckOut
  otherTransportDescription?: string;
}

export interface LogisticaHospedagem {
  id: string;
  instructorName?: string;
  accommodationType?: AccommodationType;
  hotelCity?: string;
  hotelName?: string;
  hotelCheckIn?: string;
  hotelCheckOut?: string;
  hotelPayment?: PaymentMethod;
  hotelReceiptUrls?: string[] | null;
}

export interface SpecificDateEntry {
  data: string;          // 'YYYY-MM-DD'
  horarioInicio: string; // 'HH:mm'
  horarioFim: string;    // 'HH:mm'
}

export interface Demand {
  id: string;
  clientDemandId?: string;

  // 'interna' = demanda da própria Colabor para um instrutor (visita, SIPAT,
  // apoio logístico, evento). Nesse caso companyId/trainingId chegam vazios e a
  // carga horária vem de horasPrevistas, não do treinamento.
  tipo: 'cliente' | 'interna';
  categoriaInterna?: string | null;
  horasPrevistas?: number | null;
  /** Descrição curta da interna — ocupa o lugar do nome do treinamento. */
  descricaoInterna?: string | null;

  companyId: string;
  regionId: string;
  trainingId: string;
  trainingLocal?: string;
  demandState?: string; // Estado (UF) da demanda — ex: ES, MG, MA
  modality: Modality;
  dateMode: 'CONTINUO' | 'DIAS_ESPECIFICOS';
  specificDates?: SpecificDateEntry[]; // só quando dateMode === 'DIAS_ESPECIFICOS'
  startDate: string;
  endDate: string;
  status: DemandStatus;
  instructorId?: string;
  resourceId?: string;
  requester?: string;
  observations?: string;
  

  // HÍBRIDO (MVP): período presencial (prática) dentro do período total
  practiceStartDate?: string;
  practiceEndDate?: string;

  // Sessão 1: Dados Internos
  approver?: string;
  analyst?: string;
  matriculador?: string;

  // Múltiplos blocos de logística (substitui os campos individuais abaixo)
  logisticasLocomocao?: LogisticaLocomocao[];
  logisticasHospedagem?: LogisticaHospedagem[];

  // Sessão 2: Locomoção — @deprecated use logisticasLocomocao (mantido para retrocompatibilidade)
  transportType?: TransportType;
  rentalCompany?: RentalCompany;
  rentalOtherCompany?: string;
  rentalAgencyLocation?: string;
  rentalLocator?: string;
  carCategory?: string;
  rentalCheckIn?: string;
  rentalCheckOut?: string;

  // Sessão 3: Hospedagem — @deprecated use logisticasHospedagem (mantido para retrocompatibilidade)
  accommodationType?: AccommodationType;
  hotelCity?: string;
  hotelName?: string;
  hotelCheckIn?: string;
  hotelCheckOut?: string;
  hotelPayment?: PaymentMethod;

  // Controle Logístico (Checklist)
  hotelConfirmed?: boolean;
  carConfirmed?: boolean;
  materialReady?: boolean;

  // Novos campos de status refinado
  logisticsHotel?: 'CONFIRMADO' | 'NAO_NECESSARIO' | null;
  logisticsTransport?: 'CONFIRMADO' | 'NAO_NECESSARIO' | null;

  // Anexos Base64
  attachments?: {
    classListPdf?: { name: string; base64: string };
    instructorReleasePdf?: { name: string; base64: string };
  };

  // Status de confirmação visual na agenda
  confirmationStatus?: 'CONFIRMADO' | 'A_CONFIRMAR';

  // Cancelamento
  cancelReason?: string; // motivo do cancelamento (ex: 'No-Show', 'Baixo quórum', etc.)

  // Legado / Outros
  corredor?: string;
  localizador?: string;
  offerId?: string;
  payment?: string;
  measurement?: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  data?: string; // Base64 para exportação Word
  type: string; // MIME type
  date: string;
  category: ExpenseCategory;
  value: number | string; // Valor monetário da notinha (aceita string para digitação fluida)
  otherId?: string; // Vinculo opcional para despesas em 'Outros'
  /**
   * Despesa que o CLIENTE nao reembolsa (ex.: Uber ate a locadora, almoco
   * acima do teto) — a Colabor absorve. Ausente = reembolsavel: os itens ja
   * gravados seguem valendo sem backfill, porque a leitura e `!== false`.
   * O item marcado continua no total e na sua categoria; e um recorte, nao
   * uma subtracao. Ver domain/measurementTotals.ts.
   */
  reembolsavel?: boolean;
  bucket?: string;
  path?: string;
  size?: number;
}

export interface OtherExpenseItem {
  id: string;
  description: string;
  value: string; // Valor de referência da linha (opcional)
}

export interface Measurement {
  id: string;
  demandId: string;
  status: MeasurementStatus;
  expenses: {
    breakfast: string;
    lunch: string;
    dinner: string;
    transport: string;
    others: string;
    classHours?: number;
    hourRate?: number;
  };
  attachments: Attachment[];
  otherExpenses: OtherExpenseItem[]; // Múltiplas despesas 'Outros'
  updatedAt: string;
}

export interface AgendaItem {
  id: string;
  instructorId: string;
  startDate: string;
  endDate: string;
  type: AgendaType;
  title: string;
  source: 'MANUAL' | 'DEMANDA';
  description?: string;
  relatedDemandId?: string;
}

export interface ExecutionRecord extends Demand {}

// --- BASES OPERACIONAIS ---

export type OperationalBaseKey =
  | 'aprovadores'
  | 'analistas'
  | 'corredores'
  | 'localidades'
  | 'locaisAgencia'
  | 'hoteis'
  | 'locadoras'
  | 'tiposTreinamento'
  | 'locaisTreinamento'
  | 'funcoesAgenda'
  | 'matriculadores'
  | 'regioes'
  | 'categoriasCarros'
  | 'categoriasInternas'
  | 'locaisDemandasInternas';

export interface OperationalBases {
  aprovadores: string[];
  analistas: string[];
  matriculadores: string[];
  corredores: string[];
  localidades: string[];
  locaisAgencia: string[];
  locaisTreinamento: string[];
  hoteis: string[];
  locadoras: string[];
  tiposTreinamento: string[];
  funcoesAgenda: string[];
  regioes: string[];
  categoriasCarros: string[];
  /** Categorias de demanda interna (Visita, SIPAT, Apoio Logístico...). */
  categoriasInternas: string[];
  /**
   * Locais de demanda interna. Alimenta as SUGESTOES do campo Local do form
   * interno. A CASCATA (local -> corredor/estado/regiao) continua vindo das
   * location_associations com contexto='interna' — mesma divisao de papeis da
   * dupla locaisTreinamento/associations do form de cliente.
   */
  locaisDemandasInternas: string[];
}

// --- ASSOCIAÇÕES DE LOCAL ---

export interface LocationAssociation {
  id: string;
  local: string;
  regiao: string;
  corredor: string;
  uf: string;
}

// --- EVIDÊNCIAS ---

export interface EvidenceFile {
  id: string;
  name: string;
  uploadDate: string;

  // ✅ novo (mas opcional durante migração)
  storagePath?: string;

  // ✅ legado (temporário)
  base64?: string;

  mimeType?: string;
  size?: number;
  url?: string;
}



export interface EvidenceData {
  demandId: string;
  attendanceList: EvidenceFile[];
  certificates: EvidenceFile[];
  photos: EvidenceFile[];
  notes: string;
}
