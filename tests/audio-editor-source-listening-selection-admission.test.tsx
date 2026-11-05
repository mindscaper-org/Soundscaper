/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject, SourceSelection } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const blocked of [false, true]) test(`source listening selection remains available with mutationBlocked=${blocked}`, async () => {
	const f = await fixture(blocked, false);
	try {
		await f.select();
		assert.deepEqual(f.selections, [null, { startFrame: 250, endFrame: 500 }]);
		assert.deepEqual(f.seeks, [500]);
		assert.ok(f.highlight());
		assert.deepEqual(f.mutations, []);
	} finally { await f.cleanup(); }
});

test('source busy admission still blocks listening', async () => {
	const f = await fixture(true, true);
	try {
		await f.select();
		assert.deepEqual(f.selections, []);
		assert.deepEqual(f.seeks, []);
		assert.equal(f.highlight(), null);
	} finally { await f.cleanup(); }
});

for (const modifier of ['ctrlKey', 'metaKey'] as const) test(`locked source ${modifier} clicks cannot author stretch markers`, async () => {
	const f = await fixture(true, false);
	try {
		await f.select({ [modifier]: true });
		assert.deepEqual(f.mutations, []);
		assert.deepEqual(f.selections, []);
		assert.equal(f.highlight(), null);
	} finally { await f.cleanup(); }
});

test('an unlocked source keeps its Ctrl-click marker command', async () => {
	const f = await fixture(false, false);
	try {
		await f.select({ ctrlKey: true });
		assert.deepEqual(f.mutations, [['marker', 'clip', 250]]);
		assert.deepEqual(f.selections, [null]);
	} finally { await f.cleanup(); }
});

for (const action of ['trim', 'fade'] as const) test(`locked source ${action} gestures still cannot change media`, async () => {
	const f = await fixture(true, false);
	try {
		await f.mutationGesture(action);
		assert.deepEqual(f.mutations, []);
		assert.deepEqual(f.selections, []);
		assert.equal(f.highlight(), null);
	} finally { await f.cleanup(); }
});

async function fixture(blocked: boolean, previewBlocked: boolean) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const project: ClipSourceProject = {
		id: 'project', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 1_000 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 1_000, durationFrames: 1_000 }],
	};
	const selections: (SourceSelection | null)[] = [], seeks: number[] = [], mutations: unknown[][] = [];
	const noop = () => undefined;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: (...args) => { mutations.push(['update', ...args]); } },
		audioWarp: { addSourceMarker: (...args) => { mutations.push(['marker', ...args]); }, moveSourceMarker: noop, deleteSourceMarker: noop },
		timeline: {}, effects: { setSourceSelection: noop },
		clipSourcePreview: {
			focus: noop, blur: noop, playPause: noop, stop: noop, seek: frame => { seeks.push(frame); },
			setLoop: noop, setLoopRange: noop, setSelection: range => { selections.push(range); },
			snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }),
			subscribe: () => noop, trim: (...args) => { mutations.push(['trim', ...args]); },
		},
	} };
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip"
		copy={ENGLISH_COPY} blocked={blocked} previewBlocked={previewBlocked} run={operation => operation()} />));
	const wave = dom.one('.audio-editor-source-wave-area');
	Object.defineProperty(wave, 'getBoundingClientRect', { value: () => ({ left: 0, width: 1_000 }) });
	const event = (target: ReactTestElement, x: number, extra: Readonly<Record<string, boolean>> = {}) => ({
		button: 0, buttons: 1, pointerId: 1, clientX: x, clientY: 60, target, currentTarget: target,
		preventDefault: noop, stopPropagation: noop, ...extra,
	});
	return {
		selections, seeks, mutations, highlight: () => dom.find('.audio-editor-source-selection'),
		select: async (modifiers: Readonly<Record<string, boolean>> = {}) => {
			await act(async () => { reactProps(wave).onPointerDown(event(wave, 250, modifiers)); });
			await act(async () => { reactProps(wave).onPointerMove(event(wave, 500, modifiers)); });
			await act(async () => { reactProps(wave).onPointerUp(event(wave, 500, modifiers)); });
		},
		mutationGesture: async (action: 'trim' | 'fade') => {
			const target = dom.one(action === 'trim' ? '.audio-editor-source-trim--start' : '[data-clip-fade-handle="in"]');
			await act(async () => { reactProps(action === 'trim' ? target : wave).onPointerDown(event(target, 0)); });
			await act(async () => { reactProps(wave).onPointerUp(event(target, 200)); });
		},
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
