/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioSource, createAudioClip } from '../../src/common/editor/project-media-factory.ts';

export function vcaPrintProject(mute = true, gain = .5) {
	const source = createAudioSource({ id: 'recording', name: 'Recording', sampleRate: 48_000, channelCount: 1, frameCount: 4_800 });
	const base = createSoundscaperProject({ id: `vca-print-${mute}-${gain}`, sources: [source],
		tracks: ['one', 'two'].map(id => createAudioTrack({ id, name: id, clipIds: [`${id}-clip`] })),
		clips: ['one', 'two'].map(id => createAudioClip({ id: `${id}-clip`, title: id,
			sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
	});
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, vcas: [{ id: 'listening-vca',
		name: 'Listening', gain, mute, members: [{ kind: 'track', id: 'one' }, { kind: 'track', id: 'two' }],
	}] } });
	return { project, source, samples: new Float32Array(source.frameCount).fill(.1) };
}
