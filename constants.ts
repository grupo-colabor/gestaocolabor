
import { Company, Region, Area, Training, Instructor, Demand, OperationalBases } from './types';

export const MOCK_REGIONS: Region[] = [
  { id: '1', name: 'Sudeste', status: 'ATIVO' },
  { id: '2', name: 'Norte', status: 'ATIVO' },
  { id: '3', name: 'Nordeste', status: 'ATIVO' },
  { id: '4', name: 'Sul', status: 'INATIVO' },
];

export const MOCK_AREAS: Area[] = [
  { id: '1', name: 'Segurança do Trabalho', status: 'ATIVO' },
  { id: '2', name: 'Manutenção Industrial', status: 'ATIVO' },
  { id: '3', name: 'Operação Ferroviária', status: 'ATIVO' },
];

export const MOCK_COMPANIES: Company[] = [
  { id: '1', name: 'VALE', razaoSocial: 'Vale S.A.', logisticsType: 'COMPLETA', status: 'ATIVO' },
  { id: '2', name: 'VLI Logística', razaoSocial: 'VLI Multimodal S.A.', logisticsType: 'SIMPLIFICADA', status: 'ATIVO' },
  { id: '3', name: 'S RIKO', razaoSocial: 'S RIKO LTDA', logisticsType: 'SIMPLIFICADA', status: 'ATIVO' },
];

export const MOCK_TRAININGS: Training[] = [
  { 
    id: '1', 
    name: 'NR-12 – Segurança no Trabalho em Máquinas e Equipamentos', 
    nr: 'NR12-ONL', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 4, 
    modality: 'ONLINE', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Operadores e mantenedores. Foco em proteção coletiva e conceitos teóricos. Avaliação teórica obrigatória.',
    emitsCertificate: true,
    validityMonths: 24,
  },
  { 
    id: '2', 
    name: 'NR-20 – Segurança com Inflamáveis e Combustíveis (Intermediário)', 
    nr: 'NR20-INT', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 8, 
    modality: 'HIBRIDO', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Trabalhadores em instalações Classe I, II ou III. Parte teórica online e prática presencial. Exige avaliação.',
    emitsCertificate: true,
    validityMonths: 36,
  },
  { 
    id: '3', 
    name: 'NR-33 – Segurança nos Trabalhos em Espaços Confinados (Vigia e Trabalhador)', 
    nr: 'NR33-BAS', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 16, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Vigias e trabalhadores autorizados. Possui prática de resgate e entrada. Exige EPIs específicos e avaliação prática.',
    emitsCertificate: true,
    validityMonths: 12,
  },
  { 
    id: '4', 
    name: 'NR-35 – Segurança no Trabalho em Altura', 
    nr: 'NR35-BAS', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 8, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Trabalhadores acima de 2 metros. Inclui prática de linha de vida e nós. Uso obrigatório de cinto paraquedista.',
    emitsCertificate: true,
    validityMonths: 24,
  },
  { 
    id: '5', 
    name: 'Operação de Ponte Rolante e Talhas Elétricas', 
    nr: 'OP-PR', 
    category: 'Operação de Equipamentos',
    areaId: '2', 
    hours: 16, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Operadores de logística e manutenção. Inclui checklist e manobras reais de içamento. Avaliação prática eliminatória.',
    emitsCertificate: true,
    validityMonths: 12,
  },
  { 
    id: '6', 
    name: 'Brigada de Incêndio – Nível Básico (IT-17/RT-14)', 
    nr: 'BRIG-BAS', 
    category: 'Emergência',
    areaId: '1', 
    hours: 8, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Colaboradores designados. Prática de combate a princípios de incêndio e primeiros socorros. Exige traje adequado.',
    emitsCertificate: true,
    validityMonths: 12,
  },
  { 
    id: '7', 
    name: 'NR-10 – Segurança em Instalações e Serviços com Eletricidade', 
    nr: 'NR10-BAS', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 40, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Eletricistas e auxiliares. Possui módulos práticos de primeiros socorros e combate a incêndio em eletricidade. Exige avaliação teórica e prática.',
    emitsCertificate: true,
    validityMonths: 24,
  },
  { 
    id: '8', 
    name: 'NR-06 – Equipamentos de Proteção Individual (EPI)', 
    nr: 'NR06-EPI', 
    category: 'Segurança do Trabalho',
    areaId: '1', 
    hours: 2, 
    modality: 'ONLINE', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Todos os colaboradores. Orientações sobre guarda, conservação e uso correto dos EPIs. Treinamento 100% teórico.',
    emitsCertificate: true,
    validityMonths: 12,
  },
  { 
    id: '9', 
    name: 'Operação de Empilhadeira (Combustão / Elétrica)', 
    nr: 'OP-EMP', 
    category: 'Operação de Equipamentos',
    areaId: '2', 
    hours: 16, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Operadores de empilhadeira. Inclui aula prática de movimentação de carga e inspeção diária. Exige EPIs de segurança e avaliação prática.',
    emitsCertificate: true,
    validityMonths: 12,
  },
  { 
    id: '10', 
    name: 'Primeiros Socorros – Nível Básico', 
    nr: 'PS-BAS', 
    category: 'Emergência',
    areaId: '1', 
    hours: 4, 
    modality: 'PRESENCIAL', 
    status: 'ATIVO',
    descriptionShort: 'Público-alvo: Público em geral. Foco em RCP, desengasgo e contenção de hemorragias. Possui prática simulada com manequins.',
    emitsCertificate: true,
    validityMonths: 24,
  },
];

