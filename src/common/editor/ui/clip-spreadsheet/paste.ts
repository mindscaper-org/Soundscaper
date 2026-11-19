/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	CLIP_SPREADSHEET_COLUMNS,
	type ClipSpreadsheetColumnId,
	type ClipSpreadsheetEdit,
	type ClipSpreadsheetRow,
} from '../../clip-spreadsheet.ts';
import type { ClipSpreadsheetNewRow } from '../../clip-spreadsheet-insert.ts';
import {
	MAX_SPREADSHEET_CELLS,
	parseSpreadsheetClipboard,
	forEachSpreadsheetPasteCell,
	type SpreadsheetRange,
} from './clipboard.ts';

export interface ClipSpreadsheetPastePlan {
	readonly edits: readonly ClipSpreadsheetEdit[];
	readonly newRows: readonly ClipSpreadsheetNewRow[];
	readonly range: SpreadsheetRange;
}

/** Append only when no cells are selected; otherwise overwrite existing clips. */
export function planClipSpreadsheetPaste(
	text: string,
	range: SpreadsheetRange | null,
	rows: readonly ClipSpreadsheetRow[],
): ClipSpreadsheetPastePlan {
	const matrix = parseSpreadsheetClipboard(text);
	if (range && (![range.top, range.left, range.bottom, range.right].every(value => Number.isSafeInteger(value) && value >= 0)
		|| range.top > range.bottom || range.left > range.right
		|| range.bottom >= rows.length)) {
		throw new RangeError('Invalid spreadsheet paste range.');
	}
	const columnCount = CLIP_SPREADSHEET_COLUMNS.length;
	const fullRow = range && range.top === range.bottom && range.left === 0 && range.right === columnCount - 1;
	const selected = fullRow && matrix.length > 1 ? { ...range, bottom: range.top + matrix.length - 1 }
		: range ?? { top: rows.length, left: 0, bottom: rows.length, right: 0 };
	const rowCount = range ? rows.length : rows.length + matrix.length;
	const edits: ClipSpreadsheetEdit[] = [];
	const newRows: Partial<Record<ClipSpreadsheetColumnId, string>>[] = [];
	let lastNewRowIndex = -1;
	let bottom = selected.top;
	let right = selected.left;
	forEachSpreadsheetPasteCell(matrix, selected, rowCount, columnCount, (row, columnIndex, value) => {
		const column = CLIP_SPREADSHEET_COLUMNS[columnIndex]!.id;
		const clip = rows[row];
		if (clip) edits.push({ clipId: clip.id, column, value });
		else {
			if (row !== lastNewRowIndex) { newRows.push({}); lastNewRowIndex = row; }
			newRows.at(-1)![column] = value;
		}
		bottom = row;
		right = Math.max(right, columnIndex);
	});
	return {
		edits,
		// Source presence and all clip properties are validated together by the domain planner.
		newRows,
		range: { top: selected.top, left: selected.left, bottom, right },
	};
}

export interface ClipSpreadsheetSourceFile {
	readonly name: string;
	readonly webkitRelativePath?: string;
	readonly relativePath?: string;
	readonly path?: string;
}

interface SourceReference {
	readonly path: string;
	readonly basename: string;
	readonly windows: boolean;
}

const AMBIGUOUS = Symbol('ambiguous source');
type FileMatch<SourceFile> = SourceFile | typeof AMBIGUOUS;

