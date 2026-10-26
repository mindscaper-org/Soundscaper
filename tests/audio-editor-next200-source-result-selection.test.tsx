/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const sampleRate of [48_000, 24_000]) for (const reversed of [false, true]) {
	test(`Source monitor retains a length-changing effect result at ${sampleRate} Hz, reversed=${reversed}`, async () => {
		const f = await fixture(sampleRate, reversed);
		try {
			await f.select(400, 500);
			const before = f.target();
			assert.ok(before);
			await f.replace(100);
			assert.equal(f.target()?.startFrame, before.startFrame);
			assert.equal(f.target()?.endFrame, before.endFrame + 100);
			await f.undo();
			assert.equal(f.target()?.startFrame, before.startFrame);
			assert.equal(f.target()?.endFrame, before.endFrame);
		} finally { await f.cleanup(); }
	});
}

test('a source replacement without an explicit highlight retains the complete active clip', async () => {
	const f = await fixture(48_000, false);
	try {
		await f.replace(100);
		assert.equal(f.target()?.startFrame, 100);
		assert.equal(f.target()?.endFrame, 1_000);
	} finally { await f.cleanup(); }
});

test('same-length source replacement keeps the selected samples', async () => {
	const f = await fixture(48_000, false);
	try {
		await f.select(400, 500);
		const before = f.target();
		await f.replace(0);
		assert.equal(f.target()?.startFrame, before?.startFrame);
		assert.equal(f.target()?.endFrame, before?.endFrame);
	} finally { await f.cleanup(); }
});

async function fixture(sampleRate: number, reversed: boolean) {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const ratio = 48_000 / sampleRate;
	let project: ClipSourceProject & EffectSelectionProject = {
		id: 'project', schemaVersion: 1, sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate, channelCount: 1, frameCount: 1_000 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Recording', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 100, sourceDurationFrames: 800, durationFrames: 800 * ratio, reversed }],
	};
	const initial = project;
	const sourceEditor = createSourceEditorEffects({ getProject: () => project,
		loadSourceBuffer: async () => null, publishDocumentSnapshot() {} });
	let focused = true;
	const noop = () => undefined;
	const effects = { setSourceSelection: sourceEditor.setSourceSelection, readSourceSelection: () => {
		const target = sourceEditor.target();
		return target ? { clipId: target.sourceClipId!, startFrame: target.startFrame, endFrame: target.endFrame } : null;
	} };
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: noop }, timeline: {}, audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop },
		effects, clipSourcePreview: { focus() { focused = true; }, blur() { focused = false; }, stop: noop,
			playPause: noop, seek: noop, setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			snapshot: () => ({ clipId: 'clip', focused, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }),
			subscribe: () => noop },
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async () => { await act(async () => { root.render(<ClipSourceEditor controller={controller} project={project}
		clipId="clip" copy={ENGLISH_COPY} blocked={false} run={operation => operation()} />); }); };
	await render();
	const wave = dom.one('.audio-editor-source-wave-area');
	Object.defineProperty(wave, 'getBoundingClientRect', { value: () => ({ left: 0, width: 1_000 * ratio }) });
	const event = { button: 0, pointerId: 1, preventDefault: noop, stopPropagation: noop };
	return {
		target: sourceEditor.target,
		select: async (start: number, end: number) => {
			await act(async () => { reactProps(wave).onPointerDown({ ...event, clientX: start * ratio }); });
			await act(async () => { reactProps(wave).onPointerUp({ ...event, clientX: end * ratio }); });
		},
		replace: async (extra: number) => {
			project = { ...project, sources: [{ id: 'processed', sampleRate, channelCount: 1, frameCount: 1_000 + extra }],
				clips: [{ ...project.clips[0]!, sourceId: 'processed', sourceDurationFrames: 800 + extra, durationFrames: (800 + extra) * ratio }] };
			await render();
		},
		undo: async () => { project = initial; await render(); },
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
