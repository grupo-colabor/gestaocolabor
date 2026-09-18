/**
 * SMOKE — Modelos de medição por empresa: Fase 3 (banco, CRUD e arquivo-base)
 *
 * Chamado por smokeModelosMedicao.ts. Usa o `check` compartilhado.
 *
 *   [S] CRUD com gateway EM MEMÓRIA: criar, renomear, duplicar, ativar,
 *       desativar, excluir. A troca de ativo é UMA operação e o gateway
 *       verifica, a cada escrita, que a empresa nunca tem dois ativos nem
 *       fica sem ativo no meio de uma troca.
 *   [V] Registro inválido entra na lista COM aviso e não derruba os sadios.
 *   [P] Caminho do Storage: nome com acento, espaço e símbolo vira key segura;
 *       a guarda de bytes roda ANTES do upload.
 *   [B] Arquivo-base: `baseFileFrom: 'storage'` usa o loader; a Vale continua
 *       no caminho público, sem loader.
 *   [G] Impressão digital do arquivo-base: troca de coluna é detectada e dita.
 *   [Q] Migration 022: o arquivo existe e diz o que foi combinado.
 */
import fs from 'fs';
import path from 'path';

import {
  ativarModelo,
  criarModelo,
  desativarModelo,
  duplicarModelo,
  excluirModelo,
  listarModelos,
  listarModelosAtivos,
  loadTemplates,
  modeloPrecisaConserto,
  modeloUtilizavel,
  nomeDaCopia,
  planejarExclusao,
  podeApagarArquivo,
  problemaNoNome,
  renomearModelo,
  salvarMapeamento,
  type ModeloPatch,
  type NovoModelo,
  type TemplateStoreGateway,
} from '../domain/exports/templates/store';
import {
  buildBaseFingerprint,
  buildTemplateMapping,
  compareBaseFingerprint,
  parseBaseFingerprint,
  type TemplateMapping,
  type TemplateRecord,
} from '../domain/exports/templates/mapping';
import {
  assertXlsx,
  buildTemplateStoragePath,
  sanitizeFileName,
  TemplateFileError,
} from '../services/exports/templateFile';
import { fetchTemplateBaseFile } from '../services/exports/templateXlsxWriter';
import { VALE_TEMPLATE } from '../domain/exports/templates/vale';
import type { MeasurementTemplate } from '../domain/exports/templates/types';

interface Tools {
  check: (nome: string, condicao: boolean, detalhe?: string) => void;
  eq: (nome: string, atual: unknown, esperado: unknown) => void;
}

/* ─────────────────────── gateway em memória, vigiado ─────────────────────── */

/**
 * Faz o papel do banco E do índice único parcial da 022. Além disso GUARDA a
 * invariante em toda escrita: uma empresa nunca pode ter dois ativos, e uma
 * troca de ativo nunca pode deixar a empresa sem nenhum. É o que prova que o
 * domínio não oferece o caminho de duas etapas.
 */
