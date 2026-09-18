/**
 * SMOKE — Modelos de medição por empresa: Fase 4 (registry e pendências)
 *
 * Chamado por smokeModelosMedicao.ts. Usa o `check` compartilhado.
 *
 *   [R4] `buildRegistry` com 0, 1 e 2 modelos; inativo fora; ordem por empresa;
 *        rótulo "Medição <Empresa>"; chave `tpl:<uuid>`; requiredView.
 *   [D]  Modelo ativo mas INCOMPLETO aparece DESABILITADO com o motivo — nunca
 *        some, e nunca aparece habilitado para falhar na geração.
 *   [N]  Pendências com letra e cabeçalho derivados de um template de fixture
 *        DIFERENTE do da Vale, para provar que nada ali é da Vale.
 *   [H]  E os textos da Vale continuam idênticos, palavra por palavra.
 *   [K]  Checagens: lista fechada, default por mapeamento, recorte explícito.
 *   [X]  Bloqueios de configuração: campo extinto e fórmula órfã travam
 *        `podeGerar`, no gerar E no salvar.
 */
import {
  buildRegistry,
  EXPORT_DATASETS,
  getDataset,
  isTemplateDataset,
  motivoIndisponivel,
  visibleDatasets,
  type TemplateDatasetDef,
} from '../domain/exports/registry';
import { isDatasetDeEmpresa } from '../domain/exports/types';
import {
  avaliarConfiguracao,
  buildPendencias,
  checksAplicaveis,
  TEMPLATE_CHECKS,
  type TemplateCheckKey,
} from '../domain/exports/pendencias';
import { validarTemplate, bloqueiosDe } from '../domain/exports/templates/validate';
import { buildTemplateMapping, templateFromRecord, type TemplateRecord } from '../domain/exports/templates/mapping';
import { bloqueiosParaSalvar, salvarMapeamento, type TemplateStoreGateway } from '../domain/exports/templates/store';
import { emptyTemplateValuesIndex, indexTemplateValues } from '../domain/exports/templates/values';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import type { MeasurementTemplate, TemplateSheet } from '../domain/exports/templates/types';

interface Tools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
}

/* ───────────────────────────── fixtures ───────────────────────────── */

/** Um mapeamento completo e sadio, propositalmente NADA parecido com o da Vale. */
const mapeamentoBom = (over: Partial<Record<string, unknown>> = {}) =>
  buildTemplateMapping({
    v: 1,
    sheetName: 'Serviços',
    headerRow: 2,
    firstDataRow: 3,
    columns: [
      { key: 'servico', header: 'Serviço Prestado', origem: 'campo', campo: 'training.name', formato: 'text' },
      { key: 'pedido', header: 'Ordem de Compra', origem: 'campo', campo: 'demand.clientDemandId', formato: 'text', destacarVazio: true },
      { key: 'horas', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
      { key: 'tarifa', header: 'Tarifa Hora', origem: 'digitado', escopo: 'training', formato: 'currency', destacarVazio: true },
      { key: 'valor', header: 'Valor', origem: 'calculado', formato: 'currency', formula: { op: 'multiplicar', a: { coluna: 'horas' }, b: { coluna: 'tarifa' } } },
    ],
    constants: [],
    totals: ['valor'],
    ...(over as any),
  });

const registro = (over: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: '11111111-1111-1111-1111-111111111111',
  companyId: 'C1',
  companyName: 'Gerdau',
  name: 'Padrão 2027',
  mapping: mapeamentoBom(),
  isActive: true,
  storageBucket: 'measurement-templates',
  storagePath: 'templates/C1/1/modelo.xlsx',
  ...over,
});

const templateDe = (over: Partial<TemplateRecord> = {}): MeasurementTemplate =>
  templateFromRecord(registro(over)).template;

