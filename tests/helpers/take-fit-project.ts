/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';

/** Ordinary imported audio followed by independently recorded, unflattened takes. */
export function createTakeFitProject() {
	return createSoundscaperProject({ id: 'take-fit-project', title: 'Takes beyond the bed', sampleRate: 48_000,
		sources: [
			createAudioSource({ id: 'bed', storageKey: 'bed', name: 'Bed.wav', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 }),
			createAudioSource({ id: 'take-source', storageKey: 'take-source', name: 'Recorded take.wav', frameCount: 96_000, sampleRate: 48_000, channelCount: 1 }),
		],
		tracks: [createAudioTrack({ id: 'track', name: 'Narration', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', title: 'Bed', sourceId: 'bed', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		sequences: [{ id: 'main', trackIds: ['track'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'track', startSample: 480_000, endSample: 576_000,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: 'take-source',
				sourceStartSample: 0, startSample: 480_000, endSample: 576_000 }],
			compRegions: [{ id: 'comp', takeId: 'take', startSample: 480_000, endSample: 576_000 }],
		}],
	});
}