function memGateway(iniciais: TemplateRecord[] = []) {
  const linhas = new Map<string, TemplateRecord>(iniciais.map(r => [r.id, { ...r }]));
  let seq = iniciais.length;
  const violacoes: string[] = [];
  /** Empresas que já tiveram um ativo — depois disso, ficar sem é suspeito. */
  const jaTeveAtivo = new Set<string>();
  let chamadas = 0;

  const conferir = (contexto: string, exigirAtivo: boolean) => {
    const porEmpresa = new Map<string, TemplateRecord[]>();
    for (const r of linhas.values()) {
      porEmpresa.set(r.companyId, [...(porEmpresa.get(r.companyId) ?? []), r]);
    }
    for (const [empresa, rs] of porEmpresa) {
      const ativos = rs.filter(r => r.isActive);
      if (ativos.length > 1) violacoes.push(`${contexto}: ${empresa} ficou com ${ativos.length} ativos`);
      if (ativos.length === 1) jaTeveAtivo.add(empresa);
      if (exigirAtivo && ativos.length === 0 && jaTeveAtivo.has(empresa)) {
        violacoes.push(`${contexto}: ${empresa} ficou SEM ativo`);
      }
    }
  };

  const gateway: TemplateStoreGateway = {
    async list(companyId?: string) {
      chamadas++;
      return [...linhas.values()]
        .filter(r => !companyId || r.companyId === companyId)
        .sort((a, b) => a.companyId.localeCompare(b.companyId) || a.name.localeCompare(b.name));
    },
    async insert(n: NovoModelo) {
      chamadas++;
      const id = `tpl-${++seq}`;
      // Como no banco: um modelo nasce ativo; se a empresa já tem um ativo, o
      // índice único recusaria — então o primeiro é ativo e os demais não.
      const jaAtivo = [...linhas.values()].some(r => r.companyId === n.companyId && r.isActive);
      const rec: TemplateRecord = {
        id,
        companyId: n.companyId,
        companyName: n.companyName,
        name: n.name,
        mapping: {},
        isActive: !jaAtivo,
      };
      linhas.set(id, rec);
      conferir('insert', false);
      return { ...rec };
    },
    async update(id: string, patch: ModeloPatch) {
      chamadas++;
      const atual = linhas.get(id);
      if (!atual) throw new Error('Modelo não atualizado: nenhuma linha afetada.');
      const novo: TemplateRecord = { ...atual };
      if (patch.name !== undefined) novo.name = patch.name;
      if (patch.mapping !== undefined) novo.mapping = patch.mapping;
      if (patch.sheetName !== undefined) novo.sheetName = patch.sheetName;
      if (patch.headerRow !== undefined) novo.headerRow = patch.headerRow;
      if (patch.firstDataRow !== undefined) novo.firstDataRow = patch.firstDataRow;
      if (patch.storageBucket !== undefined) novo.storageBucket = patch.storageBucket ?? undefined;
      if (patch.storagePath !== undefined) novo.storagePath = patch.storagePath ?? undefined;
      if (patch.baseFingerprint !== undefined) novo.baseFingerprint = patch.baseFingerprint;
      linhas.set(id, novo);
      conferir('update', false);
      return { ...novo };
    },
    async setActive(id: string) {
      chamadas++;
      const alvo = linhas.get(id);
      if (!alvo) throw new Error('Modelo não encontrado.');
      // ATÔMICO, como a função da 022: as duas mudanças acontecem antes de
      // qualquer observador enxergar o meio do caminho.
      for (const r of linhas.values()) {
        if (r.companyId === alvo.companyId && r.id !== id && r.isActive) {
          linhas.set(r.id, { ...r, isActive: false });
        }
      }
      linhas.set(id, { ...alvo, isActive: true });
      conferir('setActive', true);
      return { ...linhas.get(id)! };
    },
    async deactivate(id: string) {
      chamadas++;
      const atual = linhas.get(id);
      if (!atual) throw new Error('Modelo não encontrado.');
      linhas.set(id, { ...atual, isActive: false });
      conferir('deactivate', false);
      return { ...linhas.get(id)! };
    },
    async remove(id: string) {
      chamadas++;
      if (!linhas.delete(id)) throw new Error('Modelo não excluído: nenhuma linha afetada.');
      conferir('remove', false);
    },
  };

  return {
    gateway,
    linhas,
    violacoes,
    todos: () => [...linhas.values()],
    chamadas: () => chamadas,
  };
}

const MAPEAMENTO: TemplateMapping = buildTemplateMapping({
  v: 1,
  sheetName: 'Medição',
  headerRow: 3,
  firstDataRow: 4,
  columns: [
    { key: 'trein', header: 'Descrição do Serviço', origem: 'campo', campo: 'training.name', formato: 'text' },
    { key: 'qtd', header: 'Qtd', origem: 'campo', campo: 'demand.cargaHoraria', formato: 'hours' },
    { key: 'preco', header: 'Valor Unit.', origem: 'digitado', escopo: 'training', sobrescreverNaTurma: true, formato: 'currency' },
    { key: 'total', header: 'Total', origem: 'calculado', formato: 'currency', formula: { op: 'multiplicar', a: { coluna: 'qtd' }, b: { coluna: 'preco' } } },
  ],
  constants: [],
  totals: ['total'],
});

