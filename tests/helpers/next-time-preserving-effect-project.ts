/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioSource, createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../../src/common/editor/automation-lane-v21.ts';

export function effectAutomationProject() {
	const samples = Float32Array.from({ length: 48_000 }, (_, index) => .25 * Math.sin(2 * Math.PI * 197 * index / 48_000));
	const source = createAudioSource({ id: 'recording', name: 'Recording', sampleRate: 48_000, channelCount: 1, frameCount: samples.length });
	const lane = normalizeAutomationLaneV21({ id: 'voice-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: [{ id: 'start', position: 0, value: .1 }, { id: 'rise', position: 12_000, value: 1 },
			{ id: 'fall', position: 24_000, value: .2 }, { id: 'end', position: 48_000, value: .8 }],
		segments: [{ kind: 'linear' }, { kind: 'linear' }, { kind: 'linear' }],
	});
	const project = createSoundscaperProject({ id: 'effect-automation', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id,
			durationFrames: samples.length, sourceDurationFrames: samples.length })], automationLanes: [lane],
	});
	return { project, source, samples };
}
