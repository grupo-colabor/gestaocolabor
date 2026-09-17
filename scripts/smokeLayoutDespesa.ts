/**
 * SMOKE DE LAYOUT — linha do item de despesa nas três larguras do painel
 *
 * Rodar com:  npm run smoke:layout-despesa
 *
 * Regressão real: os botões "NÃO REEMBOLSA" e "PAGO PELO INSTRUTOR" estouravam
 * a largura nos cartões estreitos (Café/Almoço/Jantar, Outras Despesas). O
 * happy-dom não faz layout, então este smoke usa um Chromium headless
 * (playwright, devDependency): empacota `layoutExpenseItemRow.entry.tsx` com
 * o componente de verdade + Tailwind (CDN, o mesmo do app), renderiza os
 * cartões de 256, 267 e 432px e MEDE:
 *
 *   • nenhum botão ultrapassa o cartão (rect dentro do rect do cartão);
 *   • nenhum botão tem texto cortado (scrollWidth <= clientWidth);
 *   • a linha do item não rola horizontalmente;
 *   • no cartão largo os botões podem ficar na linha do valor OU descer — só
 *     se afirma que, quando descem, ficam alinhados à esquerda.
 *
 * Precisa de rede para o CDN do Tailwind (o app também). Sai com código 1 se
 * qualquer asserção falhar ou se o Tailwind não carregar.
 */
import fs from 'fs';
import path from 'path';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';

let falhas = 0;
function check(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) console.log(`  ok    ${nome}`);
  else { falhas++; console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`); }
}

const raiz = process.cwd();
const cache = path.join(raiz, 'node_modules', '.cache');
fs.mkdirSync(cache, { recursive: true });
const bundle = path.join(cache, 'layout-despesa.js');
const html = path.join(cache, 'layout-despesa.html');

buildSync({
  entryPoints: [path.join(raiz, 'scripts', 'layoutExpenseItemRow.entry.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  outfile: bundle,
  logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"http://localhost"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"',
    'import.meta.env.VITE_AUTH_MODE': '"mock"',
    'import.meta.env': '{}',
    'process.env.NODE_ENV': '"production"',
  },
});

fs.writeFileSync(html, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script>
</head><body><div id="root"></div><script src="file://${bundle.replace(/\\/g, '/')}"></script></body></html>`);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const erros: string[] = [];
  page.on('pageerror', e => erros.push(String(e)));
  await page.goto('file://' + html.replace(/\\/g, '/'), { waitUntil: 'load' });
  // Tailwind CDN processa as classes depois do load.
  await page.waitForFunction(() => document.querySelectorAll('[data-card]').length === 3, null, { timeout: 30000 });
  await page.waitForTimeout(800);

  const tailwindOk = await page.evaluate(() => {
    const el = document.querySelector('[data-card]') as HTMLElement | null;
    return !!el && getComputedStyle(el).borderRadius !== '0px';
  });
  check('Tailwind carregou (o cartão tem border-radius)', tailwindOk);
  check('sem erro de página', erros.length === 0, erros.join(' | '));

  const medidas = await page.evaluate(() => {
    const out: any[] = [];
    for (const card of Array.from(document.querySelectorAll<HTMLElement>('[data-card]'))) {
      const cr = card.getBoundingClientRect();
      const linhas = Array.from(card.children) as HTMLElement[];
      for (const [i, linha] of linhas.entries()) {
        const lr = linha.getBoundingClientRect();
        const botoes = Array.from(linha.querySelectorAll<HTMLButtonElement>('button')).filter(b => (b.textContent || '').trim().length > 0);
        const valor = linha.querySelector<HTMLInputElement>('input');
        const vr = valor?.getBoundingClientRect();
        out.push({
          card: card.dataset.card,
          cardWidth: cr.width,
          linha: i + 1,
          linhaRola: linha.scrollWidth > linha.clientWidth + 0.5,
          linhaDentro: lr.right <= cr.right + 0.5 && lr.left >= cr.left - 0.5,
          botoes: botoes.map(b => {
            const r = b.getBoundingClientRect();
            return {
              texto: (b.textContent || '').trim(),
              dentro: r.right <= cr.right + 0.5 && r.left >= cr.left - 0.5,
              cortado: b.scrollWidth > b.clientWidth + 0.5,
              mesmaLinhaDoValor: vr ? Math.abs(r.top - vr.top) < 4 : null,
              left: r.left - cr.left,
              top: r.top - lr.top,
            };
          }),
        });
      }
    }
    return out;
  });

  for (const m of medidas) {
    const id = `${m.card} (${Math.round(m.cardWidth)}px) linha ${m.linha}`;
    check(`${id}: a linha não rola horizontalmente`, !m.linhaRola);
    check(`${id}: a linha cabe no cartão`, m.linhaDentro);
    for (const b of m.botoes) {
      check(`${id}: "${b.texto}" dentro do cartão`, b.dentro, `left=${b.left.toFixed(1)}`);
      check(`${id}: "${b.texto}" sem texto cortado`, !b.cortado);
    }
    const flags = m.botoes.filter((b: any) => /reembolsa|pago pelo instrutor/i.test(b.texto));
    if (flags.length >= 2) {
      const desceram = flags.every((b: any) => b.mesmaLinhaDoValor === false);
      const naMesma = flags.every((b: any) => b.mesmaLinhaDoValor === true);
      check(`${id}: as duas flags estão juntas (as duas na linha do valor OU as duas abaixo)`, desceram || naMesma);
      if (desceram) {
        // alinhadas à esquerda: a primeira flag começa no início da área útil do cartão (padding p-5 = 20px, +8px da linha).
        check(`${id}: flags abaixo do valor ficam alinhadas à esquerda`, flags[0].left < 40, `left=${flags[0].left.toFixed(1)}`);
      }
      if (m.card === 'estreito' || m.card === 'medio') {
        check(`${id}: no cartão estreito as flags descem para a segunda linha`, desceram);
      }
    }
  }

  await page.screenshot({ path: path.join(cache, 'layout-despesa.png'), fullPage: true });
  console.log(`  (print em ${path.join(cache, 'layout-despesa.png')})`);
  await browser.close();
  console.log(falhas === 0 ? '\n✅ SMOKE LAYOUT DESPESA: OK' : `\n❌ SMOKE LAYOUT DESPESA: ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
