/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { createAudioTrackVisualRevisionReader } from '../src/common/editor/ui/timeline/audio-track-visual-revision.ts';
import { createAudioTrackRowPropReader, type AudioTrackRowMemoProps } from '../src/common/editor/ui/timeline/audio-track-row-props.ts';
import { useSpreadsheetRows, type SpreadsheetRowPresentation } from '../src/common/editor/ui/clip-spreadsheet/row-presentation.ts';
import type { ClipSpreadsheetRow } from '../src/common/editor/clip-spreadsheet.ts';

void test('U10 unchanged visual polls avoid scratch revision storage while observing every mutable visual', () => {
	let polls = 0, revisionWrites = 0;
	let buffer: unknown = {};
	const controller = { getClipVisualData: () => { polls++; return { available: true, buffer }; } };
	const clips = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }));
	const read = createAudioTrackVisualRevisionReader();
	const first = read(controller as never, clips);
	const push = Array.prototype.push;
	Array.prototype.push = function (this: unknown[], ...items: unknown[]) { if (items.length === 9) revisionWrites++; return Reflect.apply(push, this, items) as number; };
	try {
		for (let index = 0; index < 30; index++) assert.equal(read(controller as never, clips), first);
		assert.equal(polls, 3100);
		assert.equal(revisionWrites, 0, 'unchanged polls must not populate a throwaway nine-fields-per-clip array');
		buffer = {};
		assert.notEqual(read(controller as never, clips), first);
		assert.deepEqual(read(controller as never, []), []);
	} finally { Array.prototype.push = push; }
});

void test('U11 row selection narrowing allocates no intersection Sets for unchanged membership and observes in-place mutation', () => {
	const reader = createAudioTrackRowPropReader();
	const selected = new Set(['c']); const dragged = new Set(['c']);
	const props: AudioTrackRowMemoProps = { controller: { getClipVisualData: () => null }, track: { id: 't', type: 'audio' }, trackClips: [{ id: 'c', timelineStartFrame: 0, durationFrames: 100 }], clipLookup: new Map(), renderViewportStartFrame: 0, viewportDurationFrames: 100,
		selectedClipIdSet: selected, draggingClipIds: dragged };
	const first = reader.read(props);
	const OriginalSet = globalThis.Set; let allocations = 0;
	globalThis.Set = class MeasuredSet<T> extends OriginalSet<T> { constructor(values?: Iterable<T> | null) { super(values); allocations++; } } as SetConstructor;
	try {
		for (let index = 0; index < 30; index++) {
			const next = reader.read(props);
			assert.equal(next.selectedClipIdSet, first.selectedClipIdSet);
		}
		assert.equal(allocations, 0);
		selected.clear(); dragged.clear();
		const changed = reader.read(props);
		assert.equal((changed.selectedClipIdSet as ReadonlySet<string>).size, 0);
		assert.equal(changed.draggingClipIds, null);
		const preview = { trackId: 't', clipId: 'incoming' };
		selected.add('incoming');
		assert.deepEqual([...(reader.read({ ...props, clipDragPreview: preview }).selectedClipIdSet as ReadonlySet<string>)], ['incoming']);
	} finally { globalThis.Set = OriginalSet; }
});

void test('U12 spreadsheet rows share column descriptors by editability shape and refresh locale and row flags', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let labelReads = 0;
	let labels = { selectRow: 'Row {row}', get pitch() { labelReads++; return 'Pitch'; }, readOnly: 'Read only', linkedPitchReadOnly: 'Linked' };
	let rows = Array.from({ length: 500 }, (_, index) => ({ id: String(index), editable: true, pitchLinked: false, warpMapped: false, cells: {} } as unknown as ClipSpreadsheetRow));
	let presentation: readonly SpreadsheetRowPresentation[] = [];
	function Harness() { presentation = useSpreadsheetRows(rows, labels); return null; }
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		assert.equal(labelReads, 1);
		assert.equal(presentation[0]?.cells, presentation[499]?.cells);
		const first = presentation[0]?.cells;
		rows = [{ ...rows[0]!, pitchLinked: true }, rows[1]!];
		await act(async () => root.render(<Harness />));
		assert.equal(presentation[0]?.cells.find(cell => cell.id === 'pitch')?.editable, false);
		assert.equal(presentation[1]?.cells.find(cell => cell.id === 'pitch')?.editable, true);
		labels = { ...labels, pitch: 'Tonhöhe' };
		await act(async () => root.render(<Harness />));
		assert.notEqual(presentation[1]?.cells, first);
		assert.equal(presentation[1]?.cells.find(cell => cell.id === 'pitch')?.label, 'Tonhöhe');
	} finally { await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore(); }
});
