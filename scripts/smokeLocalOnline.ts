/**
 * SMOKE — Local do Treinamento editável em modalidade ONLINE
 *
 * Rodar com:  npm run smoke:local-online
 *
 * Decisão do PO: no form de demanda de CLIENTE, "Local do Treinamento" deixa de
 * ficar travado em N/A quando o Tipo de Atendimento é ONLINE. O campo passa a
 * aceitar local real (com cascata região/corredor/estado) OU 'N/A' — mas 'N/A'
 * não é mais imposto.
 *
 * O ponto central é a REGRESSÃO: PRESENCIAL / HÍBRIDO / TUTORIA precisam sair
 * exatamente iguais ao que a implementação ORIGINAL produzia. Por isso as regras
 * antigas estão reproduzidas aqui (`sanitizeOriginal`, `sugestaoOriginal`) e
 * comparadas caso a caso contra as novas, sobre a matriz modalidades × locais.
 *
 * As regras que vivem dentro do JSX do Demands.tsx (sanitize do save, doc Word,
 * DataView, opções do datalist) não são importáveis; estão reproduzidas abaixo e
 * ancoradas no código-fonte pela seção "guardas de fonte", que falha se a linha
 * reproduzida sumir ou mudar — evita o smoke ficar verde sobre código morto.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import { calculateDemandStatus } from '../domain/demandStatus';
import { requiresLogistics } from '../domain/modalityRules';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(
    nome,
    Object.is(atual, esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`
  );

// ───────────────────────────────────────────────────────────────────────────
// Reproduções fiéis das regras que vivem no JSX / no App.tsx
// ───────────────────────────────────────────────────────────────────────────

/** Demands.tsx — sanitize do save, ANTES da mudança. */
const sanitizeOriginal = (modality: string, trainingLocal: string) =>
  !requiresLogistics(modality) ? '' : trainingLocal || '';

/** Demands.tsx — sanitize do save, DEPOIS da mudança. */
const sanitizeNovo = (_modality: string, trainingLocal: string) => trainingLocal || '';

/** App.tsx:975 — cleanOrNull antes do insert. */
const cleanOrNull = (v?: string | null) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

/** App.tsx:895 — leitura de volta do banco. */
const mapFromDb = (training_local: string | null) => training_local ?? 'N/A';

/** Round-trip completo form → banco → app. */
const roundTrip = (
  modality: string,
  trainingLocal: string,
  sanitize: (m: string, l: string) => string = sanitizeNovo
) => mapFromDb(cleanOrNull(sanitize(modality, trainingLocal)));

