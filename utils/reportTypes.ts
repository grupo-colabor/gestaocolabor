// ─── Tipos compartilhados para geração de relatório ─────────────────────────

export interface PeriodInfo {
  label: string;   // 'P1', 'P2', …
  color: string;   // hex '#378ADD'
  startDate: string;
  endDate: string;
}

export interface KPIRow {
  title: string;
  values: (number | string)[];  // one value per period
  positiveIsGood?: boolean;     // default true
  isCurrency?: boolean;
}

export interface RankingTable {
  title: string;
  rows: Array<{ name: string; values: (number | string)[] }>;
}

export interface TabData {
  id: string;
  label: string;
  kpis: KPIRow[];
  rankings?: RankingTable[];
}

export interface ReportInput {
  title: string;
  generatedAt: Date;
  periods: PeriodInfo[];
  activeFilters: Array<{ label: string; value: string }>;
  tabs: TabData[];
  /** Optional map of tab id → DOM element to capture as chart image */
  chartElements?: Record<string, HTMLElement | null>;
}

export interface ReportConfig {
  title: string;
  format: 'pdf' | 'excel';
  includeTabs: Record<string, boolean>;
}
