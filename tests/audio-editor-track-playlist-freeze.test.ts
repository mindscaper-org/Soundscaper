/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { readTrackPlaylists } from '../src/common/editor/track-playlists.ts';

test('freezing the active playlist permits an empty inactive alternative and preserves it after unfreeze', () => {
	const sha = 'ab'.repeat(32);
	let project = createSoundscaperProject({ sources: [{ id: 'source', frameCount: 512, sampleRate: 48000, channelCount: 1, contentSha256: sha }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 512, sourceDurationFrames: 512 }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }] });
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-create', trackId: 'voice', id: 'empty', name: 'Empty',
		originalId: 'original', originalName: 'Original', mode: 'empty' });
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-activate', trackId: 'voice', id: 'original' });
	const installed = freezeProject(project);
	project = installed.project;
	const { freeze } = installed;
	assert.ok(validateSoundscaperProject(project));
	assert.deepEqual(project.tracks[0]!.audioFreeze, freeze);
	assert.deepEqual(readTrackPlaylists(project)[0]!.playlists.find(playlist => playlist.id === 'empty')!.state!.clips, []);
	project = applySoundscaperProjectCommand(project, { type: 'audio-freeze/remove', trackId: 'voice', expectedFreeze: freeze });
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-activate', trackId: 'voice', id: 'empty' });
	assert.equal(project.clips.length, 0);
});


test('unfreeze retains the rendered source required by a named frozen snapshot', () => {
	const { project: frozen, freeze } = freezeProject(baseProject());
	const saved = applySoundscaperProjectCommand(frozen, { type: 'project/snapshot-create', id: 'saved', name: 'Frozen', createdAt: '2026-11-17T12:00:00Z' });
	const unfrozen = applySoundscaperProjectCommand(saved, { type: 'audio-freeze/remove', trackId: 'voice', expectedFreeze: freeze });
	assert.ok(unfrozen.sources.some(source => source.id === 'frozen'));
	const restored = applySoundscaperProjectCommand(unfrozen, { type: 'project/snapshot-restore', id: 'saved' });
	assert.deepEqual(restored.tracks[0]!.audioFreeze, freeze);
});

test('committing a frozen playlist retains editable source media owned by its alternative', () => {
	const original = applySoundscaperProjectCommand(baseProject(), { type: 'track/playlist-create', trackId: 'voice', id: 'edit', name: 'Edit',
		originalId: 'original', originalName: 'Original', mode: 'duplicate' });
	const { project, freeze, digests } = freezeProject(original);
	const committed = applySoundscaperProjectCommand(project, { type: 'audio-freeze/commit', trackId: 'voice', expectedFreeze: freeze,
		operationDigests: digests, derivedSourceContentSha256: 'ab'.repeat(32),
		derivedClip: createAudioClip({ id: 'committed', sourceId: 'frozen', durationFrames: 512, sourceDurationFrames: 512 }) });
	assert.ok(committed.sources.some(source => source.id === 'source'));
	const restored = applySoundscaperProjectCommand(committed, { type: 'track/playlist-activate', trackId: 'voice', id: 'original' });
	assert.equal(restored.clips[0]!.sourceId, 'source');
});

function baseProject() {
	return createSoundscaperProject({ sources: [{ id: 'source', frameCount: 512, sampleRate: 48000, channelCount: 1, contentSha256: 'ab'.repeat(32) }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 512, sourceDurationFrames: 512 }], tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }] });
}
function freezeProject(project: ReturnType<typeof createSoundscaperProject>) {
	const sha = 'ab'.repeat(32);
	const identities = [{ sourceId: 'source', contentSha256: sha }];
	const digests = computeAudioTrackFreezeDigestsV1({ sampleRate: 48000, renderStartFrame: 0, renderFrameCount: 512,
		track: project.tracks[0]!, clips: project.clips, sourceContentIdentities: identities,
		automationLanes: project.automationLanes, tempoMap: project.tempoMap });
	const freeze = { schemaVersion: 1 as const, derivedSourceId: 'frozen', ...digests, renderStartFrame: 0,
		renderFrameCount: 512, capturePosition: 'post-insert-pre-strip' as const };
	project = applySoundscaperProjectCommand(project, { type: 'audio-freeze/install', trackId: 'voice', expectedFreeze: null,
		replacementFreeze: freeze, derivedSource: createAudioSource({ id: 'frozen', kind: 'audio', storageKey: 'frozen', sampleRate: 48000,
			channelCount: 1, frameCount: 512, contentSha256: sha }), sourceContentIdentities: identities });
	return { project, freeze, digests };
}
