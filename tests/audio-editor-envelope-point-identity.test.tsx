/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EnvelopeInteractionLayer, type EnvelopePoint } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/EnvelopeInteractionLayer.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const original = [{ time: .2, db: 0 }, { time: .4, db: -12 }, { time: .8, db: 0 }];
const crossingCases = [
	{ title: 'rightward', point: 0, moves: [.6], remaining: [.6, .8] },
	{ title: 'leftward', point: 2, moves: [.3], remaining: [.2, .3] },
	{ title: 'extra move', point: 0, moves: [.6, .61], remaining: [.61, .8] },
	{ title: 'origin', point: 2, moves: [0], remaining: [0] },
	{ title: 'noncrossing', point: 0, moves: [.3], remaining: [.3, .4, .8] },
];

for (const scenario of crossingCases) test(`${scenario.title} gain-point drag preserves its identity when points sort`, async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(scenario.point);
		for (const time of scenario.moves) await fixture.move(time);
		await fixture.release();
		assert.deepEqual(fixture.points().map(point => point.time), scenario.remaining);
		assert.deepEqual(fixture.hidden(), []);
	});
});

test('crossing several gain points removes all crossed neighbors and keeps the moved point', async () => {
	await withEnvelope([{ time: .1, db: 0 }, { time: .3, db: -6 }, { time: .5, db: -12 }, { time: .9, db: 0 }], async fixture => {
		await fixture.begin(0); await fixture.move(.7); await fixture.release();
		assert.deepEqual(fixture.points().map(point => point.time), [.7, .9]);
	});
});

test('the hidden-point projection follows the sorted preview instead of hiding the moved point', async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(0); await fixture.move(.6);
		assert.deepEqual(fixture.hidden(), [0]);
		assert.equal(fixture.points()[fixture.hidden()[0]!]!.time, .4);
	});
});

test('a zero-gain point stays owned through further movement after sorting', async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(0); await fixture.move(.6, -Infinity); await fixture.move(.7, -Infinity); await fixture.release();
		assert.deepEqual(fixture.points(), [{ time: .7, db: -Infinity }, { time: .8, db: 0 }]);
	});
});

test('an auxiliary release cannot finish a sorted point drag', async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(0); await fixture.move(.6); await fixture.release(2);
		assert.equal(fixture.points().length, 3);
		await fixture.move(.61); await fixture.release();
		assert.deepEqual(fixture.points().map(point => point.time), [.61, .8]);
	});
});

test('Escape restores the original points after a sorted drag and leaves later unheld movement idle', async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(0); await fixture.move(.6); await fixture.escape();
		assert.deepEqual(fixture.points(), original);
		await fixture.move(.7); await fixture.release();
		assert.deepEqual(fixture.points(), original);
	});
});

test('disabled gain editing leaves authored points untouched', async () => {
	await withEnvelope(original, async fixture => {
		await fixture.begin(0); await fixture.move(.6); await fixture.release();
		assert.deepEqual(fixture.points(), original);
	}, false);
});

test('an admitted 10000-point envelope keeps sorted-reference scans bounded during a large crossing', async () => {
	const count = 10_000, sampleRate = 48_000;
	const source = createAudioSource({ id: 'source', sampleRate, frameCount: sampleRate, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, durationFrames: sampleRate,
		sourceStartFrame: 0, sourceDurationFrames: sampleRate, envelope: Array.from({ length: count }, (_, index) => ({ frame: index * 4, value: 1 })) });
	const project = createCurrentAudioEditorProject({ sampleRate, sources: [source], clips: [clip], tracks: [createAudioTrack({ clipIds: [clip.id] })] });
	const admittedEnvelope = project.clips[0]?.envelope;
	assert.ok(Array.isArray(admittedEnvelope));
	assert.equal(admittedEnvelope.length, count);
	const points = clip.envelope.map(point => ({ time: point.frame / sampleRate, db: 20 * Math.log10(point.value) }));
	await withEnvelope(points, async fixture => {
		let scannedReferences = 0;
		const indexOf = Array.prototype.indexOf;
		Array.prototype.indexOf = function(this: unknown[], searchElement: unknown, fromIndex?: number): number {
			const first = this[0];
			if (this.length === count && first !== null && typeof first === 'object' && 'time' in first && 'db' in first) scannedReferences += this.length;
			return indexOf.call(this, searchElement, fromIndex);
		};
		try {
			await fixture.begin(0); await fixture.move(.9); await fixture.release();
			assert.ok(fixture.points().length < 2_000, 'the gesture must cross thousands of admitted points');
			assert.ok(scannedReferences <= count * 4, `sorted-reference scans exceeded linear work: ${scannedReferences}`);
		} finally { Array.prototype.indexOf = indexOf; }
	});
});

async function withEnvelope(initial: readonly EnvelopePoint[], check: (fixture: {
	points(): readonly EnvelopePoint[]; hidden(): readonly number[];
	begin(index: number): Promise<void>; move(time: number, db?: number): Promise<void>;
	release(button?: number): Promise<void>; escape(): Promise<void>;
}) => Promise<void>, enabled = true): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const callbacks = listeners.get(type) ?? new Set<EventListener>(); callbacks.add(listener); listeners.set(type, callbacks);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	let latest: EnvelopePoint[] = [], hidden: readonly number[] = [];
	function Fixture() {
		const [points, setPoints] = useState(initial.map(point => ({ ...point })));
		latest = points;
		return <EnvelopeInteractionLayer envelopePoints={points} onEnvelopePointsChange={setPoints}
			onHiddenPointsChange={indices => { hidden = indices; }} enabled={enabled} width={100} height={100} duration={1} />;
	}
	const root = createRoot(dom.container as unknown as Element);
	const dispatch = async (type: string, event: object) => { await act(async () => { for (const listener of [...listeners.get(type) ?? []]) listener(event as Event); }); };
	const pointY = (db: number) => db === -Infinity ? 100 : 97 * (1 - ((db + 60) / 72) ** 3);
	try {
		await act(async () => root.render(<Fixture />));
		const layer = dom.find('div'); assert.equal(Boolean(layer), enabled);
		if (layer) layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
		await check({ points: () => latest, hidden: () => hidden,
			async begin(index) { if (!layer) return; const point = latest[index]!; await act(async () => { reactProps(layer).onMouseDown?.({ button: 0, clientX: point.time * 100, clientY: pointY(point.db), stopPropagation() {} }); }); },
			move: (time, db = 0) => dispatch('mousemove', { buttons: 1, clientX: time * 100, clientY: pointY(db) }),
			release: (button = 0) => dispatch('mouseup', { button }),
			escape: () => dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }),
		});
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
}
