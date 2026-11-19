/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { syncReferenceDocuments } from './docs-reference/sync.mjs';

export const COMPARISON_SOURCE = 'handbook/src/content/docs/start/how-soundscaper-compares.md';
export const GENERATED_COMPARISON_DIRECTORY = 'handbook/src/content/docs/start/comparisons';
const MAIN_ROUTE = '/start/how-soundscaper-compares/';
const PAIRWISE_ROUTE = '/start/comparisons/';
const BREAK = /<br\s*\/?>/iu;

type ComparisonTable = { start: number; end: number; rows: string[][] };
type Counterpart = { column: number; name: string; filename: string };

/** Preserve Markdown cell content, including escaped pipes and inline markup. */
function cells(line: string): string[] {
	const source = line.trim();
	if (!source.endsWith('|')) throw new Error('Comparison table rows must end with a column delimiter.');
	const result: string[] = [];
	let cell = '', escaped = false;
	for (const character of source.slice(1, -1)) {
		if (character === '|' && !escaped) {
			result.push(cell.trim());
			cell = '';
		} else cell += character;
		escaped = character === '\\' ? !escaped : false;
	}
	result.push(cell.trim());
	return result;
}

function comparisonTables(lines: string[]): ComparisonTable[] {
	const tables: ComparisonTable[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (!lines[index].trimStart().startsWith('|')) continue;
		const start = index, rows: string[][] = [];
		while (index < lines.length && lines[index].trimStart().startsWith('|')) rows.push(cells(lines[index++]));
		if (rows.length < 3 || !rows[1].every(cell => /^:?-{3,}:?$/u.test(cell))) {
			throw new Error('A comparison table must have a header, delimiter row, and capabilities.');
		}
		if (rows.some(row => row.length !== rows[0].length)) throw new Error('Comparison table column counts differ.');
		if (rows.slice(2).some(row => row.slice(1).some(cell => !/^[+~/?](?:$| — )/u.test(cell)))) {
			throw new Error('Each comparison table capability must have a verdict.');
		}
		tables.push({ start, end: index, rows });
	}
	if (!tables.length) throw new Error('The source must contain a comparison table.');
	const headers = tables[0].rows[0].slice(1);
	if (tables.some(table => table.rows[0].slice(1).some((header, index) => header !== headers[index])
		|| table.rows[0].length !== headers.length + 1)) throw new Error('Comparison table product headers differ.');
	return tables;
}

function productName(header: string): string {
	return header.split(BREAK).join(' ').replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim();
}

function counterparts(headers: string[], desktop: number): Counterpart[] {
	const names = new Set<string>(), filenames = new Set<string>();
	return headers.flatMap((header, column) => {
		if (column === 0 || column === desktop) return [];
		const name = productName(header);
		// Edition/version labels stay in titles and cells, while version changes keep the same route.
		const firstLine = header.split(BREAK)[0];
		const identity = firstLine === 'Soundscaper' ? name : firstLine;
		const slug = identity.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
		const filename = `soundscaper-vs-${slug}.md`;
		if (!slug || names.has(name) || filenames.has(filename)) throw new Error(`Duplicate or invalid comparison product: ${name}.`);
		names.add(name);
		filenames.add(filename);
		return [{ column, name, filename }];
	});
}

function frontmatter(title: string, description: string): string {
	return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nsidebar:\n  label: ${JSON.stringify(title)}\n---\n`;
}

function renderPairwiseBody(lines: string[], tables: ComparisonTable[], desktop: number, counterpart: number): string {
	const firstTable = tables[0].start;
	let sectionStart = firstTable;
	for (let index = 0; index < firstTable; index++) if (/^## /u.test(lines[index])) sectionStart = index;
	const tableAt = new Map(tables.map(table => [table.start, table]));
	const body: string[] = [];
	for (let index = sectionStart; index < lines.length; index++) {
		const table = tableAt.get(index);
		if (!table) body.push(lines[index]);
		else {
			body.push(...table.rows.map(row => `| ${[row[0], row[desktop], row[counterpart]].join(' | ')} |`));
			index = table.end - 1;
		}
	}
	return `${body.join('\n').trimEnd()}\n`;
}

/** Derive all pairwise pages solely from the authoritative comparison's columns and rows. */
export function renderComparisonDocuments(source: string): Map<string, string> {
	const lines = source.replaceAll('\r\n', '\n').split('\n');
	const tables = comparisonTables(lines);
	const headers = tables[0].rows[0];
	const desktopColumns = headers.flatMap((header, index) => productName(header) === 'Soundscaper Desktop' ? [index] : []);
	if (desktopColumns.length !== 1) throw new Error('Exactly one Soundscaper Desktop column is required.');
	const desktop = desktopColumns[0];
	const products = counterparts(headers, desktop);
	if (!products.length) throw new Error('The comparison table must include a counterpart.');
	const notice = '<!-- Generated by scripts/docs-comparisons.ts from the main comparison. Do not edit. -->\n';
	const documents = new Map<string, string>([['index.md', [
		frontmatter('Soundscaper comparisons', 'Compare Soundscaper Desktop with each editor in the full comparison table.'), notice,
		`Choose an editor to compare with Soundscaper Desktop. Every row comes from [How Soundscaper compares](${MAIN_ROUTE}).`, '',
		...products.map(product => `- [Soundscaper vs ${product.name}](${PAIRWISE_ROUTE}${product.filename.slice(0, -3)}/)`), '',
	].join('\n')]]);
	for (const product of products) {
		documents.set(product.filename, [
			frontmatter(`Soundscaper vs ${product.name}`, `Compare Soundscaper Desktop with ${product.name} across recording, editing, mixing, and delivery.`), notice,
			`[How Soundscaper compares](${MAIN_ROUTE}) has all editors and reviewed sources.`, '',
			'`+` supported · `~` limited · `/` unavailable · `?` not verified. Hover, focus, or tap an underlined cell for details.', '',
			`[Choose another comparison](${PAIRWISE_ROUTE})`, '',
			renderPairwiseBody(lines, tables, desktop, product.column),
		].join('\n'));
	}
	return documents;
}

export async function generateComparisonDocuments(repositoryRoot: string, { write = true }: { write?: boolean } = {}) {
	const documents = renderComparisonDocuments(await readFile(join(repositoryRoot, COMPARISON_SOURCE), 'utf8'));
	const result = await syncReferenceDocuments(repositoryRoot, documents, { write, directory: GENERATED_COMPARISON_DIRECTORY });
	return { ...result, documentCount: documents.size };
}