/** Match only files already granted by a chooser; path strings never authorize disk reads. */
export function matchClipSpreadsheetSourceFiles<SourceFile extends ClipSpreadsheetSourceFile>(
	references: readonly string[],
	files: readonly SourceFile[],
): ReadonlyMap<string, SourceFile> {
	if (references.length > MAX_SPREADSHEET_CELLS || files.length > MAX_SPREADSHEET_CELLS) {
		throw new RangeError('Spreadsheet source selection is too large.');
	}
	const exact = new Map<string, FileMatch<SourceFile>>();
	const basenames = new Map<string, FileMatch<SourceFile>>();
	const windowsBasenames = new Map<string, FileMatch<SourceFile>>();
	const canonicalExact = new Map<string, FileMatch<SourceFile>>();
	const canonicalBasenames = new Map<string, FileMatch<SourceFile>>();
	const canonicalWindowsBasenames = new Map<string, FileMatch<SourceFile>>();
	const selected = new Set(files);
	for (const file of selected) {
		const { webkitRelativePath, relativePath, path } = file;
		indexReference(sourceReference(file.name, true), file);
		if (webkitRelativePath) indexReference(sourceReference(webkitRelativePath), file);
		if (relativePath && relativePath !== webkitRelativePath) indexReference(sourceReference(relativePath), file);
		if (path && path !== relativePath && path !== webkitRelativePath) indexReference(sourceReference(path), file);
	}
	const matched = new Map<string, SourceFile>();
	const referencesByFile = new Map<SourceFile, string>();
	for (const value of references) {
		const normalized = value.normalize('NFC');
		const reference = sourceReference(value, exact.has(value) || canonicalExact.has(normalized));
		const basename = reference.windows ? reference.basename.toLowerCase() : reference.basename;
		const file = exact.get(reference.path)
			?? canonicalExact.get(reference.path === value ? normalized : reference.path.normalize('NFC'))
			?? (reference.windows ? windowsBasenames : basenames).get(basename)
			?? (reference.windows ? canonicalWindowsBasenames : canonicalBasenames).get(basename.normalize('NFC'));
		if (!file) throw new RangeError(`Selected source file is missing: ${value}`);
		if (file === AMBIGUOUS) throw new RangeError(`Selected source file is ambiguous: ${value}`);
		const previous = referencesByFile.get(file);
		if (previous !== undefined && previous !== reference.path) {
			throw new RangeError(`Distinct source paths are ambiguous for the selected file: ${value}`);
		}
		referencesByFile.set(file, reference.path);
		matched.set(value, file);
	}
	if (referencesByFile.size !== selected.size) throw new RangeError('Some selected files do not match the requested source files.');
	return matched;

	function indexReference(reference: SourceReference, file: SourceFile): void {
		const lowercase = reference.basename.toLowerCase();
		addMatch(exact, reference.path, file);
		addMatch(basenames, reference.basename, file);
		addMatch(windowsBasenames, lowercase, file);
		addMatch(canonicalExact, reference.path.normalize('NFC'), file);
		addMatch(canonicalBasenames, reference.basename.normalize('NFC'), file);
		addMatch(canonicalWindowsBasenames, lowercase.normalize('NFC'), file);
	}
}

function addMatch<SourceFile>(index: Map<string, FileMatch<SourceFile>>, key: string, file: SourceFile): void {
	const previous = index.get(key);
	if (previous === undefined) index.set(key, file);
	else if (previous !== file && previous !== AMBIGUOUS) index.set(key, AMBIGUOUS);
}

function sourceReference(value: string, literal = false): SourceReference {
	if (typeof value !== 'string' || !value.trim() || value.length > 4_096 || value.includes('\0')) {
		throw new RangeError('Invalid spreadsheet source reference.');
	}
	if (literal) return { path: value, basename: value, windows: false };
	let path = value;
	let windows = /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\');
	if (/^file:/iu.test(path)) {
		try {
			const url = new URL(path);
			if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password) throw new Error();
			path = decodeURIComponent(url.pathname);
			if (/^\/[a-z]:\//iu.test(path)) { path = path.slice(1); windows = true; }
			if (url.hostname && url.hostname !== 'localhost') { path = `//${url.hostname}${path}`; windows = true; }
		} catch { throw new RangeError('Invalid spreadsheet source file URL reference.'); }
	} else if (!windows && /^[a-z][a-z\d+.-]*:/iu.test(path)) {
		throw new RangeError('Spreadsheet source references must name local files.');
	}
	if (windows || !path.startsWith('/')) path = path.replaceAll('\\', '/');
	const prefix = path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
	const segments: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..' && segments.length && segments.at(-1) !== '..') segments.pop();
		else segments.push(segment);
	}
	path = `${prefix}${segments.join('/')}`;
	if (windows) path = path.toLowerCase();
	const basename = path.slice(path.lastIndexOf('/') + 1);
	if (!basename || basename === '..') throw new RangeError('Invalid spreadsheet source reference.');
	return { path, basename, windows };
}
