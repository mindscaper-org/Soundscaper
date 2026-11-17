/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readTrackPlaylists } from '../src/common/editor/track-playlists.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../src/common/editor/project-owned-feature-requirements.ts';
import { collectProjectSourceIds, compactProjectSourceMetadata } from '../src/common/editor/retention.js';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';

const create = { type: 'track/playlist-create', trackId: 'voice', id: 'edit', name: 'Tight edit',
	originalId: 'original', originalName: 'Original', mode: 'duplicate' } as const;
const activate = { type: 'track/playlist-activate', trackId: 'voice', id: 'original' } as const;

function fixture() {
	return createSoundscaperProject({ id: 'project',
		sources: [{ id: 'source', kind: 'audio', name: 'Recording', sampleRate: 48000, channelCount: 1, frameCount: 16, storageKey: 'source' }],
		tracks: [{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['spoken'] },
			{ id: 'music', type: 'audio', name: 'Music', clipIds: ['bed'] }],
		clips: [{ id: 'spoken', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 8 },
			{ id: 'bed', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 16 }],
	});
}

test('switching playlists saves ongoing edits and preserves other tracks and the current mix', () => {
	const original = fixture();
	let project = applySoundscaperProjectCommand(original, create);
	project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'spoken', changes: { title: 'Edited voice' } });
	project = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'voice', changes: { gain: 0.25, pan: 0.5 } });
	project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'bed', changes: { title: 'Today’s music' } });
	const otherTrack = structuredClone(project.tracks[1]);
	const music = structuredClone(project.clips.find(clip => clip.id === 'bed'));
	const mixer = structuredClone(project.mixer);
	project = applySoundscaperProjectCommand(project, activate);
	assert.notEqual(project.clips.find(clip => clip.id === 'spoken')!.title, 'Edited voice');
	assert.equal(project.tracks[0]!.gain, 0.25);
	assert.equal(project.tracks[0]!.pan, 0.5);
	assert.deepEqual(project.tracks[1], otherTrack);
	assert.deepEqual(project.clips.find(clip => clip.id === 'bed'), music);
	assert.deepEqual(project.mixer, mixer);
	project = applySoundscaperProjectCommand(project, { ...activate, id: 'edit' });
	assert.equal(project.clips.find(clip => clip.id === 'spoken')!.title, 'Edited voice');
	assert.deepEqual(readTrackPlaylists(original), []);
});

test('empty playlists retain the original material; activation is one undoable edit', () => {
	let history = createSoundscaperProjectHistory(fixture());
	history = executeSoundscaperProjectCommand(history, { ...create, mode: 'empty' });
	assert.deepEqual(history.present.tracks[0]!.clipIds, []);
	assert.equal(history.present.clips.length, 1);
	history = executeSoundscaperProjectCommand(history, activate);
	assert.deepEqual(history.present.tracks[0]!.clipIds, ['spoken']);
	assert.deepEqual(undoSoundscaperProjectCommand(history).present.tracks[0]!.clipIds, []);
	assert.equal(readTrackPlaylists(history.present)[0]!.activeId, 'original');
});

test('stored playlists preserve persisted musical timing without runtime sample caches', () => {
	const original = fixture();
	const musical = structuredClone(original) as unknown as Record<string, unknown>;
	const clip = (musical.clips as Record<string, unknown>[])[0]!;
	Object.assign(clip, { anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'fixedSamples' });
	delete clip.timelineStartFrame;
	musical.featureRequirements = reconcileProjectOwnedFeatureRequirements(musical, original.featureRequirements);
	validateSoundscaperProject(musical);
	const project = applySoundscaperProjectCommand(musical, create);
	const saved = readTrackPlaylists(project)[0]!.playlists[0]!.state!.clips[0]!;
	assert.deepEqual(saved, clip);
	const restored = applySoundscaperProjectCommand(project, activate);
	assert.deepEqual(restored.clips.find(value => value.id === 'spoken'), clip);
});

test('playlist commands compose with clip edits in one batch revision', () => {
	const original = fixture();
	const project = applySoundscaperProjectCommand(original, { type: 'batch', commands: [create,
		{ type: 'clip/update', clipId: 'spoken', changes: { title: 'Batch edit' } }, activate] });
	assert.equal(project.revision, original.revision + 1);
	assert.notEqual(project.clips.find(clip => clip.id === 'spoken')!.title, 'Batch edit');
	assert.equal(readTrackPlaylists(project)[0]!.playlists[1]!.state!.clips[0]!.title, 'Batch edit');
});

