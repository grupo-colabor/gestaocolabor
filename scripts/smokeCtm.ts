/**
 * SMOKE — Conflito de CTM entre demanda INTERNA e de CLIENTE
 *
 * Rodar com:  npm run smoke:ctm
 *
 * Motivo: o bloco CENTRO MÓVEL passou a existir também no modal de demanda
 * interna. O Centro de Treinamento Móvel é recurso ÚNICO da Colabor — se uma
 * interna o reserva, uma demanda de cliente não pode reservá-lo no mesmo
 * período, e vice-versa. Esse bloqueio cruzado é justamente o que não dá para
 * verificar clicando numa tela só, e é o que quebraria em silêncio se alguém
 * colocasse um filtro por `tipo` dentro da regra de conflito.
 *
 * A asserção central é nos DOIS SENTIDOS: interna bloqueia cliente E cliente
 * bloqueia interna.
 *
 * Sai com código 1 se qualquer asserção falhar.
 */
import {
  hasResourceOverlap,
  type ResourceAllocationLike,
  type ResourceConflictDemandLike,
} from '../domain/resourceConflict';

let falhas = 0;

function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) {
    console.log(`  ok    ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/* ── Dataset: uma interna e uma de cliente, mesmo CTM ───────────────────── */

const DEM_INTERNA = 'DEM-INT-1';
const DEM_CLIENTE = 'DEM-CLI-1';
const DEM_CANCELADA = 'DEM-CLI-CANC';

const demands: ResourceConflictDemandLike[] = [
  { id: DEM_INTERNA, status: 'ALOCADA' },
  { id: DEM_CLIENTE, status: 'ALOCADA' },
  { id: DEM_CANCELADA, status: 'CANCELADA' },
];

/** CTM reservado pela INTERNA de 10 a 12 de março. */
const ctmDaInterna: ResourceAllocationLike = {
  id: 'RES-INT-1',
  demandId: DEM_INTERNA,
  startDate: '2026-03-10T08:00',
  endDate: '2026-03-12T18:00',
};

/** CTM reservado pela demanda de CLIENTE de 20 a 22 de março. */
const ctmDoCliente: ResourceAllocationLike = {
  id: 'RES-CLI-1',
  demandId: DEM_CLIENTE,
  startDate: '2026-03-20T08:00',
  endDate: '2026-03-22T18:00',
};

const conflita = (
  startDate: string,
  endDate: string,
  allocations: ResourceAllocationLike[],
  excludeDemandId?: string
) => hasResourceOverlap({ startDate, endDate, allocations, demands, excludeDemandId });

console.log('\n— Bloqueio cruzado: INTERNA reservou, CLIENTE tenta');
{
  const allocs = [ctmDaInterna];
  check(
    'cliente pedindo 11–13 é BLOQUEADO pela interna 10–12',
    conflita('2026-03-11', '2026-03-13', allocs, DEM_CLIENTE) === true
  );
  check(
    'cliente pedindo exatamente 10–12 é BLOQUEADO',
    conflita('2026-03-10', '2026-03-12', allocs, DEM_CLIENTE) === true
  );
  check(
    'cliente pedindo só o último dia (12) é BLOQUEADO',
    conflita('2026-03-12', '2026-03-12', allocs, DEM_CLIENTE) === true
  );
  check(
    'cliente pedindo 13–15 (sem sobreposição) é LIBERADO',
    conflita('2026-03-13', '2026-03-15', allocs, DEM_CLIENTE) === false
  );
}

console.log('\n— Bloqueio cruzado: CLIENTE reservou, INTERNA tenta');
{
  const allocs = [ctmDoCliente];
  check(
    'interna pedindo 21–23 é BLOQUEADA pelo cliente 20–22',
    conflita('2026-03-21', '2026-03-23', allocs, DEM_INTERNA) === true
  );
  check(
    'interna englobando 19–25 é BLOQUEADA',
    conflita('2026-03-19', '2026-03-25', allocs, DEM_INTERNA) === true
  );
  check(
    'interna pedindo 17–19 (sem sobreposição) é LIBERADA',
    conflita('2026-03-17', '2026-03-19', allocs, DEM_INTERNA) === false
  );
}

console.log('\n— A regra não olha tipo: os dois lados no mesmo dataset');
{
  const allocs = [ctmDaInterna, ctmDoCliente];
  check(
    'nova interna em 11–11 esbarra na interna existente',
    conflita('2026-03-11', '2026-03-11', allocs, 'DEM-INT-NOVA') === true
  );
  check(
    'nova interna em 21–21 esbarra no cliente existente',
    conflita('2026-03-21', '2026-03-21', allocs, 'DEM-INT-NOVA') === true
  );
  check(
    'nova interna em 15–17 (janela livre entre as duas) é LIBERADA',
    conflita('2026-03-15', '2026-03-17', allocs, 'DEM-INT-NOVA') === false
  );
}

console.log('\n— Exclusões: a própria demanda e demandas canceladas');
{
  const allocs = [ctmDaInterna];
  check(
    'a própria interna reeditando o período dela NÃO conflita consigo',
    conflita('2026-03-10', '2026-03-12', allocs, DEM_INTERNA) === false
  );
  check(
    'sem excludeDemandId, a alocação da própria demanda conflita',
    conflita('2026-03-10', '2026-03-12', allocs) === true
  );

  const ctmCancelado: ResourceAllocationLike = {
    id: 'RES-CANC-1',
    demandId: DEM_CANCELADA,
    startDate: '2026-03-10T08:00',
    endDate: '2026-03-12T18:00',
  };
  check(
    'CTM de demanda CANCELADA libera o período para a interna',
    conflita('2026-03-10', '2026-03-12', [ctmCancelado], DEM_INTERNA) === false
  );
}

console.log('\n— Alocação órfã (sem demanda correspondente) continua bloqueando');
{
  const orfa: ResourceAllocationLike = {
    id: 'RES-ORFA',
    demandId: 'DEM-QUE-NAO-EXISTE',
    startDate: '2026-03-10T08:00',
    endDate: '2026-03-12T18:00',
  };
  check(
    'órfã bloqueia (limpeza é responsabilidade do sync, não da checagem)',
    conflita('2026-03-11', '2026-03-11', [orfa], DEM_INTERNA) === true
  );
}

console.log('');
if (falhas > 0) {
  console.log(`❌ ${falhas} check(s) falharam.`);
  process.exit(1);
}
console.log('✅ Todos os checks passaram.');
