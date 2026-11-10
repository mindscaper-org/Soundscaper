/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';

export const MASTER_ROUTES = ['direct output bypass', 'ordinary Master processing', 'bus bypass', 'coexisting paths', 'automated coexisting paths', 'secondary output', 'Master secondary output', 'absent Master output', 'disabled Master output'] as const;

export function dawprojectMasterRoute(route: typeof MASTER_ROUTES[number]) {
	const mixed = route.includes('coexisting'), automated = route.startsWith('automated');
	const masterDetached = route === 'absent Master output' || route === 'disabled Master output';
	const bypass = route !== 'ordinary Master processing' && !masterDetached;
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: `daw-main-${route}`, title: 'Master bypass', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 4800, sourceDurationFrames: 4800 }),
			...(mixed ? [createAudioClip({ id: 'ordinary-clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] : [])],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), ...(mixed ? [createAudioTrack({ id: 'ordinary', name: 'Ordinary', gain: .4, clipIds: ['ordinary-clip'] })] : []),
			...(route === 'Master secondary output' ? [createAudioTrack({ id: 'bypass', name: 'Empty bypass' })] : [])] });
	const output = base.mixer.outputs.find(candidate => candidate.role === 'main'); assert.ok(output);
	const bus = { id: 'bus', name: 'Dry bus', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const terminal = { kind: 'output', id: route === 'secondary output' ? 'cue-output' : output.id };
	const project = createSoundscaperProject({ ...base, master: { ...base.master, gain: .2 },
		...(automated ? { automationLanes: [{ id: 'master-gain', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'point', position: 0, value: .4 }], segments: [] }] } : {}),
		mixer: { ...base.mixer, groups: route === 'bus bypass' ? [bus] : [], sends: masterDetached ? [bus] : [],
			outputs: [...base.mixer.outputs, ...(route.includes('secondary output') ? [{ id: 'cue-output', name: 'Cue output', role: 'cue', channelCount: 2 }] : [])], edges: [
				...base.mixer.edges.flatMap(edge => edge.source.kind === 'master' && masterDetached
					? route === 'disabled Master output' ? [{ ...edge, enabled: false }] : [] : [edge]).map(edge => route === 'Master secondary output' && edge.source.kind === 'master'
					? { ...edge, destination: { kind: 'output', id: 'cue-output' } }
					: edge.source.kind === 'track' && edge.source.id === 'bypass'
						? { ...edge, destination: { kind: 'output', id: output.id } }
						: bypass && route !== 'Master secondary output' && edge.source.kind === 'track' && edge.source.id === 'voice'
					? { ...edge, destination: route === 'bus bypass' ? { kind: 'mixer-node', id: bus.id } : terminal } : edge),
				...(route === 'bus bypass' || masterDetached ? [{ id: 'bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: bus.id },
					destination: terminal, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
				...(masterDetached ? [{ id: 'voice-send', kind: 'send', source: { kind: 'track', id: 'voice' },
					destination: { kind: 'mixer-node', id: bus.id }, position: 'post-fader', level: .4, enabled: true, channelMap: [0, 1] }] : []),
			],
		},
	});
	const pcm = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)];
	return { project, source, pcm, channels: new Map([[source.storageKey, pcm]]) };
}
