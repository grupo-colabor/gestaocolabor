export type LogisticsType = 'COMPLETA' | 'SIMPLIFICADA';
export type Status = 'ATIVO' | 'INATIVO';
export type DemandStatus = 'NOVA' | 'PENDENTE' | 'ALOCADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
export type Modality = 'PRESENCIAL' | 'ONLINE' | 'HIBRIDO' | 'TUTORIA';
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
  | 'EXTERNO';


export type TransportType = 'Carro Alugado' | 'Carro Próprio' | 'Táxi' | 'N/A' | null;
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
  residenceLocation?: string;     
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

export interface Demand {
  id: string;
  clientDemandId?: string;
  companyId: string;
  regionId: string;
  trainingId: string;
  trainingLocal?: string;
  demandState?: string; // Estado (UF) da demanda — ex: ES, MG, MA
  modality: Modality;
  dateMode: 'CONTINUO' | 'DIAS_ESPECIFICOS';
  specificDates?: string[]; // ['2026-02-12', '2026-02-13', ...] — só quando dateMode === 'DIAS_ESPECIFICOS'
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

  // Sessão 2: Locomoção
  transportType?: TransportType;
  rentalCompany?: RentalCompany;
  rentalOtherCompany?: string;
  rentalAgencyLocation?: string;
  rentalLocator?: string; // NOVO: Localizador do Carro
  carCategory?: string;
  rentalCheckIn?: string; // Date + Time
  rentalCheckOut?: string; // Date + Time

  // Sessão 3: Hospedagem
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
  | 'matriculadores';

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
