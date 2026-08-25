/**
 * SMOKE — Demanda interna na Central de Notificações
 *
 * Rodar com:  npm run smoke:notificacoes
 *
 * Cobre as duas metades da auditoria de interna nas notificações:
 *
 *  [1..5] GATILHOS — qual bloco dispara para uma interna e qual não dispara,
 *         rodando os predicados reais de domain/notificationAlerts (os mesmos
 *         que Notifications.tsx consome).
 *  [6]    TEXTO — o par empresa/título de cada linha de alerta, com interna COM
 *         empresa e SEM empresa, pelos builders de domain/demandLabel.
 *  [7]    NAVEGAÇÃO — para qual tela o clique manda cada tipo de demanda.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import {
  hasPendingLogistics,
  hasPendingEvidence,
  isAwaitingInstructor,
  hasPendingMeasurement,
  demandListView,
  type DemandAlertContext,
} from '../domain/notificationAlerts';
import { getDemandTitle, getDemandCompanyLabel } from '../domain/demandLabel';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

function checkEq(nome: string, atual: unknown, esperado: unknown) {
  check(nome, atual === esperado, `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

/* ========================================================================== */
/* Fixture                                                                    */
/* ========================================================================== */

const companies = [{ id: 'EMP-1', name: 'Vale S.A.' }];
const trainings = [{ id: 'T80', name: 'NR 35 Trabalho em Altura' }];

/** Demanda de cliente — o controle de todas as comparações. */
const cliente: any = {
  id: 'DEM-100',
  tipo: 'cliente',
  companyId: 'EMP-1',
  trainingId: 'T80',
  instructorId: 'INST-A',
  status: 'CONCLUIDA',
};

/** Interna COM empresa vinculada (acontece no cliente). */
const internaComEmpresa: any = {
  id: 'DEM-200',
  tipo: 'interna',
  companyId: 'EMP-1',
  trainingId: '',
  instructorId: 'INST-A',
  status: 'CONCLUIDA',
  categoriaInterna: 'Visita',
  descricaoInterna: 'Vistoria de campo em Brucutu',
};

/** Interna SEM empresa — o caso mais comum (demanda da própria Colabor). */
const internaSemEmpresa: any = {
  id: 'DEM-201',
  tipo: 'interna',
  companyId: '',
  trainingId: '',
  instructorId: 'INST-A',
  status: 'CONCLUIDA',
  categoriaInterna: 'SIPAT',
  descricaoInterna: 'Apoio a SIPAT da unidade',
};

/** Interna é sempre PRESENCIAL por construção (o formulário nem oferece o campo). */
const ctx = (demand: any, over: Partial<DemandAlertContext> = {}): DemandAlertContext => ({
  demand,
  status: 'CONCLUIDA',
  modality: 'PRESENCIAL',
  ...over,
});

/* ========================================================================== */
/* [1] Bloco 1 — Pendências Logísticas: interna DISPARA                       */
/* ========================================================================== */

console.log('\n[1] Pendencias Logisticas: interna dispara igual a cliente');

const logPendente = { status: 'ALOCADA', logisticsStatus: 'PENDENTE' };
checkEq('cliente com logistica aberta dispara', hasPendingLogistics(ctx(cliente, logPendente)), true);
checkEq('interna com logistica aberta dispara', hasPendingLogistics(ctx(internaSemEmpresa, logPendente)), true);
checkEq('logistica CONCLUIDA nao dispara', hasPendingLogistics(ctx(internaSemEmpresa, { status: 'ALOCADA', logisticsStatus: 'CONCLUIDA' })), false);
checkEq('sem linha de logistica nao dispara', hasPendingLogistics(ctx(internaSemEmpresa, { status: 'ALOCADA', logisticsStatus: null })), false);
checkEq('demanda concluida nao dispara', hasPendingLogistics(ctx(internaSemEmpresa, { status: 'CONCLUIDA', logisticsStatus: 'PENDENTE' })), false);
checkEq('cancelada nao dispara', hasPendingLogistics(ctx({ ...internaSemEmpresa, status: 'CANCELADA' }, { status: 'CANCELADA', logisticsStatus: 'PENDENTE' })), false);

/* ========================================================================== */
/* [2] Bloco 2 — Evidência: interna fica FORA                                 */
/* ========================================================================== */

