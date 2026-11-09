/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';

export const FOREIGN_ROUTES = ['foreign-folder', 'foreign-chain', 'ordinary-submix'] as const;

export function dawprojectForeignRoute(route: typeof FOREIGN_ROUTES[number], automated: boolean) {
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: 'programme', title: 'Cross-sequence bus', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), createAudioTrack({ id: 'other', name: 'Other sequence recording' })],
		trackFolders: [...(route === 'foreign-chain' ? [{ id: 'parent', name: 'Parent bus', mute: true }] : []), { id: 'foreign', name: 'Foreign bus', mute: route === 'foreign-chain' }], primarySequenceId: 'first', sequences: [
			{ id: 'first', name: 'First', trackNodes: [{ kind: 'track', id: 'voice', parentFolderId: null }] },
			{ id: 'second', name: 'Second', trackNodes: [...(route === 'foreign-chain' ? [{ kind: 'folder', id: 'parent', parentFolderId: null }] : []), { kind: 'folder', id: 'foreign', parentFolderId: route === 'foreign-chain' ? 'parent' : null }, { kind: 'track', id: 'other', parentFolderId: 'foreign' }] },
		] });
	const foreign = base.mixer.groups[0]; assert.ok(foreign);
	const ordinary = { ...foreign, id: 'ordinary', name: 'Ordinary bus', gain: .4 };
	const project = createSoundscaperProject({ ...base, ...(automated ? { automationLanes: [{ id: 'gain-lane', address: { kind: 'strip', strip: { kind: 'mixer-node', id: route.startsWith('foreign') ? 'foreign' : ordinary.id }, parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'gain-point', position: 0, value: .2 }], segments: [] }] } : {}), mixer: { ...base.mixer,
		groups: [...base.mixer.groups.map(group => ({ ...group, gain: .4 })), ...(route === 'ordinary-submix' ? [ordinary] : [])],
		edges: [...base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'voice'
			? { ...edge, destination: { kind: 'mixer-node', id: route.startsWith('foreign') ? 'foreign' : ordinary.id } } : edge),
			...(route === 'ordinary-submix' ? [{ id: 'ordinary-master', kind: 'assignment', source: { kind: 'mixer-node', id: ordinary.id },
				destination: { kind: 'master' }, level: 1, position: 'post-fader', enabled: true, channelMap: [0, 1] }] : [])],
	} });
	const pcm = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)];
	return { project, source, pcm, channels: new Map([[source.storageKey, pcm]]) };
}
