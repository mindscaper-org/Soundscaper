/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { readSessionSnapshots } from '../src/common/editor/session-snapshots.ts';
import { readSubprojectLinks } from '../src/common/editor/subprojects.ts';
import { readTrackPlaylists } from '../src/common/editor/track-playlists.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { repairSoundscaperProject } from '../src/soundscaper/editor-project-recovery-repair.ts';

const NOW = '2026-11-17T10:00:00.000Z';
const available = new Set(['source']);

function fixture() {
	return createSoundscaperProject({
		id: 'original', now: NOW, metadata: { artist: 'Dana', album: 'Sessions', tags: { catalogue: '0005' } },
		sources: [{ id: 'source', name: 'Dialogue', sampleRate: 48_000, channelCount: 1, frameCount: 16 }],
		clips: [{ id: 'first', sourceId: 'source', durationFrames: 8 }, { id: 'second', sourceId: 'source', durationFrames: 8, timelineStartFrame: 8 }],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['second', 'first'] }],
	});
}

test('unrelated corruption preserves saved session states with their original clip media', () => {
	const original = applySoundscaperProjectCommand(fixture(), { type: 'project/snapshot-create', id: 'mix', name: 'Original mix', createdAt: NOW });
	const damaged = { ...original, snap: null };
	const { project } = repairSoundscaperProject(damaged, available);
	assert.deepEqual(readSessionSnapshots(project), readSessionSnapshots(original));
	assert.equal(project.metadata.artist, 'Dana');
});

test('one damaged snapshot does not remove an otherwise recoverable session state', () => {
	const first = applySoundscaperProjectCommand(fixture(), { type: 'project/snapshot-create', id: 'mix', name: 'Original mix', createdAt: NOW });
	const original = applySoundscaperProjectCommand(first, { type: 'project/snapshot-create', id: 'alt', name: 'Alt mix', createdAt: NOW });
	const [damaged, valid] = readSessionSnapshots(original);
	const result = repairSoundscaperProject({ ...original, metadata: { ...original.metadata,
		sessionSnapshots: [{ ...damaged, sourceIds: ['absent'] }, valid],
	} }, available);
	assert.deepEqual(readSessionSnapshots(result.project), [valid]);
	assert.ok(result.changes.some(({ path }) => path === 'metadata.sessionSnapshots[0]'));
});

test('unrelated corruption preserves an inactive track playlist, including clips absent from the active arrangement', () => {
	const original = applySoundscaperProjectCommand(fixture(), { type: 'track/playlist-create', trackId: 'track',
		originalId: 'original', originalName: 'Original', id: 'empty', name: 'Empty edit', mode: 'empty' });
	const { project } = repairSoundscaperProject({ ...original, snap: null }, available);
	assert.deepEqual(readTrackPlaylists(project), readTrackPlaylists(original));
	const recalled = applySoundscaperProjectCommand(project, { type: 'track/playlist-activate', trackId: 'track', id: 'original' });
	assert.deepEqual(recalled.clips.map(({ id }) => id), ['first', 'second']);
});

test('unrelated corruption preserves nested subproject links whose proxy is readable', () => {
	const projectBeforeLink = fixture();
	const original = applySoundscaperProjectCommand(projectBeforeLink, { type: 'subproject/install', expected: null, source: projectBeforeLink.sources[0]!,
		link: { id: 'subproject', projectId: 'child', libraryId: 'library', title: 'Nested dialogue',
			sourceId: 'source', followLatest: true, revision: 5, contentDigest: 'a'.repeat(64),
			sampleRate: 48_000, channelCount: 1, frameCount: 16 } });
	const links = readSubprojectLinks(original);
	assert.equal(links.length, 1);
	const { project } = repairSoundscaperProject({ ...original, snap: null }, available);
	assert.deepEqual(readSubprojectLinks(project), links);
});

test('a malformed descriptive field does not reset other export metadata', () => {
	const original = fixture();
	const { project } = repairSoundscaperProject({ ...original, metadata: { ...original.metadata, year: 2026 } }, available);
	assert.equal(project.metadata.artist, 'Dana');
	assert.equal(project.metadata.album, 'Sessions');
	assert.deepEqual(project.metadata.tags, { catalogue: '0005' });
	assert.equal(project.metadata.year, '');
});

