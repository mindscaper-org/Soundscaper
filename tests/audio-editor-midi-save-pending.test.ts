/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const action of ['save', 'flush', 'prepareClose', 'list'] as const) test(`Project ${action} includes a requested MIDI note edit while PCM publication is pending`, async t => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const memory = createMemoryStore();
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
		store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	t.after(async () => { release.resolve(); await controller.dispose(); });
	await controller.ready;
	const { clipId } = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(clipId, { id: 'note', pitch: 60, velocity: 100,
		startFrame: 0, durationFrames: 4000, channel: 0 });
	await controller.actions.project.save();
	holdWrites = true;
	const updating = controller.actions.midi.updateNote(clipId, 'note', { pitch: 67 });
	await entered.promise;
	const saving = controller.actions.project[action]();
	// The in-memory save path is warm: drain its immediately resolved work while
	// the explicitly owned PCM write remains blocked, then finish that write.
	await settle();
	release.resolve();
	await Promise.all([updating, saving]);
	const saved = await store.loadProject(controller.project!.id);
	const clip = saved.clips.find((value: { id: string }) => value.id === clipId);
	assert.equal(readMidiClip(clip)?.notes[0]?.pitch, 67);
	if (action === 'list') assert.equal(controller.getSnapshot().projects.find(project => project.id === saved.id)?.revision, saved.revision);
});
