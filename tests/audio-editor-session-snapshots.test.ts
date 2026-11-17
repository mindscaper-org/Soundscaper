/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionSnapshots, snapshotProjectState } from '../src/common/editor/session-snapshots.ts';
import { collectProjectSourceIds, compactProjectSourceMetadata } from '../src/common/editor/retention.js';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProjectStore, createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';

const NOW = '2026-11-16T12:00:00.000Z';
const create = { type: 'project/snapshot-create', id: 'snapshot-1', name: 'Before edits', createdAt: NOW } as const;

function fixture() {
	return createSoundscaperProject({ id: 'project', now: NOW,
		sources: [{ id: 'source', kind: 'audio', name: 'Recording', sampleRate: 48000, channelCount: 1, frameCount: 4, storageKey: 'source' }],
		tracks: [{ id: 'track', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 4 }],
	});
}

test('snapshots save detached named editing states sharing the source inventory', () => {
	const original = fixture();
	const saved = applySoundscaperProjectCommand(original, create, { now: NOW });
	assert.equal(readSessionSnapshots(original).length, 0);
	const snapshot = readSessionSnapshots(saved)[0]!;
	assert.equal(snapshot.name, 'Before edits');
	assert.deepEqual(snapshot.sourceIds, ['source']);
	assert.equal(Object.hasOwn(snapshot.state, 'sources'), false);
	assert.equal(Object.hasOwn(snapshot.state.metadata as object, 'sessionSnapshots'), false);
	assert.equal(saved.sources.length, 1);
	const changed = applySoundscaperProjectCommand(saved, { type: 'track/update', trackId: 'track', changes: { gain: 0.25 } });
	assert.equal(snapshotProjectState(changed, snapshot).tracks[0]!.gain, 1);
	assert.equal(changed.tracks[0]!.gain, 0.25);
});

test('snapshot-only media survives compaction, bounded revision pruning and source cleanup', async context => {
	const store = createSoundscaperProjectStore({ indexedDB: null, revisionLimit: 2 });
	context.after(async () => { await store.close(); });
	await writeSource(store, new Float32Array([0.25, -0.5, 0.75, 0]));
	let project = applySoundscaperProjectCommand(fixture(), create);
	project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'clip' });
	assert.deepEqual([...collectProjectSourceIds(project)], ['source']);
	assert.equal(compactProjectSourceMetadata(project).sources.length, 1);
	for (let index = 0; index < 4; index++) {
		project = applySoundscaperProjectCommand(project, { type: 'project/rename', title: `Edit ${String(index)}` });
		await store.saveProject(project);
	}
	await store.pruneUnreferencedSources({ minimumAgeMs: 0 });
	assert.ok(await store.getSourceMetadata('source'));
	const restored = applySoundscaperProjectCommand((await store.loadProject(project.id))!, { type: 'project/snapshot-restore', id: create.id });
	assert.equal(restored.clips[0]!.sourceId, 'source');
	assert.equal(restored.title, 'Edit 3');
	assert.equal(restored.revision, project.revision + 1);
});

test('restoring is undoable and keeps all named alternatives', () => {
	let history = createSoundscaperProjectHistory(fixture());
	history = executeSoundscaperProjectCommand(history, create);
	history = executeSoundscaperProjectCommand(history, { type: 'track/update', trackId: 'track', changes: { gain: 0.25 } });
	history = executeSoundscaperProjectCommand(history, { ...create, id: 'snapshot-2', name: 'Quiet' });
	history = executeSoundscaperProjectCommand(history, { type: 'project/snapshot-restore', id: create.id });
	assert.equal(history.present.tracks[0]!.gain, 1);
	assert.equal(readSessionSnapshots(history.present).length, 2);
	assert.equal(undoSoundscaperProjectCommand(history).present.tracks[0]!.gain, 0.25);
});

