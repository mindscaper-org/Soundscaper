/* SPDX-License-Identifier: AGPL-3.0-only */
import { STEREO_LIMITED_RENDER_EFFECT_TYPES } from './adm-render-safety.ts';
import { isMixerGraphV21Surface } from './mixer-graph-surface-v21.ts';
import { hasProductionMixerProjectAuthority } from './project-schema-version.ts';
import { resolveTerminalChannelWidths, type TerminalWidthProject } from './terminal-channel-widths.ts';

interface RackChannelOwner {
	readonly effectsActive?: boolean;
	readonly effects?: readonly Readonly<{ id?: unknown; type?: unknown; enabled?: boolean; bypassed?: boolean }>[];
}
export interface RackChannelProject extends TerminalWidthProject {
	readonly tracks?: readonly (NonNullable<TerminalWidthProject['tracks']>[number] & RackChannelOwner)[];
	readonly master?: RackChannelOwner;
	readonly mixer?: Omit<NonNullable<TerminalWidthProject['mixer']>, 'groups' | 'sends'> & Readonly<{
		groups?: readonly (NonNullable<NonNullable<TerminalWidthProject['mixer']>['groups']>[number] & RackChannelOwner)[];
		sends?: readonly (NonNullable<NonNullable<TerminalWidthProject['mixer']>['sends']>[number] & RackChannelOwner)[];
	}>;
	readonly masterChannels?: number;
	readonly automationLanes?: readonly unknown[];
}
const supportedWidth = (value: number | undefined): number => Math.min(32,
	Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 2);

/** Mirror the graph's actual processor width before a manual rack mutation. */
export function rackEffectChannelCount(project: RackChannelProject, scope: string, targetId: string | null): number {
	return createRackWidthReader(project)(scope, targetId);
}

function createRackWidthReader(project: RackChannelProject): (scope: string, targetId: string | null) => number {
	const production = hasProductionMixerProjectAuthority(project)
		|| (isMixerGraphV21Surface(project.mixer) && Array.isArray(project.automationLanes));
	const masterWidth = supportedWidth(project.masterChannels);
	const widths = resolveTerminalChannelWidths(project, production ? masterWidth : 2);
	const legacyWidth = production ? 0 : Math.min(32, Math.max(2, masterWidth, ...widths.tracks.values()));
	return (scope, targetId) => {
		if (scope === 'track') return widths.tracks.get(String(targetId)) ?? (production ? masterWidth : 2);
		if (!production) return legacyWidth;
		if (scope === 'master') return masterWidth;
		return (scope === 'group' ? widths.groups : widths.sends).get(String(targetId)) ?? masterWidth;
	};
}

/** Compare realized active racks once per transaction, sharing manual admission's width authority. */
export function activeRackWidthViolations(project: RackChannelProject): ReadonlySet<string> {
	const owners: { scope: string; id: string | null; owner: RackChannelOwner }[] = [];
	for (const track of project.tracks ?? []) {
		// Empty track racks have no clip graph; their master-width fallback is not processed.
		if (track.type !== 'video' && track.type !== 'label' && track.clipIds?.length) owners.push({ scope: 'track', id: String(track.id), owner: track });
	}
	if (project.master) owners.push({ scope: 'master', id: null, owner: project.master });
	for (const scope of ['group', 'send'] as const) {
		for (const bus of (scope === 'group' ? project.mixer?.groups : project.mixer?.sends) ?? []) {
			owners.push({ scope, id: String(bus.id), owner: bus });
		}
	}
	const active = owners.flatMap(({ scope, id, owner }) => owner.effectsActive === false ? [] : (owner.effects ?? [])
		.filter(effect => effect.enabled !== false && effect.bypassed !== true && STEREO_LIMITED_RENDER_EFFECT_TYPES.includes(String(effect.type)))
		.map(effect => ({ scope, id, effect })));
	if (!active.length) return new Set();
	const width = createRackWidthReader(project), violations = new Set<string>();
	for (const { scope, id, effect } of active) {
		const channels = width(scope, id);
		if (channels > 2) violations.add(JSON.stringify([scope, id, effect.id, effect.type, channels]));
	}
	return violations;
}

export function unavailableRackEffectTypes(project: RackChannelProject | null | undefined, scope: string, targetId: string | null): readonly string[] {
	return project && rackEffectChannelCount(project, scope, targetId) > 2 ? STEREO_LIMITED_RENDER_EFFECT_TYPES : [];
}

function rackOwner(project: RackChannelProject | null | undefined, scope: string, targetId: string | null): RackChannelOwner | undefined {
	if (scope === 'master') return project?.master;
	if (scope === 'track') return project?.tracks?.find(owner => owner.id === targetId);
	return (scope === 'group' ? project?.mixer?.groups : project?.mixer?.sends)?.find(owner => owner.id === targetId);
}

export function rackEffectsActive(project: RackChannelProject, scope: string, targetId: string | null): boolean {
	return rackOwner(project, scope, targetId)?.effectsActive !== false;
}

/** A bypassed imported rack remains editable; activation must preserve its signal width. */
export function admitRackEffectActivation<Changes extends Readonly<Record<string, unknown>>>(
	project: RackChannelProject | null | undefined, scope: string, targetId: string | null, changes: Changes, message: string,
): Changes {
	if (changes.effectsActive === true && rackOwner(project, scope, targetId)?.effects?.some(effect => effect.enabled !== false
		&& effect.bypassed !== true && STEREO_LIMITED_RENDER_EFFECT_TYPES.includes(String(effect.type)))
		&& unavailableRackEffectTypes(project, scope, targetId).length) throw new RangeError(message);
	return changes;
}
