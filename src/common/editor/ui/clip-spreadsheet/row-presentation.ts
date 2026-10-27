/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo, useRef } from 'react';
import { CLIP_SPREADSHEET_COLUMNS, isClipSpreadsheetCellEditable, type ClipSpreadsheetRow } from '../../clip-spreadsheet.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';

export function useSpreadsheetRowIdentity(rows: readonly ClipSpreadsheetRow[]): string {
	return useMemo(() => rows.map(({ id }) => id).join('\0'), [rows]);
}

export function useSpreadsheetRows(rows: readonly ClipSpreadsheetRow[], labels: Readonly<Record<string, string>>) {
	const rowIds = useRef(new WeakMap<ClipSpreadsheetRow, string>());
	const retained = useRef<{ labels: Readonly<Record<string, string>>; rows: Map<string, SpreadsheetRowPresentation> }>({ labels, rows: new Map() });
	return useMemo(() => {
		const previous = retained.current.labels === labels ? retained.current.rows : new Map<string, SpreadsheetRowPresentation>();
		const next = new Map<string, SpreadsheetRowPresentation>();
		// Three boolean flags produce at most eight column descriptor shapes.
		const shapes = new Map<number, SpreadsheetCellPresentation[]>();
		const presentations = rows.map((row, rowIndex) => {
			const id = rowIds.current.get(row) ?? row.id;
			rowIds.current.set(row, id);
			const label = formatLocalizedTemplate(labels.selectRow, { row: rowIndex + 1 });
			const prior = previous.get(id);
			if (prior?.label === label && prior.row.kind === row.kind && prior.row.editable === row.editable
				&& prior.row.pitchLinked === row.pitchLinked && prior.row.warpMapped === row.warpMapped
				&& CLIP_SPREADSHEET_COLUMNS.every(column => prior.row.cells[column.id] === row.cells[column.id])) { next.set(id, prior); return prior; }
			const shape = Number(row.editable) + Number(Boolean(row.pitchLinked)) * 2 + Number(Boolean(row.warpMapped)) * 4;
			let cells = shapes.get(shape);
			if (!cells) {
				cells = CLIP_SPREADSHEET_COLUMNS.map((column, columnIndex) => {
					const editable = isClipSpreadsheetCellEditable(row, column.id);
					return {
						id: column.id, column: columnIndex, editable, label: labels[column.id],
						title: editable ? undefined : row.pitchLinked && column.id === 'pitch' ? labels.linkedPitchReadOnly : labels.readOnly,
					};
				});
				shapes.set(shape, cells);
			}
			const presentation = { row, label, cells };
			next.set(id, presentation);
			return presentation;
		});
		retained.current = { labels, rows: next };
		return presentations;
	}, [rows, labels]);
}

interface SpreadsheetCellPresentation {
	readonly id: (typeof CLIP_SPREADSHEET_COLUMNS)[number]['id'];
	readonly column: number;
	readonly editable: boolean;
	readonly label: string;
	readonly title: string | undefined;
}

export interface SpreadsheetRowPresentation {
	readonly row: ClipSpreadsheetRow;
	readonly label: string;
	readonly cells: readonly SpreadsheetCellPresentation[];
}

/** Mounted cell ownership avoids a full table selector traversal on navigation. */
export function createSpreadsheetCellIndex() {
	const cells = new Map<number, HTMLElement>();
	const key = (row: number, column: number) => row * CLIP_SPREADSHEET_COLUMNS.length + column;
	return {
		register(row: number, column: number, element: HTMLElement | null): void {
			const cell = key(row, column);
			if (element) cells.set(cell, element); else cells.delete(cell);
		},
		focus(row: number, column: number, preventScroll = false): void {
			cells.get(key(row, column))?.focus({ preventScroll });
		},
		size: () => cells.size,
	};
}