export const MOCK_INSTRUCTORS: Instructor[] = [
  { 
    id: '1', 
    name: 'Ricardo Almeida Martins', 
    regionIds: ['1'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '7', level: 4 }, 
      { trainingId: '4', level: 3 }, 
      { trainingId: '3', level: 3 }  
    ],
    observations: 'Foco em elétrica de alta tensão. Exige logística completa para viagens fora de BH. Disponibilidade para treinamentos híbridos.'
  },
  { 
    id: '2', 
    name: 'Juliana Costa Oliveira', 
    regionIds: ['1', '4'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '6', level: 3 }, 
      { trainingId: '10', level: 4 }, 
      { trainingId: '8', level: 4 }  
    ],
    observations: 'Enfermeira do Trabalho. Grande experiência em Primeiros Socorros e Brigada de Incêndio. Prefere treinamentos presenciais.'
  },
  { 
    id: '3', 
    name: 'Marcos Pereira dos Santos', 
    regionIds: ['2', '3'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '9', level: 4 }, 
      { trainingId: '5', level: 4 }  
    ],
    observations: 'Instrutor técnico de máquinas pesadas. Possui CNH categoria D. Experiência prática em pátios logísticos e mineração.'
  },
  { 
    id: '4', 
    name: 'Sandra Ferreira Lima', 
    regionIds: ['1'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '2', level: 3 }, 
      { trainingId: '1', level: 3 }, 
      { trainingId: '7', level: 2 }  
    ],
    observations: 'Engenheira Mecânica. Especialista em conformidade de máquinas e inflamáveis. Disponibilidade imediata para região Sudeste.'
  },
  { 
    id: '5', 
    name: 'Paulo Roberto Cavalcanti', 
    regionIds: ['1', '3'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '4', level: 4 }, 
      { trainingId: '3', level: 4 }, 
      { trainingId: '10', level: 3 } 
    ],
    observations: 'Técnico em Segurança. Vasta experiência em resgate em altura e espaços confinados. Requer hotel em deslocamentos longos.'
  },
  {
    id: '7', 
    name: 'Fernando Silva Rezende', 
    regionIds: ['2'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '5', level: 4 }, 
      { trainingId: '1', level: 3 }  
    ],
    observations: 'Especialista em manutenção mecânica industrial. Atua fortemente em projetos de mineração no Norte.'
  },
  { 
    id: '8', 
    name: 'Beatriz Lima Mendonça', 
    regionIds: ['1'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '6', level: 4 }, 
      { trainingId: '7', level: 3 }  
    ],
    observations: 'Bombeira civil e instrutora de NR-10. Focada em prevenção de riscos elétricos e incêndio. Possui veículo próprio.'
  },
  { 
    id: '9', 
    name: 'Roberto Oliveira de Assis', 
    regionIds: ['1', '4'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '9', level: 4 }, 
      { trainingId: '4', level: 3 }  
    ],
    observations: 'Foco em logística industrial e segurança operacional. Experiência com empilhadeiras elétricas e combustão.'
  },
  { 
    id: '10', 
    name: 'Cláudia Martins Rocha', 
    regionIds: ['3'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '3', level: 4 }, 
      { trainingId: '2', level: 3 }  
    ],
    observations: 'Química industrial. Especialista em atmosferas explosivas e espaços confinados. Atende refinarias e portos no Nordeste.'
  },
  { 
    id: '11', 
    name: 'Gabriel Souza Santos', 
    regionIds: ['1'], 
    status: 'ATIVO', 
    skills: [
      { trainingId: '4', level: 4 }, 
      { trainingId: '7', level: 3 }  
    ],
    observations: 'Especialista em trabalhos em altura e segurança elétrica. Experiência em paradas de manutenção industrial na região Sudeste.'
  }
];

