/* SPDX-License-Identifier: AGPL-3.0-only */
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createDefaultAdmMetadata, setAdmEditorAssignment } from '../../src/common/editor/ui/adm-metadata-editor-model.ts';
import type { MixerEdgeV21 } from '../../src/common/editor/mixer-graph-v21.ts';

export function zeroCrossingRouteProject(kind: 'assignment' | 'adm' | 'reference', detector = false) {
	const samples = Float32Array.from({ length: 48_000 }, (_, index) => .25 * Math.sin(2 * Math.PI * 197 * index / 48_000));
	const source = createAudioSource({ id: 'tone', name: 'Recording', frameCount: samples.length, sampleRate: 48_000, channelCount: 1 });
	const gate = createEffect('gate', { id: 'gate' });
	const base = createSoundscaperProject({ id: 'zero-crossing-route', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: .6, mute: true, clipIds: ['recording'], effects: detector ? [gate] : [] }),
			...(detector ? [createAudioTrack({ id: 'detector', name: 'Detector', clipIds: ['detector-clip'] })] : [])],
		clips: [createAudioClip({ id: 'recording', title: 'Recording', sourceId: source.id, durationFrames: samples.length, sourceDurationFrames: samples.length }),
			...(detector ? [createAudioClip({ id: 'detector-clip', sourceId: source.id, durationFrames: samples.length, sourceDurationFrames: samples.length })] : [])],
		master: { gain: .25 },
	});
	const sidechain: MixerEdgeV21 = { id: 'external-detector', kind: 'sidechain', source: { kind: 'track', id: 'detector' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: gate.id },
		position: 'pre-fader', level: .5, enabled: true, channelMap: [0] };
	const adm = kind === 'adm' ? setAdmEditorAssignment(createDefaultAdmMetadata(base, 'stereo'),
		{ stripKind: 'track', stripId: 'voice', sourceChannel: 0, bedChannel: 'L', gain: 0 }) : null;
	const project = createSoundscaperProject({ ...base, metadata: { ...base.metadata, adm },
		mixer: { ...base.mixer, edges: [...base.mixer.edges.map(edge => edge.kind === 'assignment'
			&& edge.source.kind === 'track' && edge.source.id === 'voice' && kind === 'assignment' ? { ...edge, level: 0 } : edge),
			...(detector ? [sidechain] : [])] },
	});
	return { project, source, samples };
}
