/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { deferred, settle } from './helpers/async-test-control.ts';

async function pendingClipboardFixture(t: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const memory = createMemoryStore();
	const session = createAudioEditorSessionController();
	const entered = deferred<void>();
	const release = deferred<void>();
	let holdWrites = false;
	const store = { ...memory, async beginSourceWrite(id: string) {
		const chunks: Float32Array[] = [];
		return {
			async write(channels: readonly Float32Array[]) {
				chunks.push(channels[0]!);
				if (holdWrites) { entered.resolve(); await release.promise; }
			},
			commit() { memory.audioSources.set(id, chunks); },
			abort() {},
		};
	}, async deleteSource(id: string) { memory.audioSources.delete(id); } };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		sessionController: session, store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	t.after(async () => { release.resolve(); await controller.dispose(); });
	await controller.ready;
	const { clipId } = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(clipId, { id: 'note', pitch: 60, velocity: 100,
		startFrame: 0, durationFrames: 4000, channel: 0 });
	controller.actions.timeline.selectClip(clipId);
	await controller.actions.project.save();
	return { controller, session, clipId, entered, release, holdWrites: () => { holdWrites = true; } };
}

function firstClipboardPitch(fixture: Awaited<ReturnType<typeof pendingClipboardFixture>>) {
	const clipboard = fixture.session.clipboardForProject(fixture.controller.project!.id);
	return clipboard?.descriptor.tracks.flatMap(track => track.clips.flatMap(clip => readMidiClip(clip)?.notes ?? []))[0]?.pitch;
}

for (const action of ['copy', 'execute-copy', 'cut', 'cutLeaveGap', 'cutPerClipRipple', 'cutPerTrackRipple', 'cutAllTracksRipple'] as const) test(`${action} includes the MIDI note edit requested before PCM publication`, async t => {
	const fixture = await pendingClipboardFixture(t);
	const { controller, clipId, entered, release } = fixture;
	assert.equal(controller.actions.edit.copy(), undefined, 'idle Copy retains its synchronous contract');
	assert.equal(firstClipboardPitch(fixture), 60);
	fixture.holdWrites();
	const updating = controller.actions.midi.updateNote(clipId, 'note', { pitch: 67 });
	await entered.promise;
	const copying = action === 'execute-copy' ? controller.actions.edit.execute('copy') : controller.actions.edit[action]();
	await settle();
	release.resolve();
	await Promise.all([updating, copying]);
	assert.equal(firstClipboardPitch(fixture), 67);
});

test('pending Copy refuses a changed selection instead of copying a different target', async t => {
	const fixture = await pendingClipboardFixture(t);
	const { controller, clipId, entered, release } = fixture;
	const other = await controller.actions.midi.addTrack();
	controller.actions.timeline.selectClip(clipId);
	fixture.holdWrites();
	const updating = controller.actions.midi.updateNote(clipId, 'note', { pitch: 67 });
	await entered.promise;
	const copying = controller.actions.edit.execute('copy', { propagateErrors: true });
	controller.actions.timeline.selectClip(other.clipId);
	release.resolve();
	const results = await Promise.allSettled([updating, copying]);
	assert.equal(results[0]!.status, 'fulfilled', 'selection does not cancel the independently requested note edit');
	assert.equal(results[1]!.status, 'rejected');
	assert.equal(firstClipboardPitch(fixture), undefined);
});

for (const edit of ['note-growth', 'clip-trim'] as const) test(`pending Copy keeps the selected clip through its own ${edit}`, async t => {
	const fixture = await pendingClipboardFixture(t);
	const { controller, clipId, entered, release } = fixture;
	fixture.holdWrites();
	const updating = edit === 'note-growth'
		? controller.actions.midi.updateNote(clipId, 'note', { durationFrames: 500_000 })
		: controller.actions.midi.resizeClip(clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 24_000 });
	await entered.promise;
	const copying = controller.actions.edit.execute('copy', { propagateErrors: true });
	release.resolve();
	await Promise.all([updating, copying]);
	const copied = fixture.session.clipboardForProject(controller.project!.id)?.descriptor.tracks[0]?.clips[0];
	assert.equal(copied?.durationFrames, edit === 'note-growth' ? 500_000 : 24_000);
});
