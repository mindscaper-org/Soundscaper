/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { publishBlenderTracks } from '../src/common/editor/controller/export/blender-publication.ts';
import { validateBlenderBegin, type BlenderBeginRequest, type BlenderBridge } from '../src/common/editor/blender-contract.ts';

test('Blender track publication resolves musical placement at the current tempo', async () => {
	const clip = createAudioClip({ id: 'clip', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 2, den: 1 },
		timelineStartFrame: 16000, durationFrames: 8000, sourceDurationFrames: 8000 });
	const project = createAudioEditorProjectV17({ sampleRate: 8000, sources: [createAudioSource({
		id: 'source', sampleRate: 8000, frameCount: 8000, channelCount: 1 })], clips: [{ ...clip }],
		tracks: [{ ...createAudioTrack({ id: 'track', clipIds: ['clip'] }, 8000) }],
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } }] } });
	const begins: BlenderBeginRequest[] = [];
	const bridge: BlenderBridge = {
		select: async () => null,
		begin: async value => { begins.push(validateBlenderBegin(value)); return { publicationId: 'b'.repeat(48) }; },
		write: async () => undefined, commit: async () => ({ revision: 1 }),
		abort: async () => undefined, stop: async () => undefined,
	};
	await publishBlenderTracks({ getProject: () => project,
		stemProject: value => value, tailFrames: () => 0,
		renderSnapshot: async (_project, range) => {
			assert.equal(range.endFrame, 48000);
			return { length: range.endFrame, numberOfChannels: 1, sampleRate: 8000,
				getChannelData: () => new Float32Array(range.endFrame) };
		},
	}, { bridge, sessionId: 'a'.repeat(48), projectId: project.id, revision: project.revision });
	assert.equal(begins[0]?.tracks[0]?.durationSeconds, 6);
});