console.log('\n[2] Pendencias de Evidencia: interna NAO dispara (regressao do bug)');

// Lista de presença / certificado / foto de turma são documentação de
// treinamento de cliente. Evidences.tsx exclui interna da listagem, então o
// alerta era insolúvel: clicar levava a uma tela que devolvia lista vazia.
checkEq('cliente concluido com evidencia pendente dispara', hasPendingEvidence(ctx(cliente, { evidenceStatus: 'PENDENTE' })), true);
checkEq('interna SEM empresa nao dispara', hasPendingEvidence(ctx(internaSemEmpresa, { evidenceStatus: 'PENDENTE' })), false);
checkEq('interna COM empresa tambem nao dispara', hasPendingEvidence(ctx(internaComEmpresa, { evidenceStatus: 'PENDENTE' })), false);
checkEq('nem mesmo interna com evidencia COMPLETA aparece', hasPendingEvidence(ctx(internaComEmpresa, { evidenceStatus: 'COMPLETA' })), false);
checkEq('cliente com evidencia COMPLETA nao dispara', hasPendingEvidence(ctx(cliente, { evidenceStatus: 'COMPLETA' })), false);
checkEq('cliente nao concluido nao dispara', hasPendingEvidence(ctx(cliente, { status: 'ALOCADA', evidenceStatus: 'PENDENTE' })), false);

/* ========================================================================== */
/* [3] Bloco 3 — Alocação de instrutor: interna DISPARA                       */
/* ========================================================================== */

console.log('\n[3] Aguardando Alocacao: interna dispara');

const semInstrutor = { status: 'PENDENTE' };
checkEq('interna sem instrutor dispara', isAwaitingInstructor(ctx({ ...internaSemEmpresa, instructorId: '' }, semInstrutor)), true);
checkEq('interna com instrutor nao dispara', isAwaitingInstructor(ctx(internaSemEmpresa, semInstrutor)), false);
checkEq('instructorId so com espacos conta como vazio', isAwaitingInstructor(ctx({ ...internaSemEmpresa, instructorId: '   ' }, semInstrutor)), true);
checkEq('cliente sem instrutor dispara igual', isAwaitingInstructor(ctx({ ...cliente, instructorId: '' }, semInstrutor)), true);
checkEq('concluida nao dispara mais alocacao', isAwaitingInstructor(ctx({ ...internaSemEmpresa, instructorId: '' }, { status: 'CONCLUIDA' })), false);

/* ========================================================================== */
/* [4] Bloco 4 — Medição: interna DISPARA                                     */
/* ========================================================================== */

console.log('\n[4] Medicoes Pendentes: interna dispara');

checkEq('interna concluida com medicao NAO_INICIADA dispara', hasPendingMeasurement(ctx(internaSemEmpresa, { measurementStatus: 'NAO_INICIADA' })), true);
checkEq('interna sem linha de medicao dispara', hasPendingMeasurement(ctx(internaSemEmpresa, { measurementStatus: null })), true);
checkEq('medicao ja iniciada nao dispara', hasPendingMeasurement(ctx(internaSemEmpresa, { measurementStatus: 'EM_ANDAMENTO' })), false);
checkEq('interna sem instrutor nao dispara medicao', hasPendingMeasurement(ctx({ ...internaSemEmpresa, instructorId: '' }, { measurementStatus: 'NAO_INICIADA' })), false);
checkEq('cliente concluido dispara igual', hasPendingMeasurement(ctx(cliente, { measurementStatus: 'NAO_INICIADA' })), true);

/* ========================================================================== */
/* [5] Cancelada não gera pendência operacional em nenhum bloco               */
/* ========================================================================== */

console.log('\n[5] Interna cancelada fica fora dos 4 blocos de pendencia');

const cancelada = ctx({ ...internaSemEmpresa, status: 'CANCELADA' }, {
  status: 'CANCELADA',
  logisticsStatus: 'PENDENTE',
  evidenceStatus: 'PENDENTE',
  measurementStatus: 'NAO_INICIADA',
});
checkEq('logistica', hasPendingLogistics(cancelada), false);
checkEq('evidencia', hasPendingEvidence(cancelada), false);
checkEq('alocacao', isAwaitingInstructor({ ...cancelada, demand: { ...cancelada.demand, instructorId: '' } }), false);
checkEq('medicao', hasPendingMeasurement(cancelada), false);

