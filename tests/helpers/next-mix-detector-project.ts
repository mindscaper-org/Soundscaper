/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import type { MixerEdgeV21 } from '../../src/common/editor/mixer-graph-v21.ts';

export function mixDetectorProject(kind: 'track' | 'bus' = 'track', enabled = true) {
	const sources = ['voice', 'control'].map(id => createAudioSource({ id, sampleRate: 48_000, channelCount: 1, frameCount: 48_000 }));
	const base = createSoundscaperProject({ id: `mix-detector-${kind}-${enabled}`, sources,
		tracks: sources.map(source => createAudioTrack({ id: source.id, name: source.id, clipIds: [`${source.id}-clip`],
			effects: source.id === 'voice' ? [createEffect('gate', { id: 'gate', enabled, params: { threshold: -20 } })] : [] })),
		clips: sources.map(source => createAudioClip({ id: `${source.id}-clip`, title: source.id, sourceId: source.id,
			durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
	});
	const edges: MixerEdgeV21[] = [...base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'control' ? { ...edge, level: 0 } : edge),
		{ id: 'detector', kind: 'sidechain', source: { kind: kind === 'track' ? 'track' : 'mixer-node', id: kind === 'track' ? 'control' : 'relay' },
			destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'gate' }, position: 'pre-fader', level: 1, enabled: true, channelMap: [0, 0] }];
	if (kind === 'bus') edges.push(
		{ id: 'relay-input', kind: 'send', source: { kind: 'track', id: 'control' }, destination: { kind: 'mixer-node', id: 'relay' }, position: 'pre-fader', level: 1, enabled: true, channelMap: [0, 0] },
		{ id: 'relay-output', kind: 'assignment', source: { kind: 'mixer-node', id: 'relay' }, destination: { kind: 'master' }, position: 'post-fader', level: 0, enabled: true, channelMap: [0, 1] },
	);
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, edges, groups: kind === 'bus' ? [{ id: 'relay', name: 'Detector relay', color: '#537390',
		gain: 1, pan: 0, mute: false, solo: false, collapsed: true, effectsActive: true, effects: [], channelCount: 2 }] : [] } });
	return { project, sources, channels: new Map(sources.map(source => [source.id, [new Float32Array(source.frameCount).fill(source.id === 'voice' ? .25 : .001)]])) };
}
