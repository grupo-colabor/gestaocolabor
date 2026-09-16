/**
 * EXPORTAÇÕES — zip no navegador (I/O)
 *
 * Um BM por (corredor, mina): sem filtro de mina, sai um .zip com um .xlsx
 * por mina. Usa o jszip, que o ExcelJS já traz e que está declarado no
 * package.json na mesma versão, para o import não depender de hoisting.
 * Carregado por `import()` dinâmico, como o ExcelJS: só pesa quando alguém
 * gera um zip.
 */
import { triggerDownload } from '../../utils/download';

export const ZIP_MIME = 'application/zip';

export interface ZipEntry {
  /** Nome dentro do zip (sem pastas). */
  name: string;
  data: ArrayBuffer | Uint8Array;
}

export async function buildZip(entries: ZipEntry[]): Promise<ArrayBuffer> {
  if (entries.length === 0) throw new Error('Zip vazio: nenhuma entrada.');
  const nomes = new Set<string>();
  for (const e of entries) {
    if (nomes.has(e.name)) throw new Error(`Zip: nome repetido "${e.name}".`);
    nomes.add(e.name);
  }
  const mod: any = await import('jszip');
  const JSZip = mod.default ?? mod;
  const zip = new JSZip();
  for (const e of entries) zip.file(e.name, e.data);
  return (await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })) as ArrayBuffer;
}

export async function downloadZip(entries: ZipEntry[], fileName: string): Promise<void> {
  const buffer = await buildZip(entries);
  triggerDownload(buffer, fileName, ZIP_MIME);
}
