/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFreesoundClipUploadMaterializer } from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';

for (const bpm of [120, 240]) for (const bin of [false, true]) {
	test(`Freesound materializes a ${bpm}bpm canonical musical clip in ${bin ? 'Project Bin' : 'the timeline'}`, async () => {
		const tempoMap = { mode: 'musical' as const, events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: bpm, den: 1 } }] };
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Beat take',
			anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 2,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, speedRatio: 1, linkPitchAndTempo: false,
			...(bin ? { binItemId: 'clip' } : {}) }, { projectSampleRate: 48_000, tempoMap });
		const project = createSoundscaperProject({ id: 'musical-upload', sampleRate: 48_000, tempoMap,
			sources: [source], clips: bin ? [] : [clip], projectBin: { clips: bin ? [clip] : [] },
			tracks: [createAudioTrack({ id: 'voice', clipIds: bin ? [] : [clip.id] })] });
		const before = JSON.stringify(project);
		const frames = 48_000 * 120 / bpm;
		let rendered = false;
		const materializer = createFreesoundClipUploadMaterializer({ getProject: () => project,
			async renderClip(renderProject, range) {
				rendered = true;
				assert.deepEqual(range, { startFrame: bin ? 0 : frames, endFrame: bin ? frames : frames * 2 });
				assert.equal(renderProject.clips.length, 1);
				return { length: frames, numberOfChannels: 1, sampleRate: 48_000,
					getChannelData: () => new Float32Array(frames).fill(.25) };
			},
		});
		const result = await materializer.materialize({ projectId: project.id, clipId: clip.id });
		assert.ok(rendered); assert.equal(result.file.type, 'audio/wav');
		assert.equal(result.clip.durationFrames, frames);
		assert.equal(JSON.stringify(project), before, 'upload cannot write resolved coordinates into the saved document');
	});
}
