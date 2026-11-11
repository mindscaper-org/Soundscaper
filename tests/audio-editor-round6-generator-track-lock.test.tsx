/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';

for (const [locked, selected, focused, expectedBlocked] of [
	['one', ['one'], 'one', true], ['two', ['one', 'two'], 'one', true],
	['two', ['one'], 'one', false], [null, ['one', 'two'], 'one', false],
	['one', [], 'one', false],
] as const) {
	test(`the generator resolves the selected lock target ${JSON.stringify({ locked, selected, focused })}`, async () => {
		const dom = installReactTestDom();
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let calls = 0;
		let closes = 0;
		const project = createSoundscaperProject({ id: 'generator-target', sampleRate: 48_000,
			now: '2026-10-09T12:00:00.000Z', tracks: ['one', 'two'].map(id =>
				createAudioTrack({ id, locked: id === locked, clipIds: id === 'one' ? ['one-clip'] : [] })),
			sources: [createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })],
			clips: [createAudioClip({ id: 'one-clip', sourceId: 'source', timelineStartFrame: 0,
				durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 })],
			selection: { startFrame: 0, endFrame: selected.length ? 48_000 : 0, trackIds: [...selected], clipIds: [] },
		});
		const controller = { project, actions: { generators: { generate: () => { calls++; } } } };
		const button = (name: string) => {
			const found = dom.container.querySelectorAll('button').find(item => item.textContent === name);
			assert.ok(found);
			return found;
		};
		try {
			await act(async () => { root.render(<GeneratorDialog type="silence" controller={controller}
				snapshot={{ selectedTrackId: focused }} copy={ENGLISH_COPY} locale="en"
				run={(operation: () => unknown) => operation()} onClose={() => { closes++; }} />); });
			assert.equal(button('Generate').hasAttribute('disabled'), expectedBlocked);
			assert.equal(button('Cancel').hasAttribute('disabled'), false);
			await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault: () => undefined }); });
			assert.equal(calls, expectedBlocked ? 0 : 1);
			assert.equal(closes, expectedBlocked ? 0 : 1);
			if (expectedBlocked) {
				await act(async () => { reactProps(button('Generate')).onClick(); });
				assert.equal(calls, 0, 'the shared footer releases the same locked target as form submission');
				await act(async () => { reactProps(button('Cancel')).onClick(); });
				assert.equal(closes, 1);
			}
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}

test('selected locks and an unselected locked focus govern real Silence publication, history and original PCM custody', async context => {
	const f = await selectionControllerCustody(context, selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330));
	const { controller, fixture, store } = f;
	const imported = clipboardProject(controller.project), clip = imported.clips[0]; assert.ok(clip?.kind === 'audio');
	const track = imported.tracks.find(value => Array.isArray(value.clipIds) && value.clipIds.includes(clip.id)); assert.ok(track);
	const button = (name: string) => { const node = fixture.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node; };
	let closed = 0;
	const open = async () => fixture.render(<GeneratorDialog type="silence" controller={controller} snapshot={controller.getSnapshot()}
		copy={ENGLISH_COPY} locale="en" run={fixture.run} onClose={() => { closed += 1; }} />);
	const complete = async () => {
		await act(async () => { reactProps(button('Generate')).onClick(); await Promise.resolve(); await fixture.settle(); });
		await fixture.render(null);
	};
	const silence = async (before: ReturnType<typeof clipboardProject>, frames: number) => {
		const after = clipboardProject(controller.project), source = after.sources.find(value => !before.sources.some(prior => prior.id === value.id));
		assert.ok(source?.kind === 'audio'); assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, frames, 2]);
		const channels = await readCustodyPcm(store, source); assert.equal(channels.length, 2);
		for (const channel of channels) { assert.equal(channel.length, frames); for (const sample of channel) assert.equal(sample, 0); }
		const generated = after.clips.find(value => value.kind === 'audio' && value.sourceId === source.id); assert.ok(generated);
		assert.deepEqual([generated.timelineStartFrame, generated.durationFrames, generated.sourceStartFrame, generated.sourceDurationFrames], [0, frames, 0, frames]);
		return after;
	};
	try {
		await controller.actions.timeline.selectClip(clip.id);
		const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
		await open(); assert.equal(button('Generate').hasAttribute('disabled'), false);
		await complete(); assert.equal(closed, 1);
		const selected = await silence(before, 38_400); assert.equal(selected.clips.length, 1); assert.equal(selected.tracks.length, before.tracks.length);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await controller.actions.track.update(track.id, { locked: true });
		const locked = clipboardProject(controller.project), lockedHistory = structuredClone(controller.getSnapshot().history);
		await open(); assert.equal(button('Generate').hasAttribute('disabled'), true, 'the selected locked source must refuse replacement');
		await act(async () => { reactProps(button('Generate')).onClick(); await Promise.resolve(); await fixture.settle(); });
		assert.deepEqual(controller.project, locked); assert.deepEqual(controller.getSnapshot().history, lockedHistory); assert.equal(closed, 1);
		await act(async () => { reactProps(button('Cancel')).onClick(); }); await fixture.render(null);
		await controller.actions.timeline.clearSelection();
		const unselected = clipboardProject(controller.project), unselectedEntries = controller.getSnapshot().history.undoEntries.length;
		await open(); assert.equal(button('Generate').hasAttribute('disabled'), false);
		await complete(); assert.equal(closed, 3);
		const appended = await silence(unselected, 1_440_000);
		assert.equal(appended.clips.length, unselected.clips.length + 1); assert.equal(appended.tracks.length, unselected.tracks.length + 1);
		assert.deepEqual(appended.tracks.find(value => value.id === track.id), unselected.tracks.find(value => value.id === track.id));
		assert.equal(controller.getSnapshot().history.undoEntries.length, unselectedEntries + 1);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(unselected));
		await controller.actions.track.update(track.id, { locked: false }); await controller.actions.timeline.selectClip(clip.id);
		await open(); assert.equal(button('Generate').hasAttribute('disabled'), false);
		const restored = clipboardProject(controller.project), restoredHistory = structuredClone(controller.getSnapshot().history);
		await act(async () => { reactProps(button('Cancel')).onClick(); }); await fixture.render(null);
		assert.equal(closed, 4); assert.deepEqual(controller.project, restored); assert.deepEqual(controller.getSnapshot().history, restoredHistory);
		assert.equal(restored.sources.length, 1); await f.archive();
	} finally { await f.dispose(); }
});