test('inactive media stays reachable and cannot be removed until its playlist is deleted', () => {
	let project = applySoundscaperProjectCommand(fixture(), { ...create, mode: 'empty' });
	project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'bed' });
	assert.deepEqual([...collectProjectSourceIds(project)], ['source']);
	assert.equal(compactProjectSourceMetadata(project).sources.length, 1);
	project = applySoundscaperProjectCommand(project, { type: 'source/remove', sourceId: 'source' });
	assert.equal(project.sources.length, 1);
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-remove', trackId: 'voice', id: 'original' });
	assert.equal(collectProjectSourceIds(project).size, 0);
});

test('inactive playlists keep original source frames through destructive media rewrites', () => {
	const initial = structuredClone(fixture());
	(initial.clips[0] as Record<string, unknown>).sourceStartFrame = 4;
	let project = applySoundscaperProjectCommand(initial, { type: 'clip/remove', clipId: 'bed' });
	project = applySoundscaperProjectCommand(project, create);
	project = applySoundscaperProjectCommand(project, { type: 'source/rewrite-media', sourceId: 'source',
		changes: { storageKey: 'trimmed', frameCount: 8 }, clips: [{ clipId: 'spoken', sourceStartFrame: 0 }] });
	project = applySoundscaperProjectCommand(project, activate);
	const restored = project.clips.find(clip => clip.id === 'spoken')!;
	assert.equal(restored.sourceStartFrame, 4);
	assert.notEqual(restored.sourceId, 'source');
	assert.equal(project.sources.find(source => source.id === restored.sourceId)!.storageKey, 'source');
	assert.equal(project.sources.find(source => source.id === restored.sourceId)!.frameCount, 16);
	project = applySoundscaperProjectCommand(project, { ...activate, id: 'edit' });
	assert.equal(project.clips.find(clip => clip.id === 'spoken')!.sourceStartFrame, 0);
	assert.equal(project.sources.find(source => source.id === 'source')!.storageKey, 'trimmed');
});

test('playlists retain take lanes and comps together with their source media', () => {
	let project = fixture();
	const group = { id: 'group', sequenceId: project.primarySequenceId, trackId: 'voice', startSample: 0, endSample: 8,
		laneOrder: ['lane'], lanes: [{ id: 'lane' }],
		takes: [{ id: 'take', laneId: 'lane', sourceId: 'source', startSample: 0, endSample: 8, sourceStartSample: 0 }],
		compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 8 }] };
	project = applySoundscaperProjectCommand(project, { type: 'take-comp/group-add', group });
	project = applySoundscaperProjectCommand(project, { ...create, mode: 'empty' });
	assert.deepEqual(project.takeGroups, []);
	assert.ok(collectProjectSourceIds(project).has('source'));
	project = applySoundscaperProjectCommand(project, activate);
	assert.deepEqual(project.takeGroups, [group]);
});

test('activating an old arrangement leaves clips moved to another track intact', () => {
	let project = applySoundscaperProjectCommand(fixture(), create);
	project = applySoundscaperProjectCommand(project, { type: 'clip/move', clipId: 'spoken', trackId: 'music', timelineStartFrame: 20 });
	const moved = structuredClone(project.clips.find(clip => clip.id === 'spoken'));
	project = applySoundscaperProjectCommand(project, activate);
	assert.deepEqual(project.clips.find(clip => clip.id === 'spoken'), moved);
	const id = (project.tracks[0]!.clipIds as readonly string[])[0]!;
	assert.notEqual(id, 'spoken');
	assert.equal(project.clips.find(clip => clip.id === id)!.timelineStartFrame, 0);
	assert.ok((project.tracks[1]!.clipIds as readonly string[]).includes('spoken'));
});