/** As linhas do painel, no formato mínimo que `buildPendencias` lê. */
const linhaPainel = (over: any = {}) => ({
  demand: { id: over.id ?? 'DEM-1' } as any,
  measurement: undefined,
  input: {
    demandId: over.id ?? 'DEM-1',
    clientDemandId: over.clientDemandId ?? '',
    companyName: 'Gerdau',
    trainingId: 'T1',
    trainingName: 'NR 35',
    cargaHoraria: 16,
    local: 'Itabira',
    corredor: 'Sudeste',
    uf: 'MG',
    dataInicio: '2026-08-10',
    horarioInicio: '08:00',
    nDias: 2,
    statusCalculado: 'CONCLUIDA',
    titulares: ['Titular'],
    despesas: { locomocao: 0, alimentacao: 0, hospedagem: 0, outros: 0, total: 0 },
    medicaoStatus: over.medicaoStatus ?? 'PRONTA_FATURAMENTO',
    temMedicao: over.temMedicao ?? true,
  },
  refs: { demandId: over.id ?? 'DEM-1', trainingId: 'T1' },
  companyName: 'Gerdau',
  trainingId: 'T1',
  titularIds: ['I1'],
  statusCalculado: 'CONCLUIDA',
  cancelada: false,
  interna: false,
  medicaoStatus: over.medicaoStatus ?? 'PRONTA_FATURAMENTO',
  despesasTotalTodas: 0,
  naoReembolsavelExcluido: over.naoReembolsavelExcluido ?? 0,
  itensDespesa: 1,
  bloqueios: [],
  elegivelTurmas: true,
  ...over.extra,
}) as any;

