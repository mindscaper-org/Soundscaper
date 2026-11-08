/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const cancel of [false, true]) test(cancel
	? 'closing export while it waits for MIDI cancels the pending submission'
	: 'audio export includes the MIDI note edit requested before PCM publication', async t => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const memory = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'midi-pending-audio-export' });
	const session = createAudioEditorSessionController();
	const entered = deferred<void>();
	const release = deferred<void>();
	let holdWrites = false;
	const snapshots: unknown[] = [];
	const store = new Proxy(memory, { get(target, key) {
		if (key === 'beginSourceWrite') return async (...args: Parameters<typeof memory.beginSourceWrite>) => {
			const writer = await target.beginSourceWrite(...args);
			return { ...writer, async write(channels: readonly Float32Array[]) {
				if (holdWrites) { entered.resolve(); await release.promise; }
				return writer.write([...channels]);
			} };
		};
		const value = Reflect.get(target, key, target);
		return typeof value === 'function' ? value.bind(target) : value;
	} });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		sessionController: session, engineFactory: ((options: Record<string, unknown>) => {
			const engine = createMemoryRenderEngine(options);
			return { ...engine, loadProject(project: unknown) { snapshots.push(project); engine.loadProject(project); } };
		}) as unknown as Options['engineFactory'], store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	t.after(async () => { release.resolve(); await controller.dispose(); });
	await controller.ready;
	const { clipId } = await controller.actions.midi.addTrack();
	await controller.actions.midi.addNote(clipId, { id: 'note', pitch: 60, velocity: 100,
		startFrame: 0, durationFrames: 4000, channel: 0 });
	controller.actions.timeline.selectClip(clipId);
	await controller.actions.project.save();
	holdWrites = true;
	const updating = controller.actions.midi.updateNote(clipId, 'note', { pitch: 67 });
	await entered.promise;
	const exporting = controller.actions.export.start({ format: 'wav', bitDepth: 16, includeTail: false });
	// Let export admit its snapshot while the requested PCM write is still held.
	await settle();
	if (cancel) await controller.actions.export.cancel();
	release.resolve();
	await Promise.all([updating, exporting]);
	if (cancel) { assert.equal(snapshots.length, 0, 'a dismissed export cannot start rendering later'); return; }
	const published = snapshots.filter((project): project is { clips: unknown[] } => Boolean(project
		&& typeof project === 'object' && 'clips' in project)).flatMap(project => (
		project.clips.flatMap(clip => readMidiClip(clip)?.notes ?? [])
	));
	assert.ok(published.length > 0, 'the export renderer receives a MIDI clip');
	assert.equal(published[0]?.pitch, 67);
});
