/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
	getLabelMetrics, layoutTimelineLabels, timelineLabelTrackContentHeight,
	type TimelineLabelRange,
} from '../src/common/editor/ui/timeline/label-design-geometry.ts';
import { createTimelineLabelTrackHeightReader } from '../src/common/editor/ui/timeline/label-track-height-reader.ts';

function installMeasurementDocument() {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const fonts = new EventTarget();
	let measurements = 0;
	let width = 20;
	const context = { font: '', measureText() { measurements++; return { width }; } };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: {
		fonts, createElement: () => ({ getContext: () => context }),
	} });
	return {
		fonts, count: () => measurements, setWidth(value: number) { width = value; },
		restore() {
			if (prior) Object.defineProperty(globalThis, 'document', prior);
			else Reflect.deleteProperty(globalThis, 'document');
		},
	};
}

const point = (id: string, startFrame: number, title = id) => Object.freeze({ id, title, startFrame, endFrame: startFrame });

void test('warm zooms reuse immutable label ordering and measured text without caching mutable layouts', () => {
	const document = installMeasurementDocument();
	let elementReads = 0;
	const labels = new Proxy(Object.freeze(Array.from({ length: 1_000 }, (_, index) => point(String(index), index * 100))), {
		get(target, key, receiver): unknown {
			if (typeof key === 'string' && /^\d+$/u.test(key)) elementReads++;
			return Reflect.get(target, key, receiver);
		},
	});
	try {
		timelineLabelTrackContentHeight(labels, 100, 100);
		const initial = document.count();
		elementReads = 0;
		for (let zoom = 101; zoom < 111; zoom++) timelineLabelTrackContentHeight(labels, zoom, 100);
		assert.equal(document.count(), initial, 'zoom does not repeat text measurement');
		assert.equal(elementReads, 0, 'zoom does not copy or sort the authored array again');
		const first = layoutTimelineLabels(labels, 100, 100, getLabelMetrics());
		first.set('0', { row: 123, width: 50 });
		assert.equal(layoutTimelineLabels(labels, 100, 100, getLabelMetrics()).get('0')!.row, 0, 'returned maps remain independently mutable');
	} finally { document.restore(); }
});

void test('height-only packing preserves layout rows, stable ties, and exact adjacency', () => {
	const document = installMeasurementDocument();
	try {
		let random = 123;
		const next = () => { random = (random * 1664525 + 1013904223) >>> 0; return random; };
		for (let trial = 0; trial < 60; trial++) {
			const labels = Object.freeze(Array.from({ length: 80 }, (_, index) => {
				const startFrame = next() % 300;
				return Object.freeze({ id: String(index), title: String(index),
					startFrame, endFrame: startFrame + (next() % 3 === 0 ? 0 : next() % 100) });
			}));
			for (const zoom of [0.1, 10, 100, 100_000]) for (const size of [9, 24, 48]) {
				const metrics = getLabelMetrics(size);
				const expected = 18 + Math.max(0, ...[...layoutTimelineLabels(labels, zoom, 100, metrics).values()].map(item => item.row))
					* metrics.rowHeight + metrics.bannerHeight + 4;
				assert.equal(timelineLabelTrackContentHeight(labels, zoom, 100, size), expected);
			}
		}
	} finally { document.restore(); }
});

void test('mutable labels retain fresh geometry and title authority', () => {
	const document = installMeasurementDocument();
	try {
		const labels = [{ id: 'a', title: 'first', startFrame: 0, endFrame: 0 },
			{ id: 'b', title: 'second', startFrame: 100, endFrame: 100 }];
		assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 42);
		labels[1]!.startFrame = 0; labels[1]!.endFrame = 0;
		assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 66);
		const frozenContainer = Object.freeze(labels);
		labels[1]!.startFrame = 100; labels[1]!.endFrame = 100;
		assert.equal(timelineLabelTrackContentHeight(frozenContainer, 100, 100), 42);
		labels[1]!.startFrame = 0; labels[1]!.endFrame = 0;
		assert.equal(timelineLabelTrackContentHeight(frozenContainer, 100, 100), 66);
		document.setWidth(200); labels[1]!.title = 'a different title';
		assert.equal(layoutTimelineLabels(frozenContainer, 100, 100, getLabelMetrics()).get('b')?.width, 208);
	} finally { document.restore(); }
});

void test('prepared label-array retention evicts old containers', () => {
	const document = installMeasurementDocument();
	let reads = 0;
	const first = new Proxy(Object.freeze([point('retained', 0)]), {
		get(target, key, receiver): unknown { if (key === '0') reads++; return Reflect.get(target, key, receiver); },
	});
	try {
		timelineLabelTrackContentHeight(first, 100, 100);
		for (let index = 0; index < 33; index++) timelineLabelTrackContentHeight(Object.freeze([point(String(index), 0)]), 100, 100);
		reads = 0;
		timelineLabelTrackContentHeight(first, 100, 100);
		assert.ok(reads > 0, 'an old container is admitted again after the bounded cache evicts it');
	} finally { document.restore(); }
});