export function runRegistryChecks(t: Tools): void {
  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[R4] buildRegistry — 0, 1 e 2 modelos');
  {
    const vazio = buildRegistry([]);
    t.eq('buildRegistry([]) é IDÊNTICO a EXPORT_DATASETS (chaves)',
      vazio.map(d => d.key), EXPORT_DATASETS.map(d => d.key));
    t.check('e são os mesmos objetos, não cópias', vazio.every((d, i) => d === EXPORT_DATASETS[i]));
    t.eq('os sete de código continuam na ordem de sempre', vazio.map(d => d.key),
      ['medicoes', 'demandas', 'logistica', 'instrutores', 'despesas', 'medicao-vale', 'vale-bm']);

    const gerdau = templateDe({ id: 'aaa', companyId: 'C1', companyName: 'Gerdau' });
    const um = buildRegistry([gerdau]);
    t.eq('um modelo entra DEPOIS dos de código', um.length, EXPORT_DATASETS.length + 1);
    t.eq('e é o último', um[um.length - 1].key, 'tpl:aaa');
    t.eq('rótulo vem da EMPRESA', um[um.length - 1].label, 'Medição Gerdau');
    t.check('a chave é do formato tpl:<uuid>', isDatasetDeEmpresa(um[um.length - 1].key));
    t.eq('requiredView measurement', um[um.length - 1].requiredView, 'measurement');
    t.check('é entrada de template', isTemplateDataset(um[um.length - 1]));

    // Dois, fora de ordem alfabética na entrada.
    const csn = templateDe({ id: 'bbb', companyId: 'C2', companyName: 'CSN' });
    const usiminas = templateDe({ id: 'ccc', companyId: 'C3', companyName: 'Usiminas' });
    const dois = buildRegistry([usiminas, csn]);
    t.eq('dois modelos saem ordenados pelo nome da empresa',
      dois.slice(EXPORT_DATASETS.length).map(d => d.label), ['Medição CSN', 'Medição Usiminas']);
    t.eq('e os de código continuam intocados na frente',
      dois.slice(0, EXPORT_DATASETS.length).map(d => d.key), EXPORT_DATASETS.map(d => d.key));

    // Ordenação em pt-BR: acento não joga a empresa para o fim.
    const acento = buildRegistry([
      templateDe({ id: 'd1', companyName: 'Zurich' }),
      templateDe({ id: 'd2', companyName: 'Ácido Ltda' }),
      templateDe({ id: 'd3', companyName: 'Braskem' }),
    ]);
    t.eq('ordem em pt-BR, com acento no lugar certo',
      acento.slice(EXPORT_DATASETS.length).map(d => d.label),
      ['Medição Ácido Ltda', 'Medição Braskem', 'Medição Zurich']);

    // Só ativo. `buildRegistry` recebe TEMPLATES, e quem filtra por ativo é
    // quem os busca (fetchActiveMeasurementTemplates); aqui se prova que um
    // template que não é do banco nunca entra.
    const intruso = { ...VALE_TEMPLATE };
    t.eq('template de CÓDIGO passado por engano não vira módulo duplicado',
      buildRegistry([intruso]).length, EXPORT_DATASETS.length);

    // getDataset com a lista.
    t.eq('getDataset acha o módulo da empresa na lista', getDataset('tpl:aaa', um).label, 'Medição Gerdau');
    t.eq('getDataset sem lista continua achando os de código', getDataset('demandas').key, 'demandas');
    let lancou = false;
    try { getDataset('tpl:aaa' as any); } catch { lancou = true; }
    t.check('getDataset sem a lista NÃO acha o módulo da empresa (é erro, não silêncio)', lancou);

    // visibleDatasets com a lista.
    const analista = new Set(['dashboard', 'demands', 'internal-demands', 'calendar', 'logistics', 'logistics-control', 'exportacoes']);
    t.eq('analista não vê modelo de empresa (requiredView measurement)',
      visibleDatasets(v => analista.has(v), dois).map(d => d.key), ['demandas', 'logistica', 'instrutores']);
    const admin = new Set([...analista, 'measurement']);
    t.eq('admin vê os sete de código mais os dois de empresa',
      visibleDatasets(v => admin.has(v), dois).map(d => d.key).slice(-2), ['tpl:bbb', 'tpl:ccc']);

    // O laço que itera colunas não estoura no kind template vindo do banco.
    let estourou = false;
    try {
      for (const d of dois) {
        if (isTemplateDataset(d)) continue;
        void d.columns.map(c => c.key);
      }
    } catch { estourou = true; }
    t.check('o laço de colunas dos smokes não estoura com módulo do banco', !estourou);
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[D] Modelo incompleto aparece DESABILITADO, com o motivo');
  {
    const completo = templateDe();
    t.eq('modelo pronto não tem motivo', motivoIndisponivel(completo), null);
    t.check('e não traz `indisponivel`',
      (buildRegistry([completo]).pop() as TemplateDatasetDef).indisponivel === undefined);

    const semArquivo = templateDe({ storagePath: undefined, storageBucket: undefined });
    t.check('sem planilha-base: motivo diz o que enviar',
      (motivoIndisponivel(semArquivo) ?? '').includes('planilha-base'), String(motivoIndisponivel(semArquivo)));

    const semMapeamento = templateDe({ mapping: {} });
    t.check('sem mapeamento: motivo diz o que configurar',
      (motivoIndisponivel(semMapeamento) ?? '').includes('mapeamento'), String(motivoIndisponivel(semMapeamento)));

    const quebrado = templateDe({
      mapping: mapeamentoBom({
        columns: [
          { key: 'a', header: 'Serviço', origem: 'campo', campo: 'demand.sumiu' },
          { key: 'b', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria' },
        ],
        totals: [],
      }),
    });
    const motivo = motivoIndisponivel(quebrado) ?? '';
    t.check('mapeamento quebrado: motivo nomeia a coluna em português',
      motivo.includes('«Serviço»') && motivo.includes('não existe mais no sistema'), motivo);

    // O ponto da decisão: APARECE, desabilitado.
    const reg = buildRegistry([semArquivo, quebrado, completo]);
    const doBanco = reg.slice(EXPORT_DATASETS.length) as TemplateDatasetDef[];
    t.eq('os TRÊS aparecem na lista — nenhum some', doBanco.length, 3);
    t.eq('dois desabilitados, um habilitado',
      doBanco.map(d => !!d.indisponivel).sort(), [false, true, true]);
    t.check('a descrição do desabilitado repete o motivo (a tela não precisa montar texto)',
      doBanco.filter(d => d.indisponivel).every(d => d.description.includes(d.indisponivel!)));
    t.check('NENHUM módulo aparece habilitado com o modelo quebrado',
      doBanco.every(d => !d.indisponivel === (motivoIndisponivel(d.template) === null)));
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[N] Pendências derivadas de um template que não é o da Vale');
  {
    const template = templateDe();
    const sheet = template.sheets[0];
    const ctx = {
      sheet,
      template,
      templateValues: emptyTemplateValuesIndex(),
      logisticAllocations: [],
      logisticBlocks: [],
    };

    // Sem a Ordem de Compra (coluna B) e sem a Tarifa (coluna D).
    const p = buildPendencias([linhaPainel({ id: 'DEM-1' })], ctx);
    const textos = p[0].pendencias.map(x => x.texto);
    t.check('o identificador do cliente é chamado pelo CABEÇALHO do arquivo',
      textos.includes('Sem Ordem de Compra (célula B em branco)'), JSON.stringify(textos));
    t.check('a coluna digitada obrigatória também, com a letra da posição real',
      textos.includes('Sem Tarifa Hora (célula D em branco)'), JSON.stringify(textos));
    t.check('nenhum texto menciona a Vale, ID SAP ou preço HH',
      !textos.some(x => /Vale|ID SAP|preço unitário HH/i.test(x)), JSON.stringify(textos));

    // Item não reembolsável usa o rótulo do modelo.
    const comSobra = buildPendencias([linhaPainel({ id: 'DEM-2', naoReembolsavelExcluido: 30 })], ctx);
    t.check('o excluído cita o rótulo do modelo, não "da Vale"',
      comSobra[0].pendencias.some(x => x.texto === 'Item não reembolsável fora das colunas de Medição Gerdau (R$ 30,00)'),
      JSON.stringify(comSobra[0].pendencias.map(x => x.texto)));

    // Repetido usa o cabeçalho.
    const repetidos = buildPendencias(
      [linhaPainel({ id: 'DEM-3', clientDemandId: 'OC-9' }), linhaPainel({ id: 'DEM-4', clientDemandId: 'OC-9' })],
      ctx
    );
    t.check('o repetido também vem do cabeçalho',
      repetidos[0].pendencias.some(x => x.texto === 'Ordem de Compra repetido em outra demanda do recorte (OC-9)'),
      JSON.stringify(repetidos[0].pendencias.map(x => x.texto)));

    // Com a tarifa preenchida por treinamento, a pendência some.
    const comTarifa = buildPendencias([linhaPainel({ id: 'DEM-5', clientDemandId: 'OC-1' })], {
      ...ctx,
      templateValues: indexTemplateValues([
        { scope: 'training', column_key: 'tarifa', training_id: 'T1', demand_id: null, value: 150 },
      ]),
    });
    t.eq('tarifa preenchida: sem pendência nenhuma', comTarifa.length, 0);

    // A LETRA vem da POSIÇÃO: a mesma coluna, movida para a frente, muda de
    // letra no texto. É o que separa "derivado" de "escrito à mão".
    const reordenado = templateDe({
      mapping: mapeamentoBom({
        columns: [
          { key: 'pedido', header: 'Ordem de Compra', origem: 'campo', campo: 'demand.clientDemandId', formato: 'text' },
          { key: 'horas', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
          { key: 'servico', header: 'Serviço Prestado', origem: 'campo', campo: 'training.name', formato: 'text' },
        ],
        totals: [],
      }),
    });
    const pr = buildPendencias([linhaPainel({ id: 'DEM-6' })], {
      ...ctx, sheet: reordenado.sheets[0], template: reordenado,
    });
    t.check('a mesma coluna movida para a 1ª posição passa a dizer "célula A"',
      pr[0].pendencias.some(x => x.texto === 'Sem Ordem de Compra (célula A em branco)'),
      JSON.stringify(pr[0].pendencias.map(x => x.texto)));
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[K] Checagens: lista fechada e recorte por mapeamento');
  {
    t.eq('são sete, e só sete', TEMPLATE_CHECKS.length, 7);

    const comId = templateDe();
    t.eq('com coluna de identificador, todas as sete se aplicam',
      checksAplicaveis(comId.sheets[0]).length, 7);

    const semId = templateDe({
      mapping: mapeamentoBom({
        columns: [
          { key: 'servico', header: 'Serviço', origem: 'campo', campo: 'training.name' },
          { key: 'horas', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria' },
        ],
        totals: [],
      }),
    });
    const aplicaveis = checksAplicaveis(semId.sheets[0]);
    t.eq('sem coluna de identificador, as duas que falam dele saem',
      aplicaveis.includes('semIdCliente') || aplicaveis.includes('idClienteRepetido'), false);
    t.eq('e sobram cinco', aplicaveis.length, 5);

    const p = buildPendencias([linhaPainel({ id: 'DEM-7' })], {
      sheet: semId.sheets[0], template: semId,
      templateValues: emptyTemplateValuesIndex(), logisticAllocations: [], logisticBlocks: [],
    });
    t.check('e nenhuma pendência fala de identificador',
      !(p[0]?.pendencias ?? []).some(x => /Ordem de Compra|ID/i.test(x.texto)),
      JSON.stringify(p[0]?.pendencias?.map(x => x.texto) ?? []));

    // Recorte explícito: só uma checagem.
    const so: TemplateCheckKey[] = ['semMedicao'];
    const um = buildPendencias([linhaPainel({ id: 'DEM-8', temMedicao: false })], {
      sheet: comId.sheets[0], template: comId, checks: so,
      templateValues: emptyTemplateValuesIndex(), logisticAllocations: [], logisticBlocks: [],
    });
    t.eq('com checks explícito, só o que foi pedido aparece',
      um[0].pendencias.map(x => x.texto), ['Sem medição aberta']);
  }

  /* ──────────────────────────────────────────────────────────────────── */
  console.log('\n[X] Bloqueios de configuração travam podeGerar (gerar e salvar)');
  {
    const sadio = templateDe();
    const okConfig = avaliarConfiguracao(sadio);
    t.eq('modelo sadio gera', okConfig.podeGerar, true);
    t.eq('e não tem fato nenhum', okConfig.pendencias.filter(p => p.tipo === 'fato'), []);

    // (a) campo extinto
    const campoExtinto = templateDe({
      mapping: mapeamentoBom({
        columns: [
          { key: 'servico', header: 'Serviço Prestado', origem: 'campo', campo: 'demand.campoQueSumiu' },
          { key: 'horas', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria' },
        ],
        totals: [],
      }),
    });
    const c1 = avaliarConfiguracao(campoExtinto);
    t.eq('campo extinto: NÃO gera', c1.podeGerar, false);
    t.check('e é FATO, não aviso',
      c1.pendencias.some(p => p.tipo === 'fato' && p.texto.includes('«Serviço Prestado»') && p.texto.includes('não existe mais no sistema')),
      JSON.stringify(c1.pendencias));

    // (b) fórmula sobre coluna removida
    const formulaOrfa = templateDe({
      mapping: mapeamentoBom({
        columns: [
          { key: 'horas', header: 'Horas', origem: 'campo', campo: 'demand.cargaHoraria' },
          { key: 'valor', header: 'Valor', origem: 'calculado', formula: { op: 'multiplicar', a: { coluna: 'horas' }, b: { coluna: 'tarifaApagada' } } },
        ],
        totals: [],
      }),
    });
    const c2 = avaliarConfiguracao(formulaOrfa);
    t.eq('fórmula órfã: NÃO gera', c2.podeGerar, false);
    t.check('e o fato nomeia a coluna e a referência perdida',
      c2.pendencias.some(p => p.tipo === 'fato' && p.texto.includes('«Valor»') && p.texto.includes('«tarifaApagada»')),
      JSON.stringify(c2.pendencias));

    // (c) Total órfão: DUAS defesas, em camadas diferentes.
    //     Na leitura do mapeamento ele é REMOVIDO com aviso (mapping.ts), então
    //     nem chega a virar template — por isso o modelo abaixo ainda gera.
    const totalOrfao = templateDe({ mapping: mapeamentoBom({ totals: ['naoExiste'] }) });
    t.eq('total órfão é limpo na leitura do mapeamento', totalOrfao.sheets[0].totals, undefined);
    t.eq('e por isso o modelo continua gerando', avaliarConfiguracao(totalOrfao).podeGerar, true);
    //     A validação é a rede de baixo: um template montado por outro caminho
    //     (código, ou uma versão futura do mapeamento) com total órfão trava.
    const montadoNaMao: MeasurementTemplate = {
      ...totalOrfao,
      sheets: [{ ...totalOrfao.sheets[0], totals: { sumColumns: ['naoExiste'] } }],
    };
    t.eq('total sobre coluna inexistente bloqueia na validação', avaliarConfiguracao(montadoNaMao).podeGerar, false);
    t.check('e o texto nomeia a coluna',
      avaliarConfiguracao(montadoNaMao).pendencias.some(p => p.tipo === 'fato' && p.texto.includes('«naoExiste»')));

    // (d) a Vale continua gerando
    t.eq('a Vale passa na validação', validarTemplate(VALE_TEMPLATE).podeGerar, true);
    t.eq('e sem bloqueio nenhum', bloqueiosDe(validarTemplate(VALE_TEMPLATE)), []);

    /* NO SALVAR: o mesmo defeito é recusado ANTES de gravar. */
    t.eq('salvar um mapeamento sadio: sem bloqueio', bloqueiosParaSalvar(registro()), []);

    const mapCampoExtinto = mapeamentoBom({
      columns: [{ key: 'servico', header: 'Serviço Prestado', origem: 'campo', campo: 'demand.campoQueSumiu' }],
      totals: [],
    });
    const bloqueios = bloqueiosParaSalvar(registro({ mapping: mapCampoExtinto }));
    t.check('salvar com campo extinto: bloqueado, com o texto em português',
      bloqueios.length === 1 && bloqueios[0].includes('«Serviço Prestado»'), JSON.stringify(bloqueios));

    const mapFormulaOrfa = mapeamentoBom({
      columns: [
        { key: 'valor', header: 'Valor', origem: 'calculado', formula: { op: 'multiplicar', a: { coluna: 'horas' }, b: { coluna: 'tarifa' } } },
      ],
      totals: [],
    });
    t.check('salvar com fórmula sobre coluna que o mapeamento não tem: bloqueado',
      bloqueiosParaSalvar(registro({ mapping: mapFormulaOrfa })).some(b => b.includes('«Valor»')));
  }
}

/**
 * A orquestração do salvar recusa de verdade, sem tocar no gateway. Separada
 * por ser assíncrona — o runner a aguarda.
 */
export async function runSalvarChecks(t: Tools): Promise<void> {
  console.log('\n[X] salvarMapeamento recusa modelo quebrado antes de gravar');

  let gravou = false;
  const gateway: TemplateStoreGateway = {
    async list() { return [registro()]; },
    async insert() { throw new Error('insert não deveria ser chamado'); },
    async update() { gravou = true; return registro(); },
    async setActive() { throw new Error('setActive não deveria ser chamado'); },
    async deactivate() { throw new Error('deactivate não deveria ser chamado'); },
    async remove() { throw new Error('remove não deveria ser chamado'); },
  };

  const quebrado = mapeamentoBom({
    columns: [
      { key: 'valor', header: 'Valor', origem: 'calculado', formula: { op: 'multiplicar', a: { coluna: 'horas' }, b: { coluna: 'tarifa' } } },
    ],
    totals: [],
  });

  let mensagem = '';
  try {
    await salvarMapeamento(gateway, [registro()], registro().id, { mapping: quebrado });
  } catch (e: any) {
    mensagem = e.message;
  }
  t.check('recusou', mensagem.includes('não pode ser salvo'), mensagem || '(não lançou)');
  t.check('e a mensagem nomeia a coluna', mensagem.includes('«Valor»'), mensagem);
  t.check('e o gateway NÃO foi chamado', !gravou);

  // O caminho feliz grava.
  gravou = false;
  const ok = await salvarMapeamento(gateway, [registro()], registro().id, { mapping: mapeamentoBom() });
  t.check('mapeamento sadio grava normalmente', gravou);
  t.eq('e devolve a mensagem da tela', ok.mensagem, 'Mapeamento salvo.');
}

/* ─────────────── [H] a Vale, palavra por palavra ─────────────── */

/**
 * O teste que autoriza tudo acima. `smoke:medicao-vale` já prende estes textos
 * caractere a caractere e continua verde; aqui se prova o que ele NÃO cobre:
 * que passar `template: VALE_TEMPLATE` no contexto — o que a tela passará a
 * fazer — não muda um caractere, e que os quatro textos históricos seguem de pé
 * mesmo com o mecanismo de derivação ligado.
 */
export function runValeTextosChecks(t: Tools): void {
  console.log('\n[H] Os textos da Vale, palavra por palavra');
  const sheet: TemplateSheet = VALE_TEMPLATE.sheets[0];
  const base = {
    sheet,
    templateValues: emptyTemplateValuesIndex(),
    logisticAllocations: [],
    logisticBlocks: [],
  };

  const rows = [
    linhaPainel({ id: 'DEM-100', clientDemandId: 'SAP-1', naoReembolsavelExcluido: 30 }),
    linhaPainel({ id: 'DEM-101', clientDemandId: 'SAP-1' }),
    linhaPainel({ id: 'DEM-102', clientDemandId: '' }),
  ];

  const semTemplate = buildPendencias(rows, base);
  const comTemplate = buildPendencias(rows, { ...base, template: VALE_TEMPLATE });

  const textos = (p: any[]) => p.map(x => x.pendencias.map((y: any) => `${y.tipo}:${y.texto}`));
  t.eq('passar o template de CÓDIGO no contexto não muda um caractere',
    textos(comTemplate), textos(semTemplate));

  const todos = semTemplate.flatMap(p => p.pendencias.map((x: any) => x.texto));
  t.check('o aviso de ID continua "Sem ID SAP / Pedido Cliente (célula B em branco)"',
    todos.includes('Sem ID SAP / Pedido Cliente (célula B em branco)'), JSON.stringify(todos));
  t.check('o aviso de preço continua "Sem preço unitário HH (célula H em branco)"',
    todos.includes('Sem preço unitário HH (célula H em branco)'), JSON.stringify(todos));
  t.check('o excluído continua "fora das colunas da Vale"',
    todos.some(x => x.includes('fora das colunas da Vale')), JSON.stringify(todos));
  t.check('o repetido continua começando por "ID SAP repetido"',
    todos.some(x => x.startsWith('ID SAP repetido em outra demanda do recorte')), JSON.stringify(todos));
  t.check('e NENHUM texto da Vale virou o cabeçalho "ID da Turma"',
    !todos.some(x => x.includes('ID da Turma')), JSON.stringify(todos));
}