/** Demands.tsx — opções do datalist do campo Local (memo localOptions). */
const localOptions = (modality: string, base: string[], assocLocais: string[]) => {
  const isNAValue = (v: string) => v.trim().toUpperCase() === 'N/A';
  const todos = [...base, ...assocLocais]
    .map(v => (v ?? '').trim())
    .filter(v => !!v && !isNAValue(v));
  const unique = Array.from(new Set(todos)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return requiresLogistics(modality) ? unique : ['N/A', ...unique];
};

/** Demands.tsx — núcleo puro de handleTrainingLocalChange (cascata). */
type Assoc = { local: string; regiao: string; corredor: string; uf: string };
const cascata = (value: string, assocs: Assoc[]) => {
  const isNA = value === 'N/A';
  const assoc = value && !isNA ? assocs.find(a => a.local === value) : null;
  const updates: Record<string, string> = { trainingLocal: value };
  if (isNA) {
    updates.corredor = 'N/A';
    updates.demandState = 'N/A';
    updates.regionId = '';
  } else if (assoc) {
    if (assoc.corredor) updates.corredor = assoc.corredor;
    if (assoc.uf) updates.demandState = assoc.uf;
    if (assoc.regiao) updates.regionId = assoc.regiao;
  }
  return updates;
};

/** Demands.tsx — campo `local` do doc Word / e-mail / WhatsApp. */
const docLocal = (trainingLocal: string) => trainingLocal || 'N/A';

/** Demands.tsx — DataViewField "Unidade / Local" no modo leitura. */
const dataViewLocal = (trainingLocal: string) => trainingLocal || 'N/A';

/** CalendarView.tsx:1865 — a agenda só imprime o local se não for N/A. */
const agendaMostraLocal = (trainingLocal: string) => !!trainingLocal && trainingLocal !== 'N/A';

/** ExportDemandsModal.tsx:345 — célula do Excel. */
const excelLocal = (trainingLocal: string) => trainingLocal || '';

/** App.tsx — sugestão de instrutor: demanda sem âncora geográfica. ANTES. */
const sugestaoOriginal = (trainingLocal: string, _modality: string) => trainingLocal === 'N/A';
/**
 * App.tsx — idem, DEPOIS. Repare no requiresLogistics: usar isEAD aqui quebraria
 * TUTORIA, que é EAD mas exige logística — foi o que este smoke pegou.
 */
const sugestaoNova = (trainingLocal: string, modality: string) =>
  trainingLocal === 'N/A' || !requiresLogistics(modality);

// Datas fixas: nada de new Date() solto, para o smoke não virar flaky.
const NOW = new Date('2026-03-01T09:00:00');
const DAQUI_30 = { startDate: '2026-03-31T08:00:00', endDate: '2026-03-31T17:00:00' };
const status = (over: Record<string, unknown>) =>
  calculateDemandStatus({ ...DAQUI_30, ...over } as any, NOW);

const BASE_LOCAIS = ['Vitória', 'Brucutu', 'Mariana'];
const ASSOCS: Assoc[] = [
  { local: 'Brucutu', regiao: 'Sudeste', corredor: 'Corredor Norte', uf: 'MG' },
  { local: 'Vitória', regiao: 'Sudeste', corredor: 'Corredor Sul', uf: 'ES' },
];
const ASSOC_LOCAIS = ASSOCS.map(a => a.local);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n— CENÁRIO 1: ONLINE com local real (o pedido do PO)');
{
  eq('sanitize preserva o local (antes era apagado)', sanitizeNovo('ONLINE', 'Brucutu'), 'Brucutu');
  eq('a regra antiga apagava mesmo — é isto que mudou', sanitizeOriginal('ONLINE', 'Brucutu'), '');
  eq('round-trip form→banco→app devolve o local', roundTrip('ONLINE', 'Brucutu'), 'Brucutu');

  const s = status({ modality: 'ONLINE', trainingLocal: 'Brucutu', instructorId: null });
  eq('status ONLINE + local real', s, 'ALOCADA');
  eq(
    'local real NÃO move o status: idêntico ao de N/A',
    s,
    status({ modality: 'ONLINE', trainingLocal: 'N/A', instructorId: null })
  );

  const c = cascata('Brucutu', ASSOCS);
  eq('cascata → corredor', c.corredor, 'Corredor Norte');
  eq('cascata → estado', c.demandState, 'MG');
  eq('cascata → região', c.regionId, 'Sudeste');

  check('agenda imprime o local', agendaMostraLocal('Brucutu'));
  eq('Excel exporta o local', excelLocal('Brucutu'), 'Brucutu');
  eq('doc Word mostra o local (não mais N/A forçado)', docLocal('Brucutu'), 'Brucutu');
  eq('DataView mostra o local', dataViewLocal('Brucutu'), 'Brucutu');

  eq(
    'N/A continua ofertado, no topo do datalist do online',
    localOptions('ONLINE', BASE_LOCAIS, ASSOC_LOCAIS)[0],
    'N/A'
  );
  check(
    'datalist do online traz os locais reais junto',
    localOptions('ONLINE', BASE_LOCAIS, ASSOC_LOCAIS).includes('Brucutu')
  );
  check('local não vira obrigatório no online', requiresLogistics('ONLINE') === false);
}

console.log('\n— CENÁRIO 1b: ONLINE_AO_VIVO (exige instrutor, não exige logística)');
{
  const comLocal = status({
    modality: 'ONLINE_AO_VIVO',
    trainingLocal: 'Brucutu',
    instructorId: null,
  });
  const comNA = status({ modality: 'ONLINE_AO_VIVO', trainingLocal: 'N/A', instructorId: null });
  eq('sem instrutor e longe da data → NOVA', comLocal, 'NOVA');
  eq('local real não empurra para PENDENTE', comLocal, comNA);
  eq('round-trip preserva o local', roundTrip('ONLINE_AO_VIVO', 'Vitória'), 'Vitória');
  check(
    'sugestão de instrutor segue ignorando UF no online (comportamento de hoje)',
    sugestaoNova('Brucutu', 'ONLINE_AO_VIVO') === true
  );
  check(
    '… e a regra antiga também ignorava, porque o local era sempre N/A',
    sugestaoOriginal('N/A', 'ONLINE_AO_VIVO') === true
  );
}

console.log('\n— CENÁRIO 2: ONLINE com N/A (comportamento atual, intacto)');
{
  eq('valor efetivo continua N/A', roundTrip('ONLINE', 'N/A'), 'N/A');
  eq(
    'idêntico ao que a regra antiga produzia (vazio → NULL → N/A)',
    roundTrip('ONLINE', 'N/A'),
    roundTrip('ONLINE', 'N/A', sanitizeOriginal)
  );
  eq('online sem local nenhum também cai em N/A', roundTrip('ONLINE', ''), 'N/A');

  const c = cascata('N/A', ASSOCS);
  eq('N/A trava corredor', c.corredor, 'N/A');
  eq('N/A trava estado', c.demandState, 'N/A');
  eq('N/A limpa região', c.regionId, '');

  check('agenda omite o local', agendaMostraLocal('N/A') === false);
  eq('doc Word mostra N/A', docLocal('N/A'), 'N/A');
  eq(
    'status inalterado',
    status({ modality: 'ONLINE', trainingLocal: 'N/A', instructorId: null }),
    'ALOCADA'
  );
  check('sugestão de instrutor segue sem filtro por UF', sugestaoNova('N/A', 'ONLINE'));
}

console.log('\n— CENÁRIO 3: REGRESSÃO — modalidades com logística');
{
  const MODALIDADES = ['PRESENCIAL', 'HIBRIDO', 'TUTORIA'];
  const LOCAIS = ['Brucutu', 'N/A', '', 'Local Novo'];

  for (const m of MODALIDADES) {
    for (const l of LOCAIS) {
      const rot = `${m} / ${JSON.stringify(l)}`;
      eq(`sanitize idêntico ao original — ${rot}`, sanitizeNovo(m, l), sanitizeOriginal(m, l));
      eq(
        `round-trip idêntico ao original — ${rot}`,
        roundTrip(m, l),
        roundTrip(m, l, sanitizeOriginal)
      );
      eq(
        `sugestão de instrutor idêntica à original — ${rot}`,
        sugestaoNova(roundTrip(m, l), m),
        sugestaoOriginal(roundTrip(m, l), m)
      );
      check(
        `datalist NÃO oferece N/A — ${rot}`,
        !localOptions(m, BASE_LOCAIS, ASSOC_LOCAIS).includes('N/A')
      );
    }
  }

  eq(
    'PRESENCIAL + N/A + sem instrutor continua PENDENTE',
    status({ modality: 'PRESENCIAL', trainingLocal: 'N/A', instructorId: null }),
    'PENDENTE'
  );
  eq(
    'PRESENCIAL + local real + sem instrutor continua NOVA',
    status({ modality: 'PRESENCIAL', trainingLocal: 'Brucutu', instructorId: null }),
    'NOVA'
  );
  eq(
    'HIBRIDO + N/A continua PENDENTE',
    status({ modality: 'HIBRIDO', trainingLocal: 'N/A', instructorId: null }),
    'PENDENTE'
  );
  eq(
    'PRESENCIAL com instrutor continua ALOCADA',
    status({ modality: 'PRESENCIAL', trainingLocal: 'Brucutu', instructorId: 'i1' }),
    'ALOCADA'
  );

  const c = cascata('Vitória', ASSOCS);
  eq('cascata presencial → estado', c.demandState, 'ES');
  eq('cascata presencial → corredor', c.corredor, 'Corredor Sul');
}

console.log('\n— GUARDAS DE FONTE (as reproduções acima ainda batem com o código?)');
{
  const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const demands = ler('components/Demands.tsx');
  const app = ler('App.tsx');
  const calendar = ler('components/CalendarView.tsx');

  check(
    'Demands: sanitize do save não gateia mais por modalidade',
    demands.includes("trainingLocal: formDemand.trainingLocal || '',")
  );
  check(
    'Demands: input do Local não está mais disabled por modalidade',
    !demands.includes('disabled={!requiresLogistics(formDemand.modality)}')
  );
  check(
    'Demands: datalist do Local usa localOptions',
    demands.includes('<DataList id="locais-treinamento-list" items={localOptions} />')
  );
  check(
    'Demands: doc Word não força N/A no online',
    demands.includes("local: formDemand.trainingLocal || 'N/A',")
  );
  check(
    'Demands: DataView não força N/A no online',
    demands.includes("value={formDemand.trainingLocal || 'N/A'}")
  );
  check(
    'Demands: validação segue exigindo local só onde há logística',
    demands.includes('const needsLocal = requiresLogistics(formDemand.modality);')
  );
  // A regra do bypass geografico saiu do corpo de recommendInstructors para
  // domain/instructorRecommendation.ts (hasGeoAnchor), para a selecao de
  // ACOMPANHANTE usar a mesma classificacao da lista principal. A guarda
  // segue a regra ate a casa nova, e checa que o App consome de la — se
  // alguem reimplementar o bypass inline, as duas metades falham.
  check(
    'bypass geográfico (local N/A ou modalidade sem logística) mora no domínio',
    ler('domain/instructorRecommendation.ts').includes("if (demand.trainingLocal === 'N/A') return false;") &&
      ler('domain/instructorRecommendation.ts').includes('return requiresLogistics(demand.modality);')
  );
  check(
    'App: bypass geográfico cobre online (via hasGeoAnchor)',
    app.includes('hasGeoAnchor(demand as any, requiresLogistics)')
  );
  check(
    'App: leitura do banco ainda cai em N/A quando a coluna é nula',
    app.includes("trainingLocal: row.training_local ?? 'N/A',")
  );
  check(
    'CalendarView: agenda ainda esconde local N/A',
    calendar.includes("demand.trainingLocal !== 'N/A'")
  );
}

console.log(
  falhas === 0
    ? '\n✅ SMOKE LOCAL/ONLINE: tudo verde\n'
    : `\n❌ SMOKE LOCAL/ONLINE: ${falhas} falha(s)\n`
);
process.exit(falhas === 0 ? 0 : 1);
