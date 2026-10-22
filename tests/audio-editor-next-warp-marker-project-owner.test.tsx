/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function project(id: string) {
	const source = createAudioSource({ id: 'voice-source', name: 'Voice', frameCount: 12_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'voice', sourceId: source.id, title: 'Voice', sourceDurationFrames: 12_000, durationFrames: 12_000,
		warpMap: { feature: 'audio-warp', points: [0, 1000, 12_000].map(value => ({ outer: { num: value, den: 1 }, source: { num: value, den: 1 }, mode: 'forward' })) } });
	return createSoundscaperProject({ id, title: id, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice-track', name: 'Voice', clipIds: [clip.id] })] });
}

test('NP022: warp marker row drafts cannot rewrite a newly activated native project', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: { ...createMemoryEngine(), getAudioWarpRenderStatus: () => ({ path: 'exact-offline', realtimeAcceleration: false, exactOfflineAvailable: true, fallback: true }) } as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const warpView = (): Readonly<{ warpMap: unknown; renderStatus: Readonly<{ path: 'realtime' | 'exact-offline' }> }> => {
		const value: unknown = controller.actions.audioWarp.view();
		assert.ok(isRecord(value)); const status = value.renderStatus; assert.ok(isRecord(status));
		assert.ok(status.path === 'realtime' || status.path === 'exact-offline');
		return { warpMap: value.warpMap, renderStatus: { path: status.path } };
	};
	const dialogController = { ...controller, actions: { ...controller.actions, audioWarp: { ...controller.actions.audioWarp, view: warpView } } };
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const render = async () => { await act(async () => root.render(<AudioWarpDialog productId="soundscaper" controller={dialogController}
		snapshot={controller.getSnapshot()} copy={ENGLISH_COPY} run={operation => operation()} onClose={() => undefined} />)); };
	const marker = () => dom.one('[aria-label="Marker 1 outer position"]');
	const activate = async (id: string) => {
		await controller.actions.project.open(project(id)); controller.actions.timeline.selectClip('voice'); await render();
	};
	try {
		await activate('outgoing');
		await act(async () => reactProps(marker()).onChange({ currentTarget: { value: '2000' } }));
		await controller.actions.project.rename('Same project draft retained'); await render(); assert.equal(marker().value, '2000');
		await activate('incoming');
		const move = dom.container.querySelectorAll('button').find(button => button.textContent === 'Move marker 1'); assert.ok(move);
		await act(async () => reactProps(move).onClick());
		const map = warpView().warpMap;
		assert.deepEqual(map, project('reference').clips[0]?.warpMap, 'the outgoing marker draft must not move the incoming marker');
		assert.equal(marker().value, '1000/1');
		await act(async () => reactProps(marker()).onChange({ currentTarget: { value: '3000' } }));
		await act(async () => reactProps(move).onClick());
		assert.notDeepEqual(warpView().warpMap, map, 'a fresh row edit still commits');
		controller.actions.edit.undo(); assert.deepEqual(warpView().warpMap, map);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); }
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
