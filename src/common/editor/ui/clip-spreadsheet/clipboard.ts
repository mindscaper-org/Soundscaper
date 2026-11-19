/* SPDX-License-Identifier: AGPL-3.0-only */

export const MAX_SPREADSHEET_CELLS = 100_000;
export const MAX_SPREADSHEET_TEXT_LENGTH = 4_000_000;

export interface SpreadsheetCell {
	row: number;
	column: number;
}

export interface SpreadsheetRange {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

export interface SpreadsheetPasteCell extends SpreadsheetCell {
	value: string;
}

type SpreadsheetMatrix = readonly (readonly string[])[];

function isCoordinate(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function assertCellCount(count: number): void {
	if (count > MAX_SPREADSHEET_CELLS) throw new Error('Spreadsheet data is too large.');
}

function assertTextLength(length: number): void {
	if (length > MAX_SPREADSHEET_TEXT_LENGTH) throw new Error('Spreadsheet data is too large.');
}

function matrixWidth(matrix: SpreadsheetMatrix): number {
	const width = matrix[0]?.length ?? 0;
	if (!matrix.length || !width) throw new Error('Spreadsheet data is empty.');
	assertCellCount(matrix.length * width);
	if (matrix.some((row) => row.length !== width)) {
		throw new Error('Spreadsheet data must be rectangular.');
	}
	return width;
}

export function normalizeSpreadsheetRange(anchor: SpreadsheetCell, focus: SpreadsheetCell): SpreadsheetRange {
	if (![anchor.row, anchor.column, focus.row, focus.column].every(isCoordinate)) {
		throw new Error('Invalid spreadsheet selection range.');
	}
	return {
		top: Math.min(anchor.row, focus.row),
		left: Math.min(anchor.column, focus.column),
		bottom: Math.max(anchor.row, focus.row),
		right: Math.max(anchor.column, focus.column),
	};
}

/** Plain clipboard text can contain literal quotes inside a single cell. */
export function parseSpreadsheetClipboard(text: string): string[][] {
	assertTextLength(text.length);
	if (!text.startsWith('"') && !/[\t\r\n]/u.test(text)) return [[text]];
	return parseSpreadsheetTsv(text);
}

/** Parse the quoted tab-separated format used by spreadsheet clipboard exports. */
export function parseSpreadsheetTsv(text: string): string[][] {
	assertTextLength(text.length);
	const rows: string[][] = [];
	let row: string[] = [];
	let cellCount = 0;
	let index = 0;
	const separators = /[\t\r\n"]/gu;
	for (;;) {
		let field: string;
		if (text[index] === '"') {
			let start = index + 1;
			let parts: string[] | undefined;
			for (;;) {
				const quote = text.indexOf('"', start);
				if (quote < 0) throw new Error('Unclosed quote in a spreadsheet cell.');
				if (text[quote + 1] !== '"') {
					const tail = text.slice(start, quote);
					field = parts ? parts.join('') + tail : tail;
					index = quote + 1;
					break;
				}
				(parts ??= []).push(text.slice(start, quote + 1));
				start = quote + 2;
			}
			if (index < text.length && text[index] !== '\t' && text[index] !== '\r' && text[index] !== '\n') {
				throw new Error('Invalid text after a quoted spreadsheet cell.');
			}
		} else {
			separators.lastIndex = index;
			const match = separators.exec(text);
			if (match?.[0] === '"') throw new Error('Invalid quote in a spreadsheet cell.');
			const end = match?.index ?? text.length;
			field = text.slice(index, end);
			index = end;
		}
		assertCellCount(++cellCount);
		row.push(field);
		if (text[index] === '\t') { index++; continue; }
		if (rows.length && row.length !== rows[0].length) {
			throw new Error('Spreadsheet data must be rectangular.');
		}
		rows.push(row);
		if (index >= text.length) return rows;
		index += text[index] === '\r' && text[index + 1] === '\n' ? 2 : 1;
		if (index >= text.length) return rows;
		row = [];
	}
}

export function serializeSpreadsheetTsv(matrix: SpreadsheetMatrix): string {
	matrixWidth(matrix);
	let length = 0;
	return matrix.map((row, rowIndex) => row.map((value, columnIndex) => {
		assertTextLength(value.length);
		const encoded = /[\t\r\n"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
		length += encoded.length + (columnIndex > 0 ? 1 : rowIndex > 0 ? 2 : 0);
		assertTextLength(length);
		return encoded;
	}).join('\t')).join('\r\n');
}

/** Return an atomic paste plan; the caller validates clip properties before applying it. */
export function planSpreadsheetPaste(
	matrix: SpreadsheetMatrix,
	range: SpreadsheetRange,
	rowCount: number,
	columnCount: number,
): SpreadsheetPasteCell[] {
	const cells: SpreadsheetPasteCell[] = [];
	forEachSpreadsheetPasteCell(matrix, range, rowCount, columnCount, (row, column, value) => cells.push({ row, column, value }));
	return cells;
}

/** Admit dimensions before emitting any cell, then visit the tiled values in row order. */
export function forEachSpreadsheetPasteCell(matrix: SpreadsheetMatrix, range: SpreadsheetRange, rowCount: number,
	columnCount: number, visit: (row: number, column: number, value: string) => void): void {
	const sourceWidth = matrixWidth(matrix);
	if (![rowCount, columnCount].every(isCoordinate)) throw new Error('Invalid spreadsheet dimensions.');
	if (![range.top, range.left, range.bottom, range.right].every(isCoordinate)
		|| range.top > range.bottom || range.left > range.right) {
		throw new Error('Invalid spreadsheet selection range.');
	}
	const singleCell = range.top === range.bottom && range.left === range.right;
	const height = singleCell ? matrix.length : range.bottom - range.top + 1;
	const width = singleCell ? sourceWidth : range.right - range.left + 1;
	if (range.top + height > rowCount || range.left + width > columnCount) {
		throw new Error('Pasted cells extend outside the spreadsheet.');
	}
	if (height % matrix.length !== 0 || width % sourceWidth !== 0) {
		throw new Error('Pasted data dimensions do not fit the selected range.');
	}
	assertCellCount(height * width);
	const endRow = range.top + height, endColumn = range.left + width;
	let sourceRow = 0;
	for (let row = range.top; row < endRow; row += 1) {
		const values = matrix[sourceRow]!;
		let sourceColumn = 0;
		for (let column = range.left; column < endColumn; column += 1) {
			visit(row, column, values[sourceColumn]!);
			if (++sourceColumn === sourceWidth) sourceColumn = 0;
		}
		if (++sourceRow === matrix.length) sourceRow = 0;
	}
}
