/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EngineEffect,
	EngineEffectRackLocation,
	EngineProject,
	EngineTrack,
	UnknownRecord,
} from './types.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from '../track-folder-media-runtime.ts';

const PARAMETRIC_EQ_TYPES: ReadonlySet<string> = new Set(['eq', 'parametric-eq', 'parametric_eq']);

export function isParametricEqType(type: unknown): boolean {
	return PARAMETRIC_EQ_TYPES.has(String(type || '').toLowerCase());
}

export function activeRackEffects(owner: Readonly<{
	effectsActive?: boolean;
	effects?: readonly EngineEffect[];
}> | null | undefined): readonly EngineEffect[] {
	if (!owner || owner.effectsActive === false || !Array.isArray(owner.effects)) return [];
	return owner.effects;
}

export function effectRackMatchesTrack(project: EngineProject | null | undefined, rack: EngineEffectRackLocation, trackId: unknown): boolean {
	if (trackId == null || rack.scope === 'master') return true;
	if (rack.scope === 'track') return rack.targetId === String(trackId);
	return rack.scope === 'clip' && Boolean(project?.tracks?.find(track => track.id === trackId)?.clipIds?.includes(rack.targetId));
}

/** Iterate every rack location that the project graph can process. */
export function* projectEffectRacks(
	project: EngineProject | null | undefined,
): Generator<EngineEffectRackLocation> {
	for (const clip of project?.clips ?? []) {
		if (clip.kind !== 'audio' || !clip.effects?.length) continue;
		yield { scope: 'clip', targetId: String(clip.id), effectsActive: clip.effectsActive !== false, effects: activeRackEffects(clip) };
	}
	const audioTracks = (project?.tracks || [])
		.filter(track => track?.type !== 'label' && track?.type !== 'video');
	if (Object.getPrototypeOf(audioTracks) === Array.prototype && !Object.hasOwn(audioTracks, 'entries')) {
		for (let index = 0; index < audioTracks.length; index++) yield trackEffectRack(audioTracks[index]!, index);
	} else {
		for (const [index, track] of audioTracks.entries()) yield trackEffectRack(track, index);
	}
	for (const [scope, buses] of [
		['group', project?.mixer?.groups],
		['send', project?.mixer?.sends],
		['group', project?.mixer?.cues],
	] as const) {
		for (const bus of Array.isArray(buses) ? buses : []) {
			yield {
				scope,
				targetId: String(bus.id),
				effectsActive: bus?.effectsActive !== false,
				effects: activeRackEffects(bus),
			};
		}
	}
	yield {
		scope: 'master',
		targetId: null,
		effectsActive: project?.master?.effectsActive !== false,
		effects: activeRackEffects(project?.master),
	};
}

export function projectWithParametricEqParams(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
	params: unknown,
): EngineProject | null {
	return projectWithEffectParams(
		project,
		scope,
		targetId,
		effectId,
		params,
		(effect) => isParametricEqType(effect?.type),
	);
}

export function projectWithEffectParams(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
	params: unknown,
	predicate: (effect: EngineEffect) => boolean = () => true,
): EngineProject | null {
	if (!project) return null;
	const derive = (updated: EngineProject) => inheritTrackFolderMediaStateProjectionV12(project, updated);
	const normalizedScope = String(scope || '');
	const replaceEffects = (effects: readonly EngineEffect[] | undefined): EngineEffect[] | null => {
		if (!Array.isArray(effects)) return null;
		const index = effects.findIndex((effect) => effect?.id === effectId && predicate(effect));
		if (index < 0) return null;
		const output = effects.slice();
		output[index] = {
			...effects[index],
			params: cloneMessageValue(params) as UnknownRecord,
		};
		return output;
	};
	if (normalizedScope === 'master') {
		const effects = replaceEffects(project.master?.effects);
		return effects ? derive({ ...project, master: { ...project.master, effects } }) : null;
	}
	if (normalizedScope === 'track') {
		const index = (project.tracks || []).findIndex((track) => String(track?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(project.tracks?.[index]?.effects);
		if (!effects || !project.tracks) return null;
		const tracks = project.tracks.slice();
		tracks[index] = { ...tracks[index], effects };
		return derive({ ...project, tracks });
	}
	if (normalizedScope === 'clip') {
		const clip = project.clips?.find(clip => clip.id === targetId);
		const effects = replaceEffects(clip?.effects);
		return effects ? derive({ ...project, clips: project.clips?.map(clip => clip.id === targetId ? { ...clip, effects } : clip) }) : null;
	}
	if (normalizedScope === 'group' || normalizedScope === 'send') {
		const key = normalizedScope === 'group' ? 'groups' : 'sends';
		const buses = project.mixer?.[key] || [];
		const index = buses.findIndex((bus) => String(bus?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(buses[index]?.effects);
		if (!effects) return null;
		const nextBuses = buses.slice();
		nextBuses[index] = { ...nextBuses[index], effects };
		return derive({ ...project, mixer: { ...project.mixer, [key]: nextBuses } });
	}
	return null;
}

export function projectRackEffect(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
): EngineEffect | null {
	const normalizedScope = String(scope || '');
	if (normalizedScope === 'master') return activeRackEffects(project?.master).find(effect => effect?.id === effectId) || null;
	const normalizedTargetId = String(targetId);
	for (const rack of projectEffectRacks(project)) {
		if (rack.scope !== normalizedScope) continue;
		if (rack.scope !== 'master' && rack.targetId !== normalizedTargetId) continue;
		return rack.effects.find((effect) => effect?.id === effectId) || null;
	}
	return null;
}

export function cloneMessageValue<Value>(value: Value): Value {
	return typeof globalThis.structuredClone === 'function'
		? globalThis.structuredClone(value)
		: JSON.parse(JSON.stringify(value)) as Value;
}

function trackEffectRack(track: EngineTrack, index: number): EngineEffectRackLocation {
	return {
		scope: 'track',
		targetId: String(track?.id ?? index),
		effectsActive: track?.effectsActive !== false,
		effects: activeRackEffects(track),
	};
}