// --- DEMANDAS LIMPAS PARA NOVA UTILIZAÇÃO ---
export const MOCK_DEMANDS: Demand[] = [];

export const SKILL_LABELS: Record<number, string> = {
  1: 'Iniciante',
  2: 'Intermediário',
  3: 'Avançado',
  4: 'Especialista'
};

// --- BASE DE DADOS OFICIAL (PADRONIZADA) ---
export const INITIAL_OPERATIONAL_BASES: OperationalBases = {
  aprovadores: [
    "Alice", "Ana Marotta", "Bethania", "Denise", "Fabiane", "Fernanda", "Flavia",
    "Gabriel", "Gabriella", "Grazielle", "Hegner", "Janaina", "Jhonata", "Josias",
    "Juliana", "Lorena", "Luana", "Luciana", "Manuela", "Marcela Moraes", "Marcely",
    "Maria Antonia", "Marise", "Marlon", "Patricia", "Roberta", "Sebastião",
    "Simone", "Suamya", "Tainá", "Tap Eletro", "Rosirene", "Empresa PSM", "Empresa ISQ"
  ],
  analistas: [
    "Adenilson", "Alice", "Aurilene", "Bethania", "Bruna", "Claudia", "Denilson",
    "Edianara", "Eliton", "Fabrine", "Gilteane", "Iryslene", "Jhonata", "Josias",
    "Julia", "Lais", "Livia", "Lorena", "Luan", "Manuela", "Marcela", "Marina",
    "Marlon", "Mylene", "Natalia", "Rafaela", "Ricelly", "Suamya", "Talita",
    "Thiago", "Trayce", "Tap Eletro", "Rosirene", "Empresa PSM", "Empresa ISQ"
  ],
  matriculadores: [], 
  corredores: [
    "Ferrovia/MA", "Porto/Ferrovia", "S11D", "Serra Norte", "Sudeste",
    "Sul/Portos Sul", "Tap Eletro", "Salobo", "Aperam"
  ],
  localidades: [
    "N/A", "Brucutu", "Carajás", "Cauê", "Fábrica", "Fazendão", "Moqui", "Mutuca",
    "Nova Era", "Vitória", "Santa Luzia", "Timbopeba", "Tubarão", "Vargem Grande",
    "Canaã", "Village", "São Luis", "Rio de Janeiro", "Intendente Câmara",
    "Capanema", "Belo Horizonte", "Salobo", "Praia Mole", "Governador Valadares", "Timoteo"
  ],
  locaisAgencia: [
    "ES", "MA", "MG", "PA"
  ],
  locaisTreinamento: [],

  hoteis: [
    "Hotel providência", "Iron flat", "IT Itabira", "Não Solicitado",
    "Pousada das Nascentes", "Santos Dumont", "Urbanos", "JOB",
    "Circuito dos Inconfidentes", "Ímpar suítes", "Minas hotel",
    "Pousada Encantos Serra", "Pousada de Minas", "Circuito do Ouro",
    "Premium", "Pousada dos elefantes", "Dom Henrique", "Benvenuto"
  ],
  locadoras: ["Localiza", "Movida", "Outro"],
  tiposTreinamento: ["Hibrido", "Online", "Online (Ao Vivo)", "Presencial", "Tutoria"],
  funcoesAgenda: ['Instrutor', 'Coordenador', 'Motorista'],
  regioes: [],
  categoriasCarros: [
    "Grupo B", "Grupo BE", "Grupo C", "Grupo CE", "Grupo CS",
    "Grupo F", "Grupo FS", "Grupo FH", "Grupo FX"
  ],
  // Mesmo seed da migration 013 — no modo supabase quem manda é
  // operational_bases_items; isto aqui só cobre o modo mock.
  categoriasInternas: ["Visita", "SIPAT", "Apoio Logístico", "Evento", "Outro"],
};

export const HISTORICAL_MATRICULADORES = ["Bernardo", "Micaelle", "Tallita", "Yara"];

export const CAR_CATEGORIES = [
  "Grupo B", "Grupo BE", "Grupo C", "Grupo CE", "Grupo CS",
  "Grupo F", "Grupo FS", "Grupo FH", "Grupo FX"
];

export const PAYMENT_METHODS = ["Faturado", "N/A", "PIX", "Balcão"];
