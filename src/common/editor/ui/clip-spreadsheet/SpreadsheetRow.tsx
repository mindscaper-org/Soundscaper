/* SPDX-License-Identifier: AGPL-3.0-only */
import { memo, useCallback, type RefObject } from 'react';
import type { ClipSpreadsheetEdit } from '../../clip-spreadsheet.ts';
import type { SpreadsheetCell } from './clipboard.ts';
import type { SpreadsheetRowPresentation } from './row-presentation.ts';

export interface SpreadsheetCellDraft extends SpreadsheetCell {
	readonly clipId: string;
	readonly value: string;
}

export interface SpreadsheetRowActions {
	finishEdit(): boolean;
	selectCell(cell: SpreadsheetCell, extend?: boolean): void;
	beginEdit(cell: SpreadsheetCell): void;
	updateDraft(draft: SpreadsheetCellDraft | null): void;
	apply(edits: readonly ClipSpreadsheetEdit[]): boolean;
	selectRow(row: number, extend: boolean): void;
	isDraftActive(): boolean;
	registerCell(row: number, column: number, element: HTMLElement | null): void;
}

interface SpreadsheetRowProps {
	readonly presentation: SpreadsheetRowPresentation;
	readonly rowIndex: number;
	readonly selectedLeft: number;
	readonly selectedRight: number;
	readonly activeColumn: number;
	readonly draft: SpreadsheetCellDraft | null;
	readonly blocked: boolean;
	readonly inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
	readonly actions: SpreadsheetRowActions;
}

export const SpreadsheetRow = memo(function SpreadsheetRow({
	presentation, rowIndex, selectedLeft, selectedRight, activeColumn, draft, blocked, inputRef, actions,
}: SpreadsheetRowProps) {
	const { row, cells } = presentation;
	return <tr>
		<th scope="row"><button type="button" tabIndex={-1} aria-label={presentation.label}
			onClick={event => actions.selectRow(rowIndex, event.shiftKey)}>{rowIndex + 1}</button></th>
		{cells.map(column => <SpreadsheetGridCell key={column.id} column={column} rowIndex={rowIndex} clipId={row.id}
			value={row.cells[column.id]} selected={selectedLeft >= 0 && column.column >= selectedLeft && column.column <= selectedRight}
			active={activeColumn === column.column} draft={draft?.clipId === row.id && draft.column === column.column ? draft : null}
			blocked={blocked} inputRef={inputRef} actions={actions} />)}
	</tr>;
});

interface SpreadsheetGridCellProps extends Pick<SpreadsheetRowProps, 'rowIndex' | 'draft' | 'blocked' | 'inputRef' | 'actions'> {
	readonly column: SpreadsheetRowPresentation['cells'][number];
	readonly clipId: string;
	readonly value: string;
	readonly selected: boolean;
	readonly active: boolean;
}

const SpreadsheetGridCell = memo(function SpreadsheetGridCell({
	column, rowIndex, clipId, value, selected, active, draft, blocked, inputRef, actions,
}: SpreadsheetGridCellProps) {
	const registerCell = useCallback((element: HTMLTableCellElement | null) => {
		actions.registerCell(rowIndex, column.column, element);
	}, [actions, rowIndex, column.column]);
	const registerInput = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
		inputRef.current = element;
	}, [inputRef]);
	const cell = { row: rowIndex, column: column.column };
	const checkbox = column.id === 'reversed' || column.id === 'inverted';
	const EditInput = draft && /[\r\n]/u.test(value) ? 'textarea' : 'input';
	return <td role="gridcell" data-row={rowIndex} data-column={column.id}
		ref={registerCell} aria-selected={selected} aria-readonly={blocked || !column.editable}
		tabIndex={active ? 0 : -1} title={column.title}
		onMouseDown={event => {
			if (event.button !== 0 || draft) return;
			if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
			if (actions.finishEdit()) actions.selectCell(cell, event.shiftKey);
		}}
		onMouseEnter={event => { if (event.buttons === 1 && !actions.isDraftActive()) actions.selectCell(cell, true); }}
		onDoubleClick={() => { if (!checkbox) actions.beginEdit(cell); }}>
		{draft ? <EditInput ref={registerInput} aria-label={column.label} value={draft.value}
			onChange={event => actions.updateDraft({ ...draft, value: event.currentTarget.value })}
			onBlur={() => { actions.finishEdit(); }} /> : checkbox
			? <input type="checkbox" aria-label={column.label} tabIndex={-1} checked={value === 'true'}
				disabled={blocked || !column.editable} onChange={event => {
					actions.apply([{ clipId, column: column.id, value: String(event.currentTarget.checked) }]);
				}} /> : value}
	</td>;
});
