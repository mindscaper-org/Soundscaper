/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import type { TimelineClipVisualData } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const samples = new Float32Array(1_000).fill(0.25);
const buffered: TimelineClipVisualData = { available: true, buffer: { numberOfChannels: 1, getChannelData: () => samples } };

for (const blocked of [false, true]) test(`available source without waveform caches supports pointer audition when mutationBlocked=${blocked}`, async () => {
	const f = await fixture({ available: true, buffer: null, peaks: null }, blocked);
	try {
		assert.equal(f.play.hasAttribute('disabled'), false);
		assert.equal(f.ruler.getAttribute('aria-disabled'), 'false');
		await f.playPointer();
		assert.deepEqual(f.played, ['clip']);
	} finally { await f.cleanup(); }
});

test('a cached ordinary WAV retains its pointer audition', async () => {
	const f = await fixture(buffered);
	try {
		assert.equal(f.play.hasAttribute('disabled'), false);
		await f.playPointer();
		assert.deepEqual(f.played, ['clip']);
	} finally { await f.cleanup(); }
});

const unavailableVisuals: readonly (TimelineClipVisualData | null)[] = [null, {}, { ...buffered, available: false }];
for (const visual of unavailableVisuals) {
	test(`source audition retains unavailable admission for ${visual === null ? 'missing visual' : visual.available === false ? 'unavailable stored source' : 'unknown availability'}`, async () => {
		const f = await fixture(visual);
		try {
			assert.equal(f.play.hasAttribute('disabled'), true);
			assert.equal(f.ruler.getAttribute('aria-disabled'), 'true');
			assert.deepEqual(f.played, []);
		} finally { await f.cleanup(); }
	});
}

test('busy preview admission still disables an available uncached source', async () => {
	const f = await fixture({ available: true }, true, true);
	try {
		assert.equal(f.play.hasAttribute('disabled'), true);
		assert.equal(f.ruler.getAttribute('aria-disabled'), 'true');
		assert.deepEqual(f.played, []);
	} finally { await f.cleanup(); }
});

async function fixture(visual: TimelineClipVisualData | null, blocked = false, previewBlocked = false) {
	const dom = installReactTestDom();
	Object.defineProperties(window, {
		requestAnimationFrame: { value: globalThis.requestAnimationFrame },
		cancelAnimationFrame: { value: globalThis.cancelAnimationFrame },
	});
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const project: ClipSourceProject = {
		id: 'source-audition', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 1_000 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 1_000, durationFrames: 1_000 }],
	};
	const played: string[] = [], noop = () => undefined;
	const controller: ClipSourceController = { getClipVisualData: () => visual, actions: {
		clip: { update: noop }, audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop },
		timeline: {}, effects: { setSourceSelection: noop }, clipSourcePreview: {
			focus: noop, blur: noop, playPause: id => { played.push(id); }, stop: noop, seek: noop,
			setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }),
			subscribe: () => noop,
		},
	} };
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip"
		copy={ENGLISH_COPY} blocked={blocked} previewBlocked={previewBlocked} run={operation => operation()} />));
	const play = dom.one('[aria-label="Play"]');
	return {
		play, played, ruler: dom.one('[aria-label="Source timeline"]'),
		playPointer: async () => { await act(async () => { reactProps(play).onClick(); }); },
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
