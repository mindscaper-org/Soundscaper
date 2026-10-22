/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import type { MixerEdgeV21, MixerGraphV21 } from '../../../mixer-graph-v21.ts';
import type { EffectAudioProject } from './effect-audio-service-types.ts';

/** Capture an already selected Master rack prefix, before its listening strip
 * and output routes. Parallel paths bypassing Master cannot enter this tap.
 */
export function createMasterNoiseProfileRenderProject(project: EffectAudioProject): EffectAudioProject {
	const mixer = project.mixer as unknown as MixerGraphV21;
	const main = mixer.outputs.find(output => output.role === 'main');
	if (!main) throw new ReferenceError('The master noise-profile capture requires its main output.');
	const prefixIds = new Set(project.master.effects.map(effect => effect.id));
	const suppressedIds = new Set<string>();
	const edges = mixer.edges.filter(edge => !(edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'master' && !prefixIds.has(edge.destination.effectId))).map(edge => {
		if (edge.destination.kind !== 'output') return edge;
		suppressedIds.add(edge.id);
		return { ...edge, level: 0 };
	});
	let id = 'noise-profile:master:main';
	while (mixer.edges.some(edge => edge.id === id)) id += ':';
	const capture: MixerEdgeV21 = { id, kind: 'assignment', source: { kind: 'master' },
		destination: { kind: 'output', id: main.id }, position: 'post-fader', level: 1, enabled: true,
		channelMap: Array.from({ length: project.masterChannels }, (_, channel) => channel) };
	const retainedIds = new Set(edges.map(edge => edge.id));
	const lanes: readonly unknown[] = Array.isArray(project.automationLanes) ? project.automationLanes : [];
	return { ...project, mixer: { ...mixer, edges: [...edges, capture],
		outputs: mixer.outputs.map(output => output.id === main.id ? { ...output, channelCount: project.masterChannels } : output),
		vcas: mixer.vcas.map(vca => ({ ...vca, members: vca.members.filter(member => member.kind !== 'master') })),
	}, automationLanes: lanes.map(lane => normalizeAutomationLaneV21(lane)).filter(({ address }) =>
		address.kind === 'edge' ? retainedIds.has(address.edgeId) && !suppressedIds.has(address.edgeId)
			: address.strip.kind !== 'master' || address.kind === 'effect' && prefixIds.has(address.effectId)) };
}
