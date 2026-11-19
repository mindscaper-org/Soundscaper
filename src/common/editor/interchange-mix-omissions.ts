/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem } from './delivery-report.ts';
import { defaultMixerChannelMapV21 } from './mixer-graph-v21.ts';

type Data = Readonly<Record<string, unknown>>;

/** A cut-only exchange has no master, bus, connection or project-automation vocabulary. */
export function reportInterchangeMixOmissions(draft: Parameters<typeof addDeliveryReportItem>[0], project: Data,
	options: Readonly<{ trackAutomationReported?: boolean }> = {}): boolean {
	const master = record(project.master), mixer = record(project.mixer);
	const masterChanged = master.gain != null && master.gain !== 1 || master.pan || master.mute || master.solo
		|| records(master.envelope).some(point => point.value !== 1)
		|| activeEffects(master).length > 0 || project.masterGain != null && project.masterGain !== 1
		|| records(project.masterEffects).length > 0;
	const nodes = [...records(mixer.groups), ...records(mixer.sends), ...records(mixer.cues)];
	const automation = records(project.automationLanes).filter(lane => {
		if (!records(lane.points).length) return false;
		const address = record(lane.address);
		return !options.trackAutomationReported || address.kind !== 'strip' || record(address.strip).kind !== 'track';
	});
	const width = endpointWidths(project, mixer, nodes);
	const outputs = new Map(records(mixer.outputs).map(output => [output.id, output]));
	const edges = records(mixer.edges).filter(edge => {
		const destination = record(edge.destination);
		const output = destination.kind === 'output' ? outputs.get(destination.id) : null;
		if (edge.kind !== 'assignment' || edge.enabled === false || edge.level != null && edge.level !== 1
			|| edge.position === 'pre-fader' || !['master', 'output'].includes(String(destination.kind))
			|| output && output.role !== 'main') return true;
		if (!Array.isArray(edge.channelMap)) return false;
		const expected = defaultMixerChannelMapV21(width(record(edge.source)), width(destination));
		return edge.channelMap.length !== expected.length || edge.channelMap.some((channel, index) => channel !== expected[index]);
	});
	if (!masterChanged && !nodes.length && !records(mixer.vcas).length && !edges.length && !automation.length
		&& !records(project.buses).length) return false;
	addDeliveryReportItem(draft, {
		code: `${draft.subject.format}.mix-processing-omitted`, disposition: 'omitted', severity: 'warning',
		scope: { kind: 'project', id: String(project.id ?? '') },
		data: { ...(masterChanged ? { master: true } : {}),
			...(nodes.length ? { mixerNodes: nodes.map(node => String(node.id)) } : {}),
			...(records(mixer.vcas).length ? { vcas: records(mixer.vcas).map(node => String(node.id)) } : {}),
			...(edges.length ? { routingEdges: edges.map(edge => String(edge.id)) } : {}),
			...(automation.length ? { automationLanes: automation.map(lane => String(lane.id)) } : {}),
			...(records(project.buses).length ? { buses: records(project.buses).length } : {}) },
		message: 'Mixer routing, master processing and project automation remain in the native project.',
	});
	return true;
}

function activeEffects(owner: Data): readonly Data[] {
	return owner.effectsActive === false ? [] : records(owner.effects).filter(effect => effect.enabled !== false && effect.bypassed !== true);
}

/** Build widths once; ordinary mono assignments must not look like custom stereo maps. */
function endpointWidths(project: Data, mixer: Data, nodes: readonly Data[]): (endpoint: Data) => number {
	const fallback = Number(project.masterChannels) || 2;
	const clips = new Map(records(project.clips).map(clip => [clip.id, clip]));
	const sources = new Map(records(project.sources).map(source => [source.id, source]));
	const widths = new Map<string, number>();
	for (const track of records(project.tracks)) {
		let channels = 0;
		for (const id of Array.isArray(track.clipIds) ? track.clipIds : []) channels = Math.max(channels,
			Number(sources.get(clips.get(id)?.sourceId)?.channelCount) || 0);
		widths.set(`track:${String(track.id)}`, channels || fallback);
	}
	for (const node of nodes) widths.set(`mixer-node:${String(node.id)}`, Number(node.channelCount) || fallback);
	for (const output of records(mixer.outputs)) widths.set(`output:${String(output.id)}`, Number(output.channelCount) || fallback);
	return endpoint => endpoint.kind === 'master' ? fallback : widths.get(`${String(endpoint.kind)}:${String(endpoint.id)}`) ?? fallback;
}

function record(value: unknown): Data { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}; }
function records(value: unknown): readonly Data[] { return Array.isArray(value) ? value.filter((item): item is Data => item !== null && typeof item === 'object' && !Array.isArray(item)) : []; }