export async function runStoreChecks(t: Tools): Promise<void> {
  const raiz = process.cwd();

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[S] CRUD com gateway em memória');
  {
    const m = memGateway();

    let r = await criarModelo(m.gateway, m.todos(), { companyId: 'C1', companyName: 'Gerdau', name: '  Padrão 2027  ' });
    t.eq('criar: nome com espaço das pontas é aparado', m.todos()[0].name, 'Padrão 2027');
    t.eq('criar: mensagem para a tela', r.mensagem, 'Modelo "Padrão 2027" criado.');
    t.eq('criar: o primeiro da empresa nasce ativo', m.todos()[0].isActive, true);

    // Nome inválido e repetido não chegam ao banco.
    t.eq('nome vazio tem motivo', problemaNoNome('   '), 'Dê um nome ao modelo.');
    t.eq('nome longo demais tem motivo', problemaNoNome('x'.repeat(121))?.includes('passa de 120'), true);
    let lancou = false;
    try { await criarModelo(m.gateway, m.todos(), { companyId: 'C1', companyName: 'Gerdau', name: 'padrão 2027' }); }
    catch (e: any) { lancou = e.message.includes('Já existe um modelo'); }
    t.check('criar com nome repetido (ignorando caixa) é recusado antes do banco', lancou);

    // Mapeamento.
    await salvarMapeamento(m.gateway, m.todos(), m.todos()[0].id, {
      mapping: MAPEAMENTO,
      sheetName: 'Medição',
      headerRow: 3,
      firstDataRow: 4,
      storageBucket: 'measurement-templates',
      storagePath: 'templates/C1/tpl-1/modelo.xlsx',
    });
    t.eq('mapeamento gravado', (m.todos()[0].mapping as TemplateMapping).sheetName, 'Medição');

    // Renomear.
    await renomearModelo(m.gateway, m.todos(), m.todos()[0].id, 'Padrão Gerdau');
    t.eq('renomeado', m.todos()[0].name, 'Padrão Gerdau');

    /* Duplicar: nome novo, inativo, mesmo arquivo. */
    r = await duplicarModelo(m.gateway, m.todos(), m.todos()[0].id);
    const copia = m.todos().find(x => x.name.includes('cópia'))!;
    t.eq('duplicar: nome novo, porque o índice único recusaria o mesmo', copia.name, 'Padrão Gerdau (cópia)');
    t.eq('duplicar: a cópia nasce INATIVA, para não tomar o lugar do que mede o mês', copia.isActive, false);
    t.eq('duplicar: o mapeamento veio junto', (copia.mapping as TemplateMapping).sheetName, 'Medição');
    t.eq('duplicar: o arquivo-base é o MESMO objeto do storage', copia.storagePath, 'templates/C1/tpl-1/modelo.xlsx');
    t.eq('duplicar: mensagem', r.mensagem, 'Modelo duplicado como "Padrão Gerdau (cópia)".');
    t.eq('duplicar duas vezes numera a segunda', nomeDaCopia('Padrão Gerdau', m.todos()), 'Padrão Gerdau (cópia 2)');

    /* TROCA DE ATIVO — o ponto da fase. */
    const antes = m.chamadas();
    r = await ativarModelo(m.gateway, m.todos(), copia.id);
    const depois = m.todos();
    t.eq('ativar: exatamente um ativo na empresa', depois.filter(x => x.companyId === 'C1' && x.isActive).length, 1);
    t.eq('ativar: e é a cópia', depois.find(x => x.isActive)!.id, copia.id);
    t.eq('ativar: o anterior saiu', depois.find(x => x.name === 'Padrão Gerdau')!.isActive, false);
    t.check('ativar: UMA escrita no gateway (mais a releitura), nunca duas etapas',
      m.chamadas() - antes === 2, `foram ${m.chamadas() - antes} chamadas`);
    t.check('ativar: mensagem diz empresa e modelo',
      r.mensagem.includes('Padrão Gerdau (cópia)') && r.mensagem.includes('Gerdau'), r.mensagem);

    /* Desativar deixa a empresa sem módulo — e isso é DITO. */
    r = await desativarModelo(m.gateway, m.todos(), copia.id);
    t.eq('desativar: nenhum ativo', m.todos().filter(x => x.isActive).length, 0);
    t.check('desativar: a mensagem avisa que a empresa fica sem módulo',
      r.mensagem.includes('fica sem módulo de medição'), r.mensagem);

    /* Excluir. */
    const original = m.todos().find(x => x.name === 'Padrão Gerdau')!;
    const apagados: string[] = [];
    r = await excluirModelo(m.gateway, m.todos(), original.id, async (_b, p) => { apagados.push(p); });
    t.eq('excluir: o registro saiu', m.todos().some(x => x.id === original.id), false);
    t.eq('excluir: o arquivo NÃO foi apagado, porque a cópia ainda o usa', apagados, []);

    const restante = m.todos()[0];
    r = await excluirModelo(m.gateway, m.todos(), restante.id, async (_b, p) => { apagados.push(p); });
    t.eq('excluir o último dono: aí sim o arquivo sai', apagados, ['templates/C1/tpl-1/modelo.xlsx']);
    t.eq('excluir: a lista ficou vazia', m.todos().length, 0);

    lancou = false;
    try { await excluirModelo(m.gateway, m.todos(), 'nao-existe'); } catch { lancou = true; }
    t.check('excluir inexistente é erro, não silêncio', lancou);

    t.eq('NENHUMA violação de invariante em toda a sequência', m.violacoes, []);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[S] Um ativo por empresa, empresas independentes');
  {
    const m = memGateway();
    await criarModelo(m.gateway, m.todos(), { companyId: 'C1', companyName: 'Gerdau', name: 'A' });
    await criarModelo(m.gateway, m.todos(), { companyId: 'C1', companyName: 'Gerdau', name: 'B' });
    await criarModelo(m.gateway, m.todos(), { companyId: 'C2', companyName: 'CSN', name: 'A' });

    t.eq('mesmo nome em empresas diferentes é permitido', m.todos().filter(x => x.name === 'A').length, 2);
    t.eq('C1 tem um ativo', m.todos().filter(x => x.companyId === 'C1' && x.isActive).length, 1);
    t.eq('C2 tem um ativo', m.todos().filter(x => x.companyId === 'C2' && x.isActive).length, 1);

    const b = m.todos().find(x => x.companyId === 'C1' && x.name === 'B')!;
    await ativarModelo(m.gateway, m.todos(), b.id);
    t.eq('trocar o ativo de C1 não mexe em C2', m.todos().filter(x => x.companyId === 'C2' && x.isActive).length, 1);
    t.eq('e C1 continua com exatamente um', m.todos().filter(x => x.companyId === 'C1' && x.isActive).length, 1);

    const ativos = await listarModelosAtivos(m.gateway);
    t.eq('listar ativos devolve um por empresa', ativos.length, 2);
    const daEmpresa = await listarModelos(m.gateway, 'C1');
    t.eq('listar por empresa recorta', daEmpresa.length, 2);

    t.eq('nenhuma violação', m.violacoes, []);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[V] Registro inválido entra com aviso e não derruba a lista');
  {
    const sadio: TemplateRecord = {
      id: 'ok', companyId: 'C1', companyName: 'Gerdau', name: 'Bom',
      mapping: MAPEAMENTO, isActive: true,
      storageBucket: 'measurement-templates', storagePath: 'templates/C1/ok/m.xlsx',
    };
    const quebrado: TemplateRecord = {
      id: 'ruim', companyId: 'C2', companyName: 'CSN', name: 'Torto',
      mapping: { v: 1, sheetName: 'X', headerRow: 1, firstDataRow: 2, columns: [{ key: 'a', header: 'A', origem: 'campo', campo: 'demand.sumiu' }], constants: [], totals: [] },
      isActive: true, storageBucket: 'measurement-templates', storagePath: 'templates/C2/ruim/m.xlsx',
    };
    const ilegivel: TemplateRecord = {
      id: 'lixo', companyId: 'C3', companyName: 'Usiminas', name: 'Ilegível',
      mapping: 'isto não é um objeto', isActive: true,
    };

    const carregados = loadTemplates([sadio, quebrado, ilegivel]);
    t.eq('os TRÊS entram na lista — nenhum some', carregados.length, 3);
    t.eq('o sadio não tem aviso', carregados[0].avisos, []);
    t.check('o quebrado avisa o campo extinto',
      carregados[1].avisos.some(a => a.includes('não existe mais no sistema')), JSON.stringify(carregados[1].avisos));
    t.check('o ilegível avisa que não deu para ler',
      carregados[2].avisos.some(a => a.includes('sem conteúdo legível')), JSON.stringify(carregados[2].avisos));
    t.check('sem arquivo-base também é aviso',
      carregados[2].avisos.some(a => a.includes('planilha-base')), JSON.stringify(carregados[2].avisos));

    t.eq('"precisa de conserto" separa os três', carregados.map(modeloPrecisaConserto), [false, true, true]);
    t.eq('só o sadio é utilizável como módulo', carregados.map(modeloUtilizavel), [true, false, false]);
    t.eq('o template do quebrado existe mesmo assim (a tela consegue abri-lo para consertar)',
      carregados[1].template.label, 'Medição CSN');
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[P] Caminho do Storage e guarda antes do upload');
  {
    t.eq('nome com acento, espaço e símbolo vira key segura',
      sanitizeFileName('Modelo Medição — Vale (2027).XLSX'), 'modelo_medicao_vale_2027.xlsx');
    t.eq('extensão preservada em minúscula', sanitizeFileName('Planilha.XLSX'), 'planilha.xlsx');
    t.eq('sem extensão vira .xlsx', sanitizeFileName('modelo'), 'modelo.xlsx');
    t.eq('nome só de símbolos não vira nome vazio', sanitizeFileName('###.xlsx'), 'modelo.xlsx');
    t.eq('nome enorme é cortado', sanitizeFileName('a'.repeat(200) + '.xlsx').length <= 85, true);

    t.eq('caminho montado no formato combinado',
      buildTemplateStoragePath('C1', 'tpl-9', 'Medição Vale 2027.xlsx'),
      'templates/C1/tpl-9/medicao_vale_2027.xlsx');
    // A sanitização é do NOME DO ARQUIVO; os ids vão como o banco os tem
    // (uuid em produção) e não são reescritos — reescrevê-los quebraria a
    // ligação com a linha. É o último segmento que precisa ser seguro.
    const key = buildTemplateStoragePath('C1', 'tpl-9', 'Medição Vale 2027.xlsx');
    t.check('o nome do arquivo na key não tem acento, espaço nem maiúscula',
      /^[a-z0-9_.-]+$/.test(key.split('/').pop()!), key);
    t.check('o caminho inteiro não tem espaço nem acento',
      !/[\sÀ-ɏ]/.test(key), key);

    for (const [nome, args] of [['sem empresa', ['', 'tpl-1']], ['sem modelo', ['C1', '']]] as const) {
      let lancou = false;
      try { buildTemplateStoragePath(args[0], args[1], 'x.xlsx'); }
      catch (e: any) { lancou = e instanceof TemplateFileError; }
      t.check(`caminho ${nome} é recusado com mensagem`, lancou);
    }

    // A guarda de bytes é a MESMA do upload (uploadTemplateBaseFile chama
    // assertXlsx antes de tocar no storage). Aqui se prova o contrato.
    const ole2 = new Uint8Array(64);
    ole2.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    let recusou = false;
    try { assertXlsx(ole2); } catch (e: any) { recusou = e.codigo === 'xls-antigo'; }
    t.check('a guarda que roda antes do upload recusa .xls', recusou);

    const fonte = fs.readFileSync(path.join(raiz, 'services/exports/templateStorage.ts'), 'utf8');
    const upload = fonte.slice(fonte.indexOf('export async function uploadTemplateBaseFile'));
    const corpo = upload.slice(0, upload.indexOf('\n}'));
    t.check('uploadTemplateBaseFile chama assertXlsx ANTES do storage.upload',
      corpo.indexOf('assertXlsx') > 0 && corpo.indexOf('assertXlsx') < corpo.indexOf('.upload('));
    t.check('upload usa upsert e contentType, como demandDocuments',
      /upsert:\s*true/.test(corpo) && /contentType/.test(corpo));
    t.check('a URL assinada NÃO é guardada: o modelo guarda o caminho',
      !/signedUrl/.test(fonte.slice(fonte.indexOf('export async function uploadTemplateBaseFile'), fonte.indexOf('export async function signedTemplateBaseUrl'))));
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[B] Arquivo-base: público (Vale) x storage (modelo do banco)');
  {
    t.eq('a Vale continua no caminho público', [VALE_TEMPLATE.baseFile, VALE_TEMPLATE.baseFileFrom],
      ['/templates/vale.xlsx', undefined]);

    const doBanco: MeasurementTemplate = {
      id: 'tpl:1', version: 1, origin: 'db', label: 'Medição Gerdau',
      company: { id: 'C1' }, fileNameBase: 'medicao_gerdau', sheets: [],
      baseFile: 'templates/C1/tpl-1/modelo.xlsx',
      baseFileFrom: 'storage',
      baseFileBucket: 'measurement-templates',
    };

    const pedidos: string[] = [];
    const buf = await fetchTemplateBaseFile(doBanco, async (bucket, p) => {
      pedidos.push(`${bucket}|${p}`);
      return new ArrayBuffer(8);
    });
    t.eq('storage: o loader recebe bucket e caminho', pedidos, ['measurement-templates|templates/C1/tpl-1/modelo.xlsx']);
    t.eq('storage: devolveu os bytes', buf?.byteLength, 8);

    let lancou = '';
    try { await fetchTemplateBaseFile(doBanco); } catch (e: any) { lancou = e.message; }
    t.check('storage sem loader é erro explícito, não fetch de caminho relativo',
      lancou.includes('nenhum leitor foi informado'), lancou);

    // Sem arquivo-base nenhum continua devolvendo null (o caminho "gera do zero").
    t.eq('template sem arquivo-base -> null', await fetchTemplateBaseFile({ ...doBanco, baseFile: undefined }), null);
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[G] Impressão digital do arquivo-base');
  {
    const cabecalhos = ['Item', 'Descrição do Serviço', 'Qtd', 'Valor Unit.', 'Total'];
    const fp = buildBaseFingerprint(MAPEAMENTO, cabecalhos);
    t.eq('guarda aba, linha do cabeçalho e os cabeçalhos', [fp.sheetName, fp.headerRow, fp.headers.length], ['Medição', 3, 5]);
    t.eq('sobrevive ao jsonb', parseBaseFingerprint(JSON.parse(JSON.stringify(fp))), fp);
    t.eq('jsonb torto -> null', parseBaseFingerprint({ sheetName: 'x' }), null);

    t.eq('arquivo igual: nada a reconfirmar', compareBaseFingerprint(fp, fp), []);

    const trocado = buildBaseFingerprint(MAPEAMENTO, ['Item', 'Serviço', 'Qtd', 'Valor Unit.', 'Total']);
    const dif = compareBaseFingerprint(fp, trocado);
    t.check('coluna renomeada é apontada pela LETRA',
      dif.length === 1 && dif[0].includes('coluna B') && dif[0].includes('Descrição do Serviço') && dif[0].includes('Serviço'), JSON.stringify(dif));

    const aMenos = compareBaseFingerprint(fp, buildBaseFingerprint(MAPEAMENTO, cabecalhos.slice(0, 4)));
    t.check('coluna que sumiu é dita', aMenos.some(d => d.includes('não existe mais')), JSON.stringify(aMenos));
    const aMais = compareBaseFingerprint(fp, buildBaseFingerprint(MAPEAMENTO, [...cabecalhos, 'Observação']));
    t.check('coluna nova é dita', aMais.some(d => d.includes('não existia')), JSON.stringify(aMais));

    const outraAba = compareBaseFingerprint(fp, { ...fp, sheetName: 'Planilha1' });
    t.check('aba trocada é dita', outraAba.some(d => d.includes('aba de dados')), JSON.stringify(outraAba));
    const outraLinha = compareBaseFingerprint(fp, { ...fp, headerRow: 5 });
    t.check('cabeçalho que mudou de linha é dito', outraLinha.some(d => d.includes('linha 3') && d.includes('linha 5')));
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[S] Exclusão: quem pode apagar o arquivo');
  {
    const a: TemplateRecord = { id: 'a', companyId: 'C1', companyName: 'X', name: 'A', mapping: {}, isActive: true, storageBucket: 'b', storagePath: 'p/1.xlsx' };
    const b: TemplateRecord = { id: 'b', companyId: 'C1', companyName: 'X', name: 'B', mapping: {}, isActive: false, storageBucket: 'b', storagePath: 'p/1.xlsx' };
    const c: TemplateRecord = { id: 'c', companyId: 'C1', companyName: 'X', name: 'C', mapping: {}, isActive: false, storageBucket: 'b', storagePath: 'p/2.xlsx' };
    const semArquivo: TemplateRecord = { id: 'd', companyId: 'C1', companyName: 'X', name: 'D', mapping: {}, isActive: false };

    t.eq('arquivo compartilhado com a cópia: NÃO apaga', podeApagarArquivo(a, [a, b, c]), false);
    t.eq('arquivo só dele: apaga', podeApagarArquivo(c, [a, b, c]), true);
    t.eq('modelo sem arquivo: nada a apagar', podeApagarArquivo(semArquivo, [semArquivo]), false);
    t.eq('o plano reflete a decisão', planejarExclusao(a, [a, b, c]), { storagePath: null, storageBucket: null });
    t.eq('e traz bucket e caminho quando pode', planejarExclusao(c, [a, b, c]), { storagePath: 'p/2.xlsx', storageBucket: 'b' });

    const fonte = fs.readFileSync(path.join(raiz, 'services/exports/templates.ts'), 'utf8');
    const trecho = fonte.slice(fonte.indexOf('export async function excluirTemplateComArquivo'));
    t.check('o serviço apaga o REGISTRO antes do ARQUIVO (falha do lado barato)',
      trecho.indexOf('deleteMeasurementTemplate') < trecho.indexOf('removerArquivo('));
  }

  /* ──────────────────────────────────────────────────────────────────────── */
  console.log('\n[Q] Migration 022 — o arquivo diz o que foi combinado');
  {
    const rel = 'supabase/migrations/022_measurement_templates.sql';
    t.check('a 022 existe', fs.existsSync(path.join(raiz, rel)));
    const sql = fs.readFileSync(path.join(raiz, rel), 'utf8');

    // O SQL de verdade, sem os comentários — senão a prova cai na prosa do
    // cabeçalho, que fala de code_id e SECURITY DEFINER justamente para dizer
    // que NÃO os usa.
    const ddl = sql.replace(/^\s*--.*$/gm, '');

    t.check('NÃO cria a FK para measurement_template_values',
      !/measurement_template_values/i.test(ddl));
    t.check('e explica por que não, com o caminho para criá-la um dia',
      /DELIBERADAMENTE NÃO CRIADA/.test(sql) && /NOT VALID/.test(sql) && /quebra EM PRODUÇÃO|quebra em produção/i.test(sql));
    t.check('a tabela não tem coluna code_id nem origin', !/\bcode_id\b|\borigin\b/.test(ddl));

    t.check('FK de company_id com ON DELETE RESTRICT',
      /REFERENCES public\.companies \(id\) ON DELETE RESTRICT/.test(sql));
    t.check('tipo de companies.id por introspecção, como a 017 fez',
      /format_type\(a\.atttypid/.test(sql) && /public\.companies'::regclass/.test(sql));

    t.check('índice único PARCIAL de um ativo por empresa',
      /CREATE UNIQUE INDEX IF NOT EXISTS measurement_templates_ativo_uq[\s\S]{0,120}WHERE is_active/.test(sql));
    t.check('índice de leitura por empresa', /measurement_templates_company_idx/.test(sql));
    t.check('CHECK de nome não vazio', /measurement_templates_name_check[\s\S]{0,160}length\(btrim\(name\)\)/.test(sql));
    t.check('CHECK de first_data_row > header_row', /first_data_row > header_row/.test(sql));

    t.check('RLS ligada com as 4 policies de "qualquer autenticado"',
      /ENABLE ROW LEVEL SECURITY/.test(sql) &&
      (sql.match(/CREATE POLICY "Autenticados podem/g) ?? []).length === 4);
    t.check('GRANT à role authenticated, como a 021 precisou',
      /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.measurement_templates TO authenticated/.test(sql));
    t.check('diz que o gate real é a requiredView e que o bucket tem política própria',
      /requiredView/.test(sql) && /pol[íi]tica pr[óo]pria/i.test(sql));

    t.check('a função de troca de ativo existe e é SECURITY INVOKER (não DEFINER)',
      /CREATE OR REPLACE FUNCTION public\.set_active_measurement_template/.test(ddl) && !/SECURITY\s+DEFINER/i.test(ddl));
    t.check('e é executável só por authenticated',
      /REVOKE ALL ON FUNCTION public\.set_active_measurement_template/.test(ddl) &&
      /GRANT EXECUTE ON FUNCTION public\.set_active_measurement_template\(uuid\) TO authenticated/.test(ddl));
    t.check('e explica por que são dois UPDATEs, não um', /ARMADILHA|armadilha/.test(sql));

    t.check('conferência prévia do bucket privado',
      /storage\.buckets/.test(sql) && /public = false|public\s*=\s*false/.test(sql));
    t.check('conferência pós com os testes funcionais pedidos',
      /dois ativos/i.test(sql) && /RESTRICT/.test(sql) && (sql.match(/rollback;/g) ?? []).length >= 4);
    t.check('idempotente: IF NOT EXISTS e policies recriadas',
      /CREATE TABLE IF NOT EXISTS/.test(sql) && /DROP POLICY IF EXISTS/.test(sql));
  }
}
