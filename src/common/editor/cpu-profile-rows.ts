/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CpuEffectReading } from './cpu-profile-contract.ts';
import type { EngineEffect, EngineGainOwner } from './engine/types.ts';
import { effectGraphKey } from './engine/effect-rack-node-registry.ts';

interface Owner extends EngineGainOwner { readonly name?: string }
export interface CpuProfileProject {
	readonly tracks?: readonly Owner[];
	readonly master?: Owner;
	readonly mixer?: { readonly groups?: readonly Owner[]; readonly sends?: readonly Owner[]; readonly cues?: readonly Owner[] };
}
export interface CpuProfileEffectRow {
	readonly key: string;
	readonly scope: string;
	readonly ownerName: string;
	readonly position: number;
	readonly effect: EngineEffect;
	readonly disabled: boolean;
	readonly native: boolean;
	readonly reading: CpuEffectReading | undefined;
}

/** Inventory includes disabled racks; absent timing is never presented as zero CPU. */
export function cpuProfileEffectRows(project: CpuProfileProject | null | undefined,
	readings: readonly CpuEffectReading[]): CpuProfileEffectRow[] {
	const measured = new Map(readings.map(reading => [reading.key, reading]));
	const rows: CpuProfileEffectRow[] = [];
	const add = (scope: string, owner: Owner | undefined): void => {
		for (const [index, effect] of (owner?.effects ?? []).entries()) {
			if (!effect.id) continue;
			const key = effectGraphKey(scope, owner?.id, effect.id);
			const disabled = owner?.effectsActive === false || effect.enabled === false || effect.bypassed === true;
			rows.push({ key, scope, ownerName: owner?.name ?? String(owner?.id ?? ''), position: index + 1, effect, disabled,
				native: String(effect.type).startsWith('native-'), reading: disabled ? undefined : measured.get(key) });
		}
	};
	for (const track of project?.tracks ?? []) if (track.type !== 'label' && track.type !== 'video') add('track', track);
	for (const owner of project?.mixer?.groups ?? []) add('group', owner);
	for (const owner of project?.mixer?.sends ?? []) add('send', owner);
	for (const owner of project?.mixer?.cues ?? []) add('group', owner);
	add('master', project?.master);
	return rows;
}
