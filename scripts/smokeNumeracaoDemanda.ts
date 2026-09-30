/**
 * SMOKE — Numeração de demanda por sequence (migration 019)
 *
 * Rodar com:  npm run smoke:numeracao
 *
 * O bug: "DEM-N" era "maior number + 1" lido do banco; apagar a demanda de
 * maior número fazia o próximo cadastro reaproveitar o número (e herdar a
 * medição e o CTM órfãos com o mesmo id). Agora o número vem de uma SEQUENCE
 * por RPC. Este smoke prende a política pura (domain/demandNumbering.ts) com
 * uma sequence SIMULADA, e as guardas de fonte do app e da migration.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import { allocateDemandId, formatDemandId, parseDemandNumber } from '../domain/demandNumbering';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}
const eq = (nome: string, atual: unknown, esperado: unknown) =>
  check(nome, Object.is(atual, esperado) || JSON.stringify(atual) === JSON.stringify(esperado),
    `esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Sequence simulada: comportamento de nextval — monotônica, nunca volta. */
function sequenceFake(inicio: number) {
  let last = inicio;
  return {
    nextval: async () => ++last,
    get last() { return last; },
  };
}

(async () => {
  console.log('\n[1] formatar / ler o id');
  eq('formatDemandId(1719)', formatDemandId(1719), 'DEM-1719');
  eq('parseDemandNumber("DEM-1719")', parseDemandNumber('DEM-1719'), 1719);
  eq('parseDemandNumber com espaço', parseDemandNumber(' DEM-42 '), 42);
  eq('parseDemandNumber lixo', parseDemandNumber('MEA-DEM-1'), null);
  eq('parseDemandNumber vazio', parseDemandNumber(''), null);

  console.log('\n[2] duas alocações seguidas nunca devolvem o mesmo número');
  {
    const seq = sequenceFake(1719);
    const a = await allocateDemandId(seq.nextval);
    const b = await allocateDemandId(seq.nextval);
    eq('primeira = DEM-1720', a, 'DEM-1720');
    eq('segunda = DEM-1721', b, 'DEM-1721');
    check('diferentes', a !== b);

    // Concorrência: duas chamadas "ao mesmo tempo" (Promise.all) também.
    const [c, d] = await Promise.all([allocateDemandId(seq.nextval), allocateDemandId(seq.nextval)]);
    check('concorrentes diferentes', c !== d && c !== b && d !== b);
  }

  console.log('\n[3] o número não volta após exclusão nem após insert falho');
  {
    const seq = sequenceFake(1718);
    const criada = await allocateDemandId(seq.nextval); // DEM-1719
    // "apagar" a demanda não toca a sequence
    const depoisDeApagar = await allocateDemandId(seq.nextval);
    eq('apagada DEM-1719 → próxima é DEM-1720, não DEM-1719', depoisDeApagar, 'DEM-1720');
    check('a antiga não é reaproveitada', criada !== depoisDeApagar);

    // insert falhou: o número fica consumido
    const consumido = await allocateDemandId(seq.nextval); // DEM-1721 (o insert "falha")
    const seguinte = await allocateDemandId(seq.nextval);
    eq('após insert falho, o próximo é outro (buraco aceito)', seguinte, 'DEM-1722');
    check('o consumido nunca volta', consumido !== seguinte);
  }

  console.log('\n[3b] o caso do bug: internas com número MENOR que o maior de cliente, sequence atrás dos ids');
  {
    // Banco simulado. Clientes DEM-1700..1720 com number = id. Duas internas
    // gravadas pela rota antiga (número = maior + 1 sobre a lista SÓ de
    // internas): id DEM-1721 e DEM-1722 mas number 1 e 2. A migration 019
    // posicionou a sequence em max(number) = 1720 → o próximo nextval é 1721,
    // e "DEM-1721" JÁ EXISTE: era o `duplicate key ... demands_pkey`.
    const banco = new Map<string, { number: number; tipo: string }>();
    for (let n = 1700; n <= 1720; n++) banco.set(formatDemandId(n), { number: n, tipo: 'cliente' });
    banco.set('DEM-1721', { number: 1, tipo: 'interna' });
    banco.set('DEM-1722', { number: 2, tipo: 'interna' });
    const maxNumber = Math.max(...[...banco.values()].map(r => r.number));
    eq('fixture: max(number) = 1720 (as internas nao contam), mas o maior id e DEM-1722', maxNumber, 1720);
    const seq = sequenceFake(maxNumber);
    const isTaken = async (id: string) => banco.has(id);
    const criar = async (tipo: string) => {
      const id = await allocateDemandId(seq.nextval, { isTaken });
      const n = parseDemandNumber(id)!;
      if (banco.has(id)) throw new Error(`duplicate key value violates unique constraint "demands_pkey": ${id}`);
      banco.set(id, { number: n, tipo });
      return id;
    };

    // Sem isTaken, o primeiro cadastro repete o id da interna — o bug.
    const semDefesa = await allocateDemandId(sequenceFake(maxNumber).nextval);
    check('sem a defesa, a sequence devolve DEM-1721, que ja existe (o bug reproduzido)', semDefesa === 'DEM-1721' && banco.has(semDefesa));

    // Com a porta única: interna e cliente em sequência, nunca repete.
    const interna1 = await criar('interna');
    const cliente1 = await criar('cliente');
    const interna2 = await criar('interna');
    const cliente2 = await criar('cliente');
    eq('interna: pula 1721 e 1722 (ocupados) e sai DEM-1723', interna1, 'DEM-1723');
    eq('cliente em seguida: DEM-1724', cliente1, 'DEM-1724');
    eq('interna de novo: DEM-1725', interna2, 'DEM-1725');
    eq('cliente de novo: DEM-1726', cliente2, 'DEM-1726');
    const novos = [interna1, cliente1, interna2, cliente2];
    check('os quatro ids sao distintos entre si e de tudo que ja existia', new Set(novos).size === 4);
    eq('os numeros pulados foram consumidos (a sequence nao volta): last = 1726', seq.last, 1726);
    eq('number gravado = numero do id, para cliente E interna', novos.map(id => banco.get(id)!.number), [1723, 1724, 1725, 1726]);
    check('a partir daqui max(number) acompanha o maior id: a sequence nao fica mais atras', Math.max(...[...banco.values()].map(r => r.number)) === parseDemandNumber(cliente2));

    // Limite: 100 ids ocupados seguidos e a alocacao desiste com erro claro (nao entra em loop).
    let msg = '';
    try { await allocateDemandId(sequenceFake(0).nextval, { isTaken: () => true, maxAttempts: 5 }); } catch (e: any) { msg = String(e?.message); }
    check('sequence inteira atras dos ids: erro com instrucao de reposicionar, nao loop infinito', /5 números seguidos já ocupados/.test(msg) && /migration 019/.test(msg));
  }

  console.log('\n[4] valor inválido da sequence é erro, não "DEM-NaN"');
  {
    let lancou = false;
    try { await allocateDemandId(async () => NaN); } catch { lancou = true; }
    check('NaN lança', lancou);
    lancou = false;
    try { await allocateDemandId(async () => 0); } catch { lancou = true; }
    check('0 lança', lancou);
  }

  console.log('\n[5] guardas de fonte — app e migration');
  {
    const app = ler('App.tsx');
    const svc = ler('services/demands.ts');
    const mig = ler('supabase/migrations/019_demand_number_sequence_and_fks.sql');

    check('service chama a RPC allocate_demand_number', svc.includes("supabase.rpc('allocate_demand_number')"));
    check('service recusa valor inválido', svc.includes('allocate_demand_number devolveu valor inválido'));
    check('service: UMA porta de numeração, allocateDemandId, que usa a política do domínio com isTaken = demandIdExists',
      svc.includes('export async function allocateDemandId(): Promise<{ id: string; number: number }>') &&
      svc.includes('allocateDemandIdPolicy(allocateDemandNumber, { isTaken: demandIdExists })'));
    check('service: fetchMaxDemandNumber (o "maior + 1") não existe mais', !svc.includes('function fetchMaxDemandNumber') && !svc.includes(".order('number', { ascending: false })\n    .limit(1)"));
    check('App (supabase) pede id e número à porta única antes do insert', app.includes('({ id: nextId, number: seq } = await allocateDemandId());'));
    check('App não monta DEM-N nem lê o máximo fora do mock', !app.includes('formatDemandId(') && !app.includes('fetchMaxDemandNumber'));
    check('erro da RPC sobe em banner e bloqueia o cadastro (return null)',
      /catch \(e: any\) \{[\s\S]{0,400}Não foi possível obter o número da demanda[\s\S]{0,200}return null;/.test(app));
    // O "máximo + 1" continua só no modo mock.
    const supabasePath = app.slice(app.indexOf('// ✅ SUPABASE MODE\n    if (!user) {\n    setNotification({\n        message: \'Aguarde a sessão carregar para salvar a demanda.\''), app.indexOf('const payload = mapDemandToDb(newDemand, { id: nextId, number: seq });'));
    check('no caminho supabase o id NÃO vem de nextDemandNumber, nem o contador é tocado', supabasePath.length > 0 && !supabasePath.includes('nextDemandNumber'));
    const mockPath = app.slice(app.indexOf('// ✅ MOCK MODE — o ÚNICO lugar onde nextDemandNumber gera id'), app.indexOf('// ✅ SUPABASE MODE\n    if (!user) {\n    setNotification({\n        message: \'Aguarde a sessão carregar para salvar a demanda.\''));
    check('nextDemandNumber gera id SÓ no modo mock, com comentário dizendo isso', mockPath.includes('const seq = nextDemandNumber;') && mockPath.includes('MOCK MODE — o ÚNICO lugar onde nextDemandNumber gera id'));
    check('a única chamada de addDemand vem de Demands.tsx (cliente) e InternalDemands.tsx (interna) — mesma função',
      ler('components/Demands.tsx').includes('await addDemand(') && ler('components/InternalDemands.tsx').includes('await addDemand(') &&
      !/insertDemand\(|allocateDemandNumber|allocateDemandId|DEM-\$\{/.test(ler('components/InternalDemands.tsx') + ler('components/Demands.tsx') + ler('components/CalendarView.tsx')));
    const reg = ler('components/Registrations.tsx');
    check('Cadastros: o campo "Próximo número" só aparece no mock; com Supabase, aviso de numeração automática',
      /AUTH_MODE === 'supabase' \? \([\s\S]{0,600}Numeração automática[\s\S]{0,900}Próximo número da demanda \(modo mock\)/.test(reg));
    check('deleteDemand limpa resource_allocations (sem FK até a 019)', app.includes('await deleteResourceAllocationByDemandId(id);'));

    check('migration: sequence IF NOT EXISTS', mig.includes('CREATE SEQUENCE IF NOT EXISTS public.demands_number_seq'));
    check('migration: setval só na primeira aplicação (is_called)', mig.includes('IF NOT ja_usada THEN') && mig.includes("setval('public.demands_number_seq', maior, true)"));
    check('migration: função security definer com search_path fixo', mig.includes('SECURITY DEFINER') && mig.includes('SET search_path = public, pg_temp'));
    check('migration: grant execute a authenticated', mig.includes('GRANT EXECUTE ON FUNCTION public.allocate_demand_number() TO authenticated;'));
    check('migration: índice único em number', mig.includes('CREATE UNIQUE INDEX IF NOT EXISTS demands_number_uq'));
    check('migration: FKs NOT VALID (órfãos ficam)', mig.includes("ON DELETE %s NOT VALID"));
    check('migration: não valida nem apaga órfãos', !/VALIDATE CONSTRAINT(?!.*NÃO)/.test(mig.replace(/^--.*$/gm, '')) && !/DELETE FROM/i.test(mig.replace(/^--.*$/gm, '')));
    check('migration: agenda_items com SET NULL', mig.includes("('agenda_items',         'related_demand_id', 'SET NULL')"));
    check('migration: só cria FK se não existir na coluna', mig.includes('IF existe_fk THEN'));
  }

  console.log(falhas === 0 ? '\n✅ SMOKE NUMERACAO: OK' : `\n❌ SMOKE NUMERACAO: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
