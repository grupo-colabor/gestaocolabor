/**
 * Runner de scripts/reconcileExportacoes.ts.
 *
 * Os services do app leem `import.meta.env.VITE_*` (lib/supabase.ts), que não
 * existe em Node. Este runner lê o .env do projeto e injeta esses valores no
 * bundle via `define` do esbuild — o mesmo que o Vite faz no navegador —,
 * depois executa o bundle. Nenhum segredo vai para o repositório: o bundle
 * fica em node_modules/.cache, como os smokes.
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

function lerEnv() {
  const out = {};
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return out;
  for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

(async () => {
  const env = { ...lerEnv(), ...process.env };
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não encontrados (.env ou ambiente).');
    process.exit(2);
  }
  const outfile = path.join('node_modules', '.cache', 'reconcile-exportacoes.cjs');
  await esbuild.build({
    entryPoints: ['scripts/reconcileExportacoes.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(key),
      'import.meta.env.VITE_AUTH_MODE': JSON.stringify(env.VITE_AUTH_MODE || 'supabase'),
      'import.meta.env.DEV': 'false',
      'import.meta.env': '{}',
    },
  });
  require(path.resolve(outfile));
})().catch(e => {
  console.error(e);
  process.exit(2);
});
