/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { useTakeCycleRecoverySurface } from '../src/common/editor/ui/use-take-cycle-recovery-surface.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('an explicit same-surface opening advances one atomic request while guarded no-ops retain it', async context => {
	const f = environment(context);
	let current: { surface: string | null; requestId: number; setSurface: Dispatch<SetStateAction<string | null>> } | undefined;
	function Surface() {
		const [surface, setSurface, requestId] = useTakeCycleRecoverySurface('soundscaper', null);
		current = { surface, setSurface, requestId };
		return <output>{surface}</output>;
	}
	const state = () => { assert.ok(current); return current; };
	await act(async () => f.root.render(<React.StrictMode><Surface /></React.StrictMode>));
	const setter = state().setSurface;
	await act(async () => setter('offline-analysis-repeat'));
	const first = state().requestId;
	assert.equal(first, 1, 'Strict Mode replay must not count one command twice');
	await act(async () => setter('offline-analysis-repeat'));
	assert.equal(state().requestId, first + 1);
	assert.equal(state().surface, 'offline-analysis-repeat');
	assert.equal(state().setSurface, setter);
	await act(async () => setter(value => value));
	assert.equal(state().requestId, first + 1);
	await act(async () => setter(null));
	assert.equal(state().surface, null);
	assert.equal(state().requestId, first + 1, 'closing is not a new analysis request');
	await act(async () => setter('offline-analysis-repeat'));
	assert.equal(state().requestId, first + 2);
});

test('recovery still auto-offers each token once and leaves guarded menu reopens alone', async context => {
	const f = environment(context);
	let pending = { recoveryToken: 'first' };
	let current: ReturnType<typeof useTakeCycleRecoverySurface> | undefined;
	function Surface() { current = useTakeCycleRecoverySurface('soundscaper', pending); return null; }
	const state = () => { assert.ok(current); return current; };
	const render = async () => { await act(async () => f.root.render(<Surface />)); };
	await render();
	assert.equal(state()[0], 'take-cycle-recovery');
	const first = state()[2];
	await act(async () => state()[1]('privacy-policy'));
	pending = { recoveryToken: 'first' }; await render();
	assert.equal(state()[0], 'privacy-policy', 'the same recovery cannot preempt a later user choice');
	assert.equal(state()[2], first + 1);
	pending = { recoveryToken: 'second' }; await render();
	assert.equal(state()[0], 'take-cycle-recovery');
	assert.equal(state()[2], first + 2);
});

test('a new invocation repeats the current range without remounting the nonmodal Contrast window', async context => {
	const f = await mount(context);
	assert.equal(f.calls.length, 1);
	const window = f.dialog();
	const close = f.close(); close.focus();
	await f.selection(24_000, 32_000);
	assert.equal(f.calls.length, 1, 'ordinary selection changes do not measure automatically');
	await f.invoke();
	assert.equal(f.calls.length, 2);
	assert.deepEqual(f.calls[1], { startFrame: 24_000, endFrame: 32_000 });
	assert.match(f.report(), /-32\.0 dBFS/u);
	assert.equal(f.dialog(), window, 'the current modeless window retains its position owner');
	assert.equal(f.dom.container.ownerDocument.activeElement, close, 'an invocation does not steal focus');
});

test('a retired repeat cannot replace a newer invocation result', async context => {
	const f = await mount(context, { pending: true });
	await f.selection(24_000, 32_000);
	await f.invoke();
	await f.release(1, -32);
	assert.match(f.report(), /-32\.0 dBFS/u);
	await f.release(0, -60);
	assert.match(f.report(), /-32\.0 dBFS/u);
});

test('a retired repeat failure cannot clear the newer result or add an alert', async context => {
	const f = await mount(context, { pending: true });
	await f.selection(24_000, 32_000); await f.invoke();
	await f.release(1, -32); await f.reject(0);
	assert.match(f.report(), /-32\.0 dBFS/u);
	assert.equal(f.dom.find('[role="alert"]'), null);
});

test('a pending repeat cannot publish into a different project', async context => {
	const f = await mount(context, { pending: true });
	await f.project('replacement');
	assert.equal(f.calls.length, 2);
	await f.release(1, -32); await f.release(0, -60);
	assert.match(f.report(), /-32\.0 dBFS/u);
});

test('ordinary Contrast opening retains its saved report without starting an automatic capture', async context => {
	const f = await mount(context, { mode: 'contrast' });
	assert.equal(f.calls.length, 0);
	assert.match(f.report(), /-18\.0 dBFS/u);
	await f.selection(24_000, 32_000);
	assert.equal(f.calls.length, 0);
	assert.match(f.report(), /-18\.0 dBFS/u);
});

function environment(context: TestContext) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	});
	return { dom, root };
}

function report(rmsDb: number, range = { startFrame: 0, endFrame: 8_000 }) {
	return { type: 'contrast' as const, foreground: { ...range, rmsDb }, background: null,
		differenceDb: null, passes: null, minimumDifferenceDb: 20 };
}

async function mount(context: TestContext, options: { pending?: boolean; mode?: 'contrast' | 'repeat' } = {}) {
	const f = environment(context);
	const source = createAudioSource({ id: 'source', sampleRate: 8_000, frameCount: 40_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 40_000, sourceDurationFrames: 40_000 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id], locked: false }, 8_000);
	let project = createSoundscaperProject({ id: 'analysis-project', sampleRate: 8_000,
		sources: [source], clips: [clip], tracks: [track], selection: { startFrame: 0, endFrame: 8_000, trackIds: [track.id], clipIds: [] } });
	let requestId = 1;
	const calls: { startFrame: number; endFrame: number }[] = [];
	const pending: { resolve: (value: ReturnType<typeof report>) => void; reject: (error: Error) => void }[] = [];
	const controller = { actions: { analysis: { repeatLast: async () => {
		const range = { startFrame: project.selection.startFrame, endFrame: project.selection.endFrame };
		calls.push(range);
		if (options.pending) return new Promise<ReturnType<typeof report>>((resolve, reject) => { pending.push({ resolve, reject }); });
		return report(range.startFrame === 0 ? -18 : -32, range);
	} } } };
	const render = async () => { await act(async () => f.root.render(<AnalysisDialog
		mode={options.mode ?? 'repeat'} requestId={requestId} controller={controller}
		snapshot={{ project, ready: true, analysisProcessing: false, missingSourceIds: [], analysisReport: report(-18),
			lastAnalysisRequest: { type: 'contrast', role: 'foreground', scope: 'master', options: {} } }}
		copy={ENGLISH_COPY} fileService={{ saveFile() {} }} onClose={() => undefined} />)); };
	await render();
	return { ...f, calls,
		dialog: () => f.dom.one('[data-analysis-mode]'),
		close: () => { const button = f.dom.container.querySelectorAll('button').find(element => element.getAttribute('aria-label') === ENGLISH_COPY.close); assert.ok(button); return button; },
		report: () => f.dom.one('[data-analysis-report="contrast"]').textContent,
		selection: async (startFrame: number, endFrame: number) => { project = { ...project, selection: { ...project.selection, startFrame, endFrame } }; await render(); },
		invoke: async () => { requestId++; await render(); },
		project: async (id: string) => { project = { ...project, id }; await render(); },
		release: async (index: number, rmsDb: number) => { const entry = pending[index]; assert.ok(entry); await act(async () => entry.resolve(report(rmsDb, calls[index]))); },
		reject: async (index: number) => { const entry = pending[index]; assert.ok(entry); await act(async () => entry.reject(new Error('Retired failure'))); },
	};
}