test('rewritten source generations retain original snapshot audio and can be restored repeatedly', () => {
	const original = structuredClone(fixture());
	(original.sources[0] as Record<string, unknown>).frameCount = 8;
	(original.clips[0] as Record<string, unknown>).sourceStartFrame = 2;
	let project = applySoundscaperProjectCommand(original, create);
	const before = project.sources[0]!;
	project = applySoundscaperProjectCommand(project, { type: 'source/rewrite-media', sourceId: 'source',
		changes: { storageKey: 'trimmed', frameCount: 4 },
		clips: [{ clipId: 'clip', sourceStartFrame: 0 }],
	});
	assert.equal(project.sources.find(source => source.id === 'source')!.storageKey, 'trimmed');
	assert.equal(snapshotProjectState(project, readSessionSnapshots(project)[0]!).sources[0]!.storageKey, before.storageKey);
	project = applySoundscaperProjectCommand(project, { ...create, id: 'trimmed-state', name: 'Trimmed' });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-restore', id: create.id });
	assert.equal(project.sources.find(source => source.id === project.clips[0]!.sourceId)!.storageKey, 'source');
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-restore', id: 'trimmed-state' });
	assert.equal(project.sources.find(source => source.id === project.clips[0]!.sourceId)!.storageKey, 'trimmed');
});

test('snapshot names, identity, nesting and missing media are validated', () => {
	const project = applySoundscaperProjectCommand(fixture(), create);
	assert.throws(() => applySoundscaperProjectCommand(project, create), /already|unique|duplicate/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, { ...create, id: 'new', name: '  ' }), /name/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, { type: 'project/snapshot-restore', id: 'missing' }), /snapshot/iu);
	const missing = structuredClone(project) as unknown as Record<string, unknown>;
	missing.sources = [];
	assert.throws(() => validateSoundscaperProject(missing));
	const nested = structuredClone(project);
	(readSessionSnapshots(nested)[0]!.state.metadata as Record<string, unknown>).sessionSnapshots = [];
	assert.throws(() => validateSoundscaperProject(nested), /nested|snapshot/iu);
	const renamed = applySoundscaperProjectCommand(project, { type: 'project/snapshot-rename', id: create.id, name: ' Original ' });
	assert.equal(readSessionSnapshots(renamed)[0]!.name, 'Original');
	const removed = applySoundscaperProjectCommand(renamed, { type: 'project/snapshot-remove', id: create.id });
	assert.deepEqual(readSessionSnapshots(removed), []);
});

test('Scape save/reopen retains snapshots and remaps their shared audio once on collisions', async context => {
	const sender = createSoundscaperEphemeralProjectStore();
	const recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await sender.close(); await recipient.close(); });
	const pcm = new Float32Array([0.25, -0.5, 0.75, 0]);
	await writeSource(sender, pcm);
	await writeSource(recipient, new Float32Array(4));
	let project = applySoundscaperProjectCommand(fixture(), create);
	project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'clip' });
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, sender);
	assert.ok(archive.blob);
	const imported = await runtime.importScapeProject(archive.blob, recipient);
	const reopened = (await recipient.loadProject(imported.project.id))!;
	assert.equal(readSessionSnapshots(reopened).length, 1);
	const restored = applySoundscaperProjectCommand(reopened, { type: 'project/snapshot-restore', id: create.id });
	assert.equal(restored.sources.length, 1);
	assert.notEqual(restored.clips[0]!.sourceId, 'source');
	assert.equal(restored.clips[0]!.sourceId, restored.sources[0]!.id);
	const chunks = [];
	for await (const chunk of recipient.readSourceChunks(String(restored.sources[0]!.storageKey))) chunks.push(chunk.channels[0]);
	assert.deepEqual(chunks, [pcm]);
});

async function writeSource(store: ReturnType<typeof createSoundscaperProjectStore>, pcm: Float32Array) {
	const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 1 });
	await writer.write([pcm]);
	await writer.commit();
}
