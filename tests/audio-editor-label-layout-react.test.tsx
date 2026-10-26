/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useTimelineLabelTrackContentHeights } from '../src/common/editor/ui/timeline/useTimelineViewportDerived.ts';

void test('unrelated audio-track edits reuse immutable label heights and font completion repaints geometry', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const fonts = new EventTarget();
	const createElement = document.createElement.bind(document);
	let measurements = 0, width = 20;
	let sorts = 0;
	const originalSort = Object.getOwnPropertyDescriptor(Array.prototype, 'sort')!;
	Object.defineProperty(Array.prototype, 'sort', { ...originalSort, value(this: unknown[], compare?: (left: unknown, right: unknown) => number) {
		sorts++;
		return (originalSort.value as (this: unknown[], compare?: (left: unknown, right: unknown) => number) => unknown[]).call(this, compare);
	} });
	Object.defineProperty(document, 'fonts', { value: fonts });
	Object.defineProperty(document, 'createElement', { value: (tag: string) => tag === 'canvas'
		? { getContext: () => ({ font: '', measureText() { measurements++; return { width }; } }) }
		: createElement(tag) });
	const labels = Object.freeze([
		Object.freeze({ id: 'a', title: 'First', startFrame: 0, endFrame: 0 }),
		Object.freeze({ id: 'b', title: 'Second', startFrame: 100, endFrame: 100 }),
	]);
	let result: ReadonlyMap<string, number> = new Map();
	function Harness({ revision }: { revision: number }) {
		// Publication detaches every label object before runtime projection replaces its container.
		const tracks = [{ id: 'audio', type: 'audio', gain: revision / 10 },
			{ id: 'labels', type: 'label', labels: Object.freeze(labels.map(label => Object.freeze({ ...label }))) }];
		result = useTimelineLabelTrackContentHeights(tracks, 100, 100, 9);
		return <span>{result.get('labels')}</span>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />));
		const first = result, initial = measurements, initialSorts = sorts;
		for (let revision = 1; revision <= 20; revision++) await act(async () => root.render(<Harness revision={revision} />));
		assert.equal(result, first, 'unrelated edits preserve the height-map dependency');
		assert.equal(measurements, initial, 'unrelated edits do not remeasure labels');
		assert.equal(sorts, initialSorts, 'equal detached label geometry does not repeat packing preparation');
		width = 200;
		await act(async () => { fonts.dispatchEvent(new Event('loadingdone')); });
		assert.equal(result.get('labels'), 66, 'font completion publishes the new height without another project edit');
		assert.notEqual(result, first);
	} finally {
		await act(async () => root.unmount());
		Object.defineProperty(Array.prototype, 'sort', originalSort);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
