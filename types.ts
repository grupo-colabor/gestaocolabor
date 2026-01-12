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

export type AgendaType = 'TREINAMENTO' | 'FOLGA' | 'DESCANSO' | 'INDISPONIVEL' | 'ESCRITORIO' | 'OUTRO';

export type TransportType = 'Carro Alugado' | 'Carro Próprio' | 'N/A' | null;
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
  trainingLocal?: string; // Novo: Mina, Planta, etc.
  modality: Modality;
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
  | 'hoteis'
  | 'locadoras'
  | 'tiposTreinamento';

export interface OperationalBases {
  aprovadores: string[];
  analistas: string[];
  corredores: string[];
  localidades: string[];
  hoteis: string[];
  locadoras: string[];
  tiposTreinamento: string[];
}

// --- EVIDÊNCIAS ---

export interface EvidenceFile {
  id: string;
  name: string;
  uploadDate: string;
  base64?: string; // Simulação de arquivo
}

export interface EvidenceData {
  demandId: string;
  attendanceList: EvidenceFile[];
  certificates: EvidenceFile[];
  photos: EvidenceFile[];
  notes: string;
}
