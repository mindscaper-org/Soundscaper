/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';

for (const alternative of ['snapshot', 'playlist'] as const) test(`Undo retains a linked original held only by a deleted ${alternative}`, async context => {
	const source = createAudioSource({ id: 'linked', storageKey: 'linked', mimeType: 'audio/wav',
		frameCount: 4096, channelCount: 1, sampleRate: 48000, originalSampleRate: 48000, chunkFrames: 65536 });
	const bytes = encodeWav([new Float32Array(4096).fill(.25)], { sampleRate: 48000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array);
	const blob = new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
	const released: unknown[] = [];
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false, storageManager: null,
		linkedOriginalPort: {
			load: () => ({ blob, locatorRevision: 'original_revision_00001' }),
			release(reference: unknown) { released.push(reference); return true; },
		} });
	context.after(async () => { await store.close(); });
	await store.ready();
	await store.clear();
	released.length = 0;
	let project = createSoundscaperProject({ id: 'project', sources: [source],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: source.id, durationFrames: 4096, sourceDurationFrames: 4096 }] });
	if (alternative === 'snapshot') {
		project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'saved', name: 'Original', createdAt: '2026-11-16T12:00:00Z' });
		project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'clip' });
	} else project = applySoundscaperProjectCommand(project, { type: 'track/playlist-create', trackId: 'voice', id: 'empty', name: 'Empty',
		originalId: 'saved', originalName: 'Original', mode: 'empty' });
	await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: blob });
	await store.saveProject(project);
	// Reopening clears earlier ordinary clip history: only the named alternative owns this original.
	let history = createSoundscaperProjectHistory(project);
	const session = createAudioEditorSessionController({ projects: [project] });
	history = executeSoundscaperProjectCommand(history, alternative === 'snapshot'
		? { type: 'project/snapshot-remove', id: 'saved' }
		: { type: 'track/playlist-remove', trackId: 'voice', id: 'saved' });
	// Use the production revision limit: ordinary edits must not reclaim an original still reachable by Undo.
	for (let edit = 0; edit < 21; edit++) {
		history = executeSoundscaperProjectCommand(history, { type: 'project/rename', title: `Edit ${String(edit)}` });
		session.updateProjectHistory(project.id, history, { returnHistory: false });
		await store.saveProject(history.present, { protectedLinkedOriginalSourceReferences: session.getHistoryLinkedOriginalSourceReferences() });
	}
	const withoutAlternative = history.present;
	for (let edit = 0; edit < 22; edit++) history = undoSoundscaperProjectCommand(history);
	const restored = applySoundscaperProjectCommand(history.present, alternative === 'snapshot'
		? { type: 'project/snapshot-restore', id: 'saved' }
		: { type: 'track/playlist-activate', trackId: 'voice', id: 'saved' });
	assert.equal(restored.clips[0]!.sourceId, source.id);
	const original = await store.resolveLinkedAudioOriginal(project.id, restored.sources.find(item => item.id === source.id)!);
	assert.ok(original, 'Undo and recall must still read the linked recording after saved revision pruning');
	assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()), bytes);
	assert.deepEqual(released, [], 'an original retained by Undo cannot be released');
	session.updateProjectHistory(project.id, createSoundscaperProjectHistory(withoutAlternative), { returnHistory: false });
	await store.saveProject(withoutAlternative, { protectedLinkedOriginalSourceReferences: session.getHistoryLinkedOriginalSourceReferences() });
	assert.equal(await store.getLinkedOriginalBinding(project.id, source.id), null,
		'once history no longer owns the alternative, its original can be reclaimed');
	assert.equal(released.length, 1);
});
