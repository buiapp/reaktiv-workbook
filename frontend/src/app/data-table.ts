import type { TableCell, TableResult } from './sheet.types';

/** Table kinds that notes show as a table; lists of records/rows stay inline text there. */
export function isNoteTable(table: TableResult | undefined): table is TableResult {
  return table?.kind === 'DataFrame' || table?.kind === 'Series';
}

export function tableSummary(table: TableResult): string {
  const rows = `${table.rowCount.toLocaleString()} row${table.rowCount === 1 ? '' : 's'}`;
  const columns = `${table.columnCount} column${table.columnCount === 1 ? '' : 's'}`;
  return `${rows} × ${columns}`;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

/**
 * Escaped HTML for a table value, shared by notes (built as HTML strings) and the
 * inspector. Styles live in styles.scss (`.data-table`) so they apply inside
 * innerHTML and follow the light/dark theme.
 */
export function renderTableHtml(table: TableResult, maxRows = 200): string {
  const numeric = table.columns.map((_, column) =>
    table.rows.every((row) => row[column] === null || typeof row[column] === 'number'),
  );
  const header = [
    ...(table.index !== null ? [`<th class="index">${escapeHtml(table.indexName ?? '')}</th>`] : []),
    ...table.columns.map(
      (column, position) =>
        `<th${numeric[position] ? ' class="numeric"' : ''}>${escapeHtml(column)}</th>`,
    ),
  ].join('');
  const body = table.rows
    .slice(0, maxRows)
    .map((row, position) => {
      const index =
        table.index !== null ? `<th class="index">${formatCell(table.index[position])}</th>` : '';
      const cells = row
        .map(
          (cell, column) =>
            `<td${numeric[column] ? ' class="numeric"' : ''}>${formatCell(cell)}</td>`,
        )
        .join('');
      return `<tr>${index}${cells}</tr>`;
    })
    .join('');
  const shownRows = Math.min(maxRows, table.rows.length);
  const hidden =
    shownRows < table.rowCount || table.columns.length < table.columnCount
      ? ` · showing ${shownRows.toLocaleString()} × ${table.columns.length}`
      : '';
  return (
    `<figure class="data-table">` +
    `<div class="data-table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>` +
    `<figcaption>${escapeHtml(table.kind)} · ${escapeHtml(tableSummary(table))}${hidden}</figcaption>` +
    `</figure>`
  );
}

function formatCell(cell: TableCell): string {
  if (cell === null) return '<span class="missing">—</span>';
  if (typeof cell === 'number') return escapeHtml(numberFormat.format(cell));
  return escapeHtml(String(cell));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