test('recovery retains healthy inserts when one clip insert is damaged', () => {
	const original = fixture();
	const delay = createEffect('delay');
	const { project, changes } = repairSoundscaperProject({ ...original, clips: original.clips.map(clip => clip.id === 'first'
		? { ...clip, effects: [{ id: 'broken', type: 'delay', params: null }, delay] } : clip) }, available);
	assert.deepEqual(project.clips.find(({ id }) => id === 'first')?.effects, [delay]);
	assert.ok(changes.some(({ path, reasonCode }) => path === 'clips[0].effects[0]' && reasonCode === 'effect-removed'));
});

test('recovery retains a Project Bin item when its rack contains a damaged insert', () => {
	const original = createSoundscaperProject({ ...fixture(), projectBin: { clips: [{ id: 'bin', sourceId: 'source', durationFrames: 8 }] } });
	const delay = createEffect('delay');
	const damaged = { ...original, projectBin: { clips: [{ ...original.projectBin.clips[0],
		effects: [delay, { id: 'broken', type: 'delay', params: null }] }] } };
	const { project } = repairSoundscaperProject(damaged, available);
	assert.deepEqual(project.projectBin.clips[0]?.effects, [delay]);
});

test('rebuilding a clip list retains the saved order of the owning track', () => {
	const original = fixture();
	assert.deepEqual(original.tracks[0]?.clipIds, ['second', 'first']);
	const { project } = repairSoundscaperProject({ ...original, snap: null }, available);
	assert.deepEqual(project.tracks[0]?.clipIds, ['second', 'first']);
});

test('a malformed master gain leaves valid master pan and inserts available', () => {
	const delay = createEffect('delay');
	const original = createSoundscaperProject({ ...fixture(), master: { pan: -0.5, effects: [delay] } });
	const { project } = repairSoundscaperProject({ ...original, master: { ...original.master, gain: -2 } }, available);
	assert.equal(project.master.pan, -0.5);
	assert.deepEqual(project.master.effects, [delay]);
	assert.equal(project.master.gain, 1);
});

test('one malformed sequence does not move tracks out of another healthy secondary sequence', () => {
	const initial = fixture();
	const original = createSoundscaperProject({ ...initial, primarySequenceId: 'main', sequences: [
		{ id: 'main', name: 'Programme', trackIds: [] },
		{ id: 'alternate', name: 'Alternate edit', trackIds: ['track'] },
		{ id: 'broken', name: 'Other edit', trackIds: [] },
	] });
	const damaged = { ...original, sequences: original.sequences.map(sequence => sequence.id === 'broken' ? { ...sequence, rate: null } : sequence) };
	const { project } = repairSoundscaperProject(damaged, available);
	assert.equal(project.primarySequenceId, 'main');
	assert.deepEqual(project.sequences.map(({ id, trackIds }) => [id, trackIds]), [['main', []], ['alternate', ['track']]]);
});

test('recovery retains the authored folder hierarchy when the separate track registry order is damaged', () => {
	const original = createSoundscaperProject({
		id: 'sequence-order', now: NOW,
		tracks: [{ id: 'second', type: 'audio' }, { id: 'first', type: 'audio' }],
		trackFolders: [{ id: 'folder', name: 'Dialogue' }],
		sequences: [{ id: 'main', trackNodes: [
			{ id: 'folder', kind: 'folder', parentFolderId: null },
			{ id: 'second', kind: 'track', parentFolderId: 'folder' },
			{ id: 'first', kind: 'track', parentFolderId: null },
		] }],
		primarySequenceId: 'main',
	});
	assert.deepEqual(original.sequences[0]?.trackIds, ['second', 'first']);
	const { project } = repairSoundscaperProject({ ...original, tracks: [...original.tracks].reverse() }, new Set());
	assert.deepEqual(project.tracks.map(({ id }) => id), ['second', 'first']);
	assert.deepEqual(project.trackFolders, original.trackFolders);
	assert.deepEqual(project.sequences[0]?.trackNodes, original.sequences[0]?.trackNodes);
	assert.deepEqual(project.mixer, original.mixer);
});
