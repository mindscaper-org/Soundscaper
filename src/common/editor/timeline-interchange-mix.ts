/* SPDX-License-Identifier: AGPL-3.0-only */
import { createDefaultMixerGraphV21, defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerEdgeV21, type MixerStripV21 } from './mixer-graph-v21.ts';
import { interchangeAutomationLane } from './interchange-automation.ts';
import { canonicalParameterAddressKey, type ParameterAddress, type StripRef } from './parameter-address.ts';
import { stripParameterDescriptor, effectParameterInventory } from './effect-parameter-descriptors.ts';
import { normalizeAutomationLaneV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import { timelineImportIssue, type TimelineInterchangeDocument, type TimelineInterchangeStrip } from './timeline-interchange-types.ts';
import type { DeliveryReportItem } from './delivery-report.ts';

/** Materialize native graph identities before resolving sends and automation addresses. */
export function timelineInterchangeMix(document: TimelineInterchangeDocument, trackIds: ReadonlyMap<string, string>,
	tracks: readonly Record<string, unknown>[], sampleRate: number, createId: (prefix: string) => string, trackWidths: ReadonlyMap<string, number> = new Map(), folderIds: ReadonlyMap<string, string> = new Map()) {
	const issues: DeliveryReportItem[] = [], automationLanes: AutomationLaneV21[] = [];
	let clampedValues = 0;
	const busIds = new Map((document.buses ?? []).map(bus => [bus.id, folderIds.get(bus.id) ?? createId('bus')]));
	const groups: MixerStripV21[] = (document.buses ?? []).map(bus => ({
		id: busIds.get(bus.id)!, name: bus.name, color: 'auto', gain: bounded(bus.gain ?? 1, 0, 4), pan: bounded(bus.pan ?? 0, -1, 1),
		mute: folderIds.has(bus.id) ? false : bus.mute ?? false, solo: folderIds.has(bus.id) ? false : bus.solo ?? false, collapsed: false, effectsActive: true, effects: bus.effects ?? [], channelCount: bus.channelCount ?? 2,
	}));
	const base = createDefaultMixerGraphV21(tracks.filter(track => track.type === 'audio').map(track => ({ id: String(track.id), channelCount: trackWidths.get(String(track.id)) ?? 2 })));
	const edges: MixerEdgeV21[] = [...base.edges.filter(edge => edge.source.kind === 'master')];
	const widths = new Map([...trackWidths, ...groups.map(bus => [bus.id, bus.channelCount] as const)]);
	const lanes = new Map<string, AutomationLaneV21>();
	const append = (strip: TimelineInterchangeStrip, owner: StripRef) => {
		const edgeIds = new Map<string, string>();
		if (owner.kind !== 'master') {
			const target = strip.output ? busIds.get(strip.output) : undefined;
			const connected = strip.output !== null && (!strip.output || Boolean(target));
			if (strip.output && !target) issues.push(timelineImportIssue(document.format, 'routing-target-missing', 'An unresolved output is retained as a silent assignment.', 'missing', { target: strip.output }));
			if (strip.output === null) issues.push(timelineImportIssue(document.format, 'disconnected-output-converted', 'An unassigned output is represented by a silent main assignment.', 'converted'));
			edges.push({ id: createId('assignment'), kind: 'assignment', source: owner,
				destination: target ? { kind: 'mixer-node', id: target } : { kind: 'master' }, position: 'post-fader', level: connected ? 1 : 0,
				enabled: true, channelMap: defaultMixerChannelMapV21(widths.get(owner.id) ?? 2, target ? widths.get(target)! : 2) });
		}
		for (const send of strip.sends ?? []) {
			const target = busIds.get(send.target);
			if (!target) { issues.push(timelineImportIssue(document.format, 'send-target-missing', 'An unresolved send target is omitted.', 'missing', { target: send.target })); continue; }
			const id = createId('send'); edgeIds.set(send.id, id);
			edges.push({ id, kind: 'send', source: owner, destination: { kind: 'mixer-node', id: target }, position: send.position,
				level: bounded(send.level, 0, 4), enabled: send.enabled, channelMap: defaultMixerChannelMapV21(owner.kind === 'master' ? 2 : widths.get(owner.id) ?? 2, widths.get(target)!) });
		}
		for (const curve of strip.automation ?? []) {
			let address: ParameterAddress;
			const parameter = curve.parameter;
			if (typeof parameter === 'string') address = { kind: 'strip', strip: owner, parameterId: parameter };
			else if ('sendId' in parameter) {
				const edgeId = edgeIds.get(parameter.sendId); if (!edgeId) continue;
				address = { kind: 'edge', edgeId, parameterId: 'level' };
			} else address = { kind: 'effect', strip: owner, ...parameter };
			const effect = address.kind === 'effect' ? strip.effects?.find(effect => effect.id === address.effectId) : null;
			const descriptor = address.kind === 'effect'
				? effect && effect.type !== 'missing' ? effectParameterInventory(owner, effect, { sampleRate }).descriptors.find(value => value.id === canonicalParameterAddressKey(address)) : undefined
				: stripParameterDescriptor(address);
			if (!descriptor?.automatable) { issues.push(timelineImportIssue(document.format, 'automation-target-unavailable', 'Automation for an unavailable effect parameter is retained in its opaque effect state.')); continue; }
			const points = curve.points.map(point => ({ ...point, ...(parameter === 'mute' ? { interpolation: 'hold' as const } : {}), frame: Math.round(point.frame * sampleRate / document.sampleRate) }));
			const lane = interchangeAutomationLane(points, address, createId, value => bounded(curve.unit === 'decibel' ? 10 ** (value / 20)
				: curve.unit === 'normalized' ? value * 2 - 1 : value, descriptor.minimum, descriptor.maximum));
			if (!lane) continue;
			const admitted = normalizeAutomationLaneV21(lane, { descriptor });
			const key = canonicalParameterAddressKey(address);
			if (lanes.has(key)) throw new RangeError('Imported automation has duplicate parameter ownership.');
			lanes.set(key, admitted);
		}
	};
	for (const track of document.tracks) { const id = trackIds.get(track.id); if (id && track.kind === 'audio') append({ ...track, ...(track.output === undefined && track.folderId ? { output: track.folderId } : {}) }, { kind: 'track', id }); }
	const folderParents = new Map(document.folders?.map(folder => [folder.id, folder.parentFolderId]));
	for (const bus of document.buses ?? []) append({ ...bus, ...(bus.output === undefined && folderParents.get(bus.id) ? { output: folderParents.get(bus.id)! } : {}) }, { kind: 'mixer-node', id: busIds.get(bus.id)! });
	append(document.master ?? {}, { kind: 'master' });
	automationLanes.push(...lanes.values());
	const mixer = normalizeMixerGraphV21({ ...base, groups, edges });
	if (clampedValues) issues.push(timelineImportIssue(document.format, 'mix-value-clamped', 'Mix controls outside their destination ranges are limited to those ranges.', 'converted', { values: clampedValues }));
	if (automationLanes.length || groups.length || document.tracks.some(track => track.effects?.length)) issues.push(timelineImportIssue(document.format,
		'mix-preserved', 'Supported mix routing, automation and effect records were imported. Foreign processors remain bypassed.', 'preserved',
		{ automationLanes: automationLanes.length, buses: groups.length, sends: edges.filter(edge => edge.kind === 'send').length }));
	return { mixer, automationLanes, issues };

	function bounded(value: number, minimum: number, maximum: number): number {
		if (!Number.isFinite(value)) throw new RangeError('Imported mix controls must be finite.');
		const imported = Math.max(minimum, Math.min(maximum, value));
		if (imported !== value) clampedValues++;
		return imported;
	}
}