/* ========================================================================== */
/* [6] TEXTO das linhas de alerta                                             */
/* ========================================================================== */

console.log('\n[6] Texto da linha: nada de "N/A" onde entraria empresa/treinamento');

// Era isto que a tela fazia, inline, antes da correção:
const builderAntigo = {
  titulo: (d: any) => trainings.find(t => t.id === d.trainingId)?.name || 'N/A',
  empresa: (d: any) => companies.find(c => c.id === d.companyId)?.name || 'N/A',
};

// Prova do defeito diagnosticado — as duas linhas da interna saíam "N/A".
checkEq('[antes] interna sem empresa: titulo era N/A', builderAntigo.titulo(internaSemEmpresa), 'N/A');
checkEq('[antes] interna sem empresa: empresa era N/A', builderAntigo.empresa(internaSemEmpresa), 'N/A');
checkEq('[antes] interna COM empresa: titulo ainda era N/A', builderAntigo.titulo(internaComEmpresa), 'N/A');

// Depois: os builders de domain/demandLabel, os mesmos que Logística, Controle
// Logístico, Medição e Agenda já usam.
checkEq('cliente: titulo é o nome do treinamento', getDemandTitle(cliente, trainings), 'NR 35 Trabalho em Altura');
checkEq('cliente: empresa é o nome da empresa', getDemandCompanyLabel(cliente, companies), 'Vale S.A.');

checkEq('interna SEM empresa: titulo vira categoria — descricao', getDemandTitle(internaSemEmpresa, trainings), 'SIPAT — Apoio a SIPAT da unidade');
checkEq('interna SEM empresa: empresa vira Colabor (Interna)', getDemandCompanyLabel(internaSemEmpresa, companies), 'Colabor (Interna)');

checkEq('interna COM empresa: titulo vira categoria — descricao', getDemandTitle(internaComEmpresa, trainings), 'Visita — Vistoria de campo em Brucutu');
checkEq('interna COM empresa: empresa é a empresa vinculada', getDemandCompanyLabel(internaComEmpresa, companies), 'Vale S.A.');

// Degradação: interna incompleta não pode voltar a "N/A" nem "undefined".
const internaSoCategoria: any = { id: 'DEM-202', tipo: 'interna', companyId: '', trainingId: '', categoriaInterna: 'Evento', descricaoInterna: '' };
checkEq('interna so com categoria usa a categoria', getDemandTitle(internaSoCategoria, trainings), 'Evento');
const internaVazia: any = { id: 'DEM-203', tipo: 'interna', companyId: '', trainingId: '' };
checkEq('interna sem categoria nem descricao tem fallback proprio', getDemandTitle(internaVazia, trainings), 'Demanda interna');
checkEq('interna com empresa excluida cai em Colabor (Interna)', getDemandCompanyLabel({ ...internaComEmpresa, companyId: 'EMP-SUMIU' }, companies), 'Colabor (Interna)');

check('nenhum texto de interna contem "N/A"',
  ![
    getDemandTitle(internaSemEmpresa, trainings),
    getDemandCompanyLabel(internaSemEmpresa, companies),
    getDemandTitle(internaComEmpresa, trainings),
    getDemandCompanyLabel(internaComEmpresa, companies),
    getDemandTitle(internaVazia, trainings),
  ].some(t => t.includes('N/A') || t.includes('undefined')));

/* ========================================================================== */
/* [7] NAVEGAÇÃO do clique                                                    */
/* ========================================================================== */

console.log('\n[7] Clique no alerta cai na tela que realmente lista a demanda');

// Demands.tsx mostra só cliente; InternalDemands.tsx só interna. Mandar interna
// para 'demands' filtrava a tela de cliente por um ID ausente = lista vazia.
checkEq('cliente vai para a tela de demandas', demandListView(cliente), 'demands');
checkEq('interna vai para a tela de demandas internas', demandListView(internaSemEmpresa), 'internal-demands');
checkEq('interna com empresa tambem vai para internas', demandListView(internaComEmpresa), 'internal-demands');
checkEq('demanda ausente cai no padrao de cliente', demandListView(undefined), 'demands');

console.log(falhas === 0 ? '\n✅ Todos os checks passaram.' : `\n❌ ${falhas} check(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
