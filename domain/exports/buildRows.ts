/**
 * MOTOR DE EXPORTAÇÃO — seleção e ordem de colunas -> tabela
 *
 * Recebe as linhas do dataset e a lista ORDENADA de chaves que o usuário
 * escolheu; devolve cabeçalho + matriz. Chave desconhecida é erro (a UI só
 * oferece chaves do registry, então isso é bug, não entrada do usuário);
 * chave repetida é colapsada mantendo a primeira ocorrência.
 */
import type { ColumnDef, DatasetDef, ExportTable, FilterableRow } from './types';

export function defaultColumnKeys<Row extends FilterableRow>(dataset: DatasetDef<Row>): string[] {
  return dataset.columns.filter(c => c.defaultOn).map(c => c.key);
}

export function resolveColumns<Row extends FilterableRow>(
  dataset: DatasetDef<Row>,
  selectedKeys: string[]
): ColumnDef<Row>[] {
  const byKey = new Map(dataset.columns.map(c => [c.key, c]));
  const seen = new Set<string>();
  const out: ColumnDef<Row>[] = [];
  for (const key of selectedKeys) {
    if (seen.has(key)) continue;
    const col = byKey.get(key);
    if (!col) throw new Error(`Coluna desconhecida no dataset ${dataset.key}: ${key}`);
    seen.add(key);
    out.push(col);
  }
  return out;
}

export function buildTable<Row extends FilterableRow>(
  dataset: DatasetDef<Row>,
  rows: Row[],
  selectedKeys: string[]
): ExportTable {
  const columns = resolveColumns(dataset, selectedKeys);
  if (columns.length === 0) throw new Error('Selecione ao menos uma coluna.');
  return {
    columns: columns.map(c => ({ key: c.key, header: c.header, kind: c.kind, width: c.width })),
    rows: rows.map(r => columns.map(c => c.get(r))),
  };
}