void test('closed and replaced label owners release their source records and opaque metadata', () => {
	const geometry = new URL('../src/common/editor/ui/timeline/label-design-geometry.ts', import.meta.url).href;
	const reader = new URL('../src/common/editor/ui/timeline/label-track-height-reader.ts', import.meta.url).href;
	const child = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '--eval', `
		import assert from 'node:assert/strict';
		import { setImmediate } from 'node:timers/promises';
		import { timelineLabelTrackContentHeight } from ${JSON.stringify(geometry)};
		import { createTimelineLabelTrackHeightReader } from ${JSON.stringify(reader)};
		const read = createTimelineLabelTrackHeightReader();
		function owner(id) {
			const opaque = { payload: new Uint8Array(1024 * 1024) };
			const label = Object.freeze({ id, title: id, startFrame: 0, endFrame: 0, opaqueExtensions: opaque });
			const labels = Object.freeze([label]);
			return { labels, references: [new WeakRef(labels), new WeakRef(label), new WeakRef(opaque)] };
		}
		function prepare() {
			const closed = owner('closed');
			timelineLabelTrackContentHeight(closed.labels, 100, 100);
			const previous = owner('current');
			read([{ id: 'track', type: 'label', labels: previous.labels }], 100, 100, 9);
			const current = owner('current');
			read([{ id: 'track', type: 'label', labels: current.labels }], 100, 100, 9);
			return { current, references: [...closed.references, ...previous.references] };
		}
		const fixture = prepare();
		for (let round = 0; round < 4; round++) { await setImmediate(); globalThis.gc(); }
		assert.ok(fixture.references.every(reference => reference.deref() === undefined),
			'prepared geometry and height reuse must not keep retired project records alive');
		assert.equal(read([{ id: 'track', type: 'label', labels: fixture.current.labels }], 100, 100, 9).get('track'), 42);
	`], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10_000 });
	assert.equal(child.status, 0, child.stderr || child.stdout || child.error?.message || 'GC regression process failed');
});

void test('track height reuse never trusts mutable containers or changed label data', () => {
	const document = installMeasurementDocument();
	const read = createTimelineLabelTrackHeightReader();
	const labels = [{ id: 'a', title: 'First', startFrame: 0, endFrame: 0 },
		{ id: 'b', title: 'Second', startFrame: 100, endFrame: 100 }];
	try {
		assert.equal(read([{ id: 'labels', type: 'label', labels }], 100, 100, 9).get('labels'), 42);
		labels[1]!.startFrame = 0; labels[1]!.endFrame = 0;
		assert.equal(read([{ id: 'labels', type: 'label', labels }], 100, 100, 9).get('labels'), 66);
		const frozen = Object.freeze(labels.map(label => Object.freeze({ ...label })));
		assert.equal(read([{ id: 'labels', type: 'label', labels: frozen }], 100, 100, 9).get('labels'), 66);
		const changed = Object.freeze([frozen[0]!, point('b', 100)]);
		assert.equal(read([{ id: 'labels', type: 'label', labels: changed }], 100, 100, 9).get('labels'), 42);
		assert.equal(read([], 100, 100, 9).size, 0, 'removed tracks retire their height');
	} finally { document.restore(); }
});

void test('font completion, font size and document changes invalidate measured widths and cached heights', () => {
	const document = installMeasurementDocument();
	const labels = Object.freeze([point('a', 0), point('b', 100)]);
	try {
		assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 42);
		const initial = document.count();
		timelineLabelTrackContentHeight(labels, 100, 100, 24);
		assert.ok(document.count() > initial, 'the new canvas font is measured');
		document.setWidth(200);
		document.fonts.dispatchEvent(new Event('loadingdone'));
		assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 66, 'completed font loading replaces fallback widths');
		document.setWidth(20);
		document.fonts.dispatchEvent(new Event('loadingerror'));
		assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 42, 'failed font loading also updates the resolved face');
		const other = installMeasurementDocument();
		try {
			other.setWidth(200);
			assert.equal(timelineLabelTrackContentHeight(labels, 100, 100), 66);
			assert.equal(other.count(), 2, 'a replacement document owns its own canvas and fonts');
		} finally { other.restore(); }
	} finally { document.restore(); }
});

void test('text-width retention is bounded while repeated titles share measurement across label arrays', () => {
	const document = installMeasurementDocument();
	try {
		layoutTimelineLabels([point('a', 0, 'shared'), point('b', 100, 'shared')], 100, 100, getLabelMetrics());
		assert.equal(document.count(), 1);
		const labels: TimelineLabelRange[] = Array.from({ length: 65_537 }, (_, index) => point(String(index), index * 100));
		layoutTimelineLabels(labels, 100, 100, getLabelMetrics());
		const prior = document.count();
		layoutTimelineLabels([point('again', 0, 'shared')], 100, 100, getLabelMetrics());
		assert.equal(document.count(), prior + 1, 'old widths are evicted instead of retaining every title forever');
	} finally { document.restore(); }
});
