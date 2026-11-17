/**
 * SMOKE DE TELA — Medição Vale e BM com "todas as turmas do período"
 *
 * Rodar com:  npm run smoke:medicao-vale-tela
 *
 * Monta a tela de verdade (components/exportacoes/MedicaoTemplateView) sobre
 * happy-dom e confere o que a pessoa vê: o total da barra (sem "de N no
 * recorte" quando nada fica fora), o aviso das turmas não concluídas acima da
 * prévia com a lista, a marca na linha da prévia, o Consultor amarelo, o
 * resumo do painel e a confirmação ao Gerar ("gerar mesmo assim?").
 *
 * Este arquivo só empacota `medicaoValeTela.entry.tsx` com o `import.meta.env`
 * que o cliente do Supabase lê ao ser importado (nenhuma chamada ao banco é
 * feita: a carga vem pronta da fixture) e roda o pacote. Sai com código 1 se
 * qualquer asserção falhar.
 */
import fs from 'fs';
import path from 'path';
import { buildSync } from 'esbuild';

const raiz = process.cwd();
const cache = path.join(raiz, 'node_modules', '.cache');
fs.mkdirSync(cache, { recursive: true });
const saida = path.join(cache, 'medicao-vale-tela.entry.cjs');

buildSync({
  entryPoints: [path.join(raiz, 'scripts', 'medicaoValeTela.entry.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: saida,
  logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"http://localhost"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"',
    'import.meta.env.VITE_AUTH_MODE': '"mock"',
    'import.meta.env': '{}',
    'process.env.NODE_ENV': '"test"',
  },
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
require(saida);
