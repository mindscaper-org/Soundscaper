/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import type { MidiServiceDependencies } from '../src/common/editor/controller/track-audio/midi-service-types.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';

for (const mode of ['empty', 'duplicate'] as const) test(`instrument changes also reach the notes saved behind an ${mode} playlist`, async () => {
	let project = createSoundscaperProject({ sampleRate: 8000 }), counter = 0;
	const pcm = new Map<string, Float32Array[]>();
	const deps: MidiServiceDependencies = { getProject: () => project, editingBlocked: () => false,
		commit: command => { project = apply(project, command); }, createId: prefix => `${prefix}-${++counter}`,
		trackName: () => 'Keys', clipName: () => 'Notes', previewNote: async () => undefined, saveFile: () => undefined,
		store: { beginSourceWrite: async id => {
			const chunks: Float32Array[] = []; pcm.set(id, chunks);
			return { write: channels => { chunks.push(channels[0]!.slice()); }, commit: () => undefined, abort: () => undefined };
		}, deleteSource: async id => { pcm.delete(id); } } };
	const service = createMidiService(deps), { trackId, clipId } = await service.addTrack();
	await service.addNote(clipId, { id: 'note', startFrame: 0, durationFrames: 4000, pitch: 69, velocity: 100, channel: 0 });
	project = apply(project, { type: 'track/playlist-create', trackId, mode, id: 'new', name: 'New', originalId: 'original', originalName: 'Original' });
	const revision = project.revision;
	await service.setInstrument(trackId, 'square');
	assert.equal(project.revision, revision + 1, 'the shared instrument change has one history revision');
	project = apply(project, { type: 'track/playlist-activate', trackId, id: 'original' });
	assert.equal(readMidiTrack(project.tracks.find(track => track.id === trackId))?.instrument, 'square');
	const clip = project.clips.find(clip => clip.id === clipId)!;
	assert.deepEqual(pcm.get(clip.sourceId)![0]!.subarray(0, 1000), renderMidiFrames(readMidiClip(clip)!.notes, 'square', 8000, 0, 1000));
});
