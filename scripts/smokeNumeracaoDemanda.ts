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
    check('App (supabase) pede o número à sequence antes do insert', app.includes('seq = await allocateDemandNumber();'));
    check('App monta o id pelo domínio', app.includes('const nextId = formatDemandId(seq);'));
    check('erro da RPC sobe em banner e bloqueia o cadastro (return null)',
      /catch \(e: any\) \{[\s\S]{0,400}Não foi possível obter o número da demanda[\s\S]{0,200}return null;/.test(app));
    // O "máximo + 1" continua só como contador informativo e no modo mock.
    const supabasePath = app.slice(app.indexOf('// ✅ SUPABASE MODE\n    if (!user) {\n    setNotification({\n        message: \'Aguarde a sessão carregar para salvar a demanda.\''), app.indexOf('const payload = mapDemandToDb(newDemand, { id: nextId, number: seq });'));
    check('no caminho supabase o id NÃO vem mais de nextDemandNumber', supabasePath.length > 0 && !supabasePath.includes('const seq = nextDemandNumber;'));
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
