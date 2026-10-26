/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

/**
 * Read exported FCPXML with the pinned third-party adapter and verify the
 * resulting timeline. The adapter truncates fractional frame rates, so these
 * round trips use integer rates. Exact NTSC rationals and sequence timecodes
 * are covered by audio-editor-fcpxml-export.test.ts.
 */

const SAMPLE_RATE = 48_000;

/** Rates where the reader's integer truncation is a no-op, so the check is meaningful. */
const EXACT_RATES = Object.freeze([
	{ label: '24', num: 24, den: 1 },
	{ label: '25', num: 25, den: 1 },
	{ label: '30', num: 30, den: 1 },
	{ label: '50', num: 50, den: 1 },
	{ label: '60', num: 60, den: 1 },
]);

function project() {
	return {
		id: 'p', title: 'Reference', sampleRate: SAMPLE_RATE,
		sources: [
			{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' },
			{ kind: 'video', id: 'other', name: 'CAM B', storageKey: 'media/cam-b.mp4' },
		],
		clips: [
			{
				kind: 'video', id: 'c0', sourceId: 'src', title: 'A',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c1', sourceId: 'src', title: 'B',
				timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE * 2,
				sourceStartFrame: SAMPLE_RATE * 5, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c2', sourceId: 'other', title: 'C',
				timelineStartFrame: SAMPLE_RATE * 3, durationFrames: SAMPLE_RATE,
				sourceStartFrame: SAMPLE_RATE, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0', 'c1', 'c2'], hidden: false }],
	};
}

function readBack(text: string) {
	return referenceItems(readWithReference(text, 'fcpx_xml', {}, '.fcpxml'));
}

for (const { label, num, den } of EXACT_RATES) {
	test(`at ${label} the reference FCPXML reader recovers our timeline exactly`, () => {
		const result = createFcpxmlExport({ project: project(), sequenceRate: { num, den } });
		const items = readBack(result.text);
		const perSecond = num / den;

		assert.deepEqual(
			items.map((item) => ({ schema: item.schema, name: item.name })),
			[
				{ schema: 'Clip', name: 'A' },
				{ schema: 'Clip', name: 'B' },
				{ schema: 'Clip', name: 'C' },
			],
			'three contiguous clips and no invented gaps',
		);
		assert.deepEqual(
			items.map((item) => item.durationValue),
			[perSecond, perSecond * 2, perSecond],
			`durations at ${label} must survive the round trip as whole frames`,
		);
		assert.deepEqual(
			items.map((item) => item.startValue),
			[0, perSecond * 5, perSecond],
			'the source in-points we wrote are the ones the reader recovers',
		);
		for (const item of items) {
			assert.equal(item.durationRate, perSecond, 'the reader must recover the rate we declared');
		}
	});
}

test('the reader resolves our deduplicated assets rather than losing a reference', () => {
	// Two of the three clips share one source. Asset deduplication is only
	// correct if a reader still resolves every clip to media.
	const result = createFcpxmlExport({ project: project(), sequenceRate: { num: 25, den: 1 } });
	assert.equal((result.text.match(/<asset id=/gu) ?? []).length, 2, 'two sources, two assets');
	assert.equal(readBack(result.text).length, 3, 'three clips still resolve');
});

test('a clip we omitted is absent to the reader, and the rest is undamaged', () => {
	const blink = {
		...project(),
		clips: [
			...project().clips,
			{
				kind: 'video', id: 'blink', sourceId: 'src', title: 'Blink',
				timelineStartFrame: SAMPLE_RATE * 4, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0', 'c1', 'c2', 'blink'], hidden: false }],
	};
	const result = createFcpxmlExport({ project: blink, sequenceRate: { num: 25, den: 1 } });
	assert.ok(result.report.items.some((item) => item.code === 'fcpxml.sub-frame-clip-omitted'));
	assert.deepEqual(readBack(result.text).map((item) => item.name), ['A', 'B', 'C']);
});
