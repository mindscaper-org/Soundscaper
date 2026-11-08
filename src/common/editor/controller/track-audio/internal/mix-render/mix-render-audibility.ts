/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../../automation-lane-v21.ts';
import type { MixerGraphV21, MixerVcaV21 } from '../../../../mixer-graph-v21.ts';
import type { StripRef } from '../../../../parameter-address.ts';
import type { ControllerTrack } from '../../track-domain-types.ts';

interface CaptureProject {
	tracks: ControllerTrack[];
	mixer: MixerGraphV21;
	automationLanes: unknown[];
}

/** Printing overrides programme audibility; external detectors retain their authored gates. */
export function prepareMixRenderAudibility(
	snapshot: CaptureProject, targetIds: ReadonlySet<string>, programmeNodeIds: ReadonlySet<string>,
): void {
	const programme = (strip: StripRef): boolean => strip.kind === 'track' ? targetIds.has(strip.id)
		: strip.kind === 'mixer-node' ? programmeNodeIds.has(strip.id) : true;
	snapshot.tracks = snapshot.tracks.map(track => ({ ...track,
		mute: targetIds.has(track.id) ? false : track.mute, solo: false,
	}));
	const strips = <Strip extends Readonly<{ id: string; mute: boolean; solo: boolean }>>(values: readonly Strip[]): Strip[] =>
		values.map(strip => ({ ...strip, mute: programmeNodeIds.has(strip.id) ? false : strip.mute, solo: false }));
	const occupied = new Set(snapshot.mixer.vcas.map(vca => vca.id));
	let sequence = 0;
	const vcas = snapshot.mixer.vcas.flatMap((vca): MixerVcaV21[] => {
		if (!vca.mute) return [vca];
		const targets = vca.members.filter(programme), controls = vca.members.filter(member => !programme(member));
		if (!targets.length) return [vca];
		let id = vca.id;
		if (controls.length) {
			do { id = `mix-render-vca:${++sequence}`; } while (occupied.has(id));
			occupied.add(id);
		}
		return [...(controls.length ? [{ ...vca, members: controls }] : []),
			{ ...vca, id, members: targets, mute: false }];
	});
	snapshot.mixer = { ...snapshot.mixer, groups: strips(snapshot.mixer.groups),
		sends: strips(snapshot.mixer.sends), cues: strips(snapshot.mixer.cues), vcas };
	snapshot.automationLanes = snapshot.automationLanes.filter(value => {
		const { address } = normalizeAutomationLaneV21(value);
		return address.kind !== 'strip' || address.parameterId !== 'mute' || !programme(address.strip);
	});
}