test('session snapshots retain the active playlist and its independently saved alternatives', () => {
	let project = applySoundscaperProjectCommand(fixture(), create);
	project = applySoundscaperProjectCommand(project, { type: 'clip/update', clipId: 'spoken', changes: { title: 'Snapshot edit' } });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'snapshot', name: 'With playlists', createdAt: '2026-11-16T12:00:00Z' });
	project = applySoundscaperProjectCommand(project, activate);
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-remove', trackId: 'voice', id: 'edit' });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-restore', id: 'snapshot' });
	assert.equal(readTrackPlaylists(project)[0]!.activeId, 'edit');
	assert.equal(project.clips.find(clip => clip.id === 'spoken')!.title, 'Snapshot edit');
	project = applySoundscaperProjectCommand(project, activate);
	assert.notEqual(project.clips.find(clip => clip.id === 'spoken')!.title, 'Snapshot edit');
});

test('playlist names, active deletion, locked tracks, missing media and removed tracks are handled', () => {
	const project = applySoundscaperProjectCommand(fixture(), create);
	assert.throws(() => applySoundscaperProjectCommand(project, { ...create, id: 'new', name: ' ' }), /name/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, create), /already|unique|duplicate/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, { ...activate, id: 'missing' }), /playlist/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, { type: 'track/playlist-remove', trackId: 'voice', id: 'edit' }), /active/iu);
	const locked = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'voice', changes: { locked: true } });
	assert.throws(() => applySoundscaperProjectCommand(locked, activate), /locked/iu);
	const missing = structuredClone(project);
	(missing as unknown as { sources: unknown[]; clips: unknown[] }).sources = [];
	(missing as unknown as { sources: unknown[]; clips: unknown[] }).clips = [];
	assert.throws(() => validateSoundscaperProject(missing));
	const renamed = applySoundscaperProjectCommand(project, { type: 'track/playlist-rename', trackId: 'voice', id: 'original', name: ' Raw ' });
	assert.equal(readTrackPlaylists(renamed)[0]!.playlists[0]!.name, 'Raw');
	const removed = applySoundscaperProjectCommand(renamed, { type: 'track/remove', trackId: 'voice' });
	assert.deepEqual(readTrackPlaylists(removed), []);
});

test('stored playlists reject duplicate clip identities and take groups belonging to another track', () => {
	const project = applySoundscaperProjectCommand(fixture(), create);
	const duplicate = structuredClone(project);
	const duplicateWire = duplicate.metadata.trackPlaylists as ReturnType<typeof readTrackPlaylists>;
	const clips = duplicateWire[0]!.playlists[0]!.state!.clips as Record<string, unknown>[];
	clips.push(structuredClone(clips[0]!));
	assert.throws(() => validateSoundscaperProject(duplicate), /unique/iu);
	const foreign = structuredClone(project);
	const foreignWire = foreign.metadata.trackPlaylists as ReturnType<typeof readTrackPlaylists>;
	const groups = foreignWire[0]!.playlists[0]!.state!.takeGroups as Record<string, unknown>[];
	groups.push({ trackId: 'music' });
	assert.throws(() => validateSoundscaperProject(foreign), /belong/iu);
});

test('Scape round trips retain inactive clips and remap shared media on import collisions', async context => {
	const sender = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await sender.close(); await recipient.close(); });
	for (const store of [sender, recipient]) {
		const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 1 });
		await writer.write([new Float32Array(16).fill(store === sender ? 0.5 : 0)]);
		await writer.commit();
	}
	let project = applySoundscaperProjectCommand(fixture(), { ...create, mode: 'empty' });
	project = applySoundscaperProjectCommand(project, { type: 'clip/remove', clipId: 'bed' });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'snapshot', name: 'With playlists', createdAt: '2026-11-16T12:00:00Z' });
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-remove', trackId: 'voice', id: 'original' });
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, sender);
	assert.ok(archive.blob);
	const imported = await runtime.importScapeProject(archive.blob, recipient);
	const reopened = (await recipient.loadProject(imported.project.id))!;
	const snapshot = applySoundscaperProjectCommand(reopened, { type: 'project/snapshot-restore', id: 'snapshot' });
	const restored = applySoundscaperProjectCommand(snapshot, activate);
	const clip = restored.clips.find(value => value.id === 'spoken')!;
	assert.notEqual(clip.sourceId, 'source');
	assert.equal(clip.sourceId, restored.sources[0]!.id);
	assert.equal(clip.durationFrames, 8);
	const chunks = [];
	for await (const chunk of recipient.readSourceChunks(String(restored.sources[0]!.storageKey))) chunks.push(chunk.channels[0]);
	assert.deepEqual(chunks, [new Float32Array(16).fill(0.5)]);
});
