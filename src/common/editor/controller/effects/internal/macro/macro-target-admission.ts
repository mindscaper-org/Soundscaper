/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../../../../effects.js';
import { normalizeEffectMacroStep } from '../../../../effect-macro-steps.ts';
import { isMacroCommandStep } from '../../../../macro-command-steps.ts';
import { sequenceTrackMembers } from '../../../../sequence-track-members.ts';
import { selectionEffectChangesLength } from '../selection-effect-length.ts';
import type { EffectMacroRequestEffect } from './effect-macro-service.ts';

/** Time insertion affects selected silent lanes just as it does in ordinary Apply. */
export function macroNeedsSilentTargets(effects: readonly EffectMacroRequestEffect[]): boolean {
	return effects.some(effect => {
		if (isMacroCommandStep(effect)) return false;
		const normalized = normalizeEffectMacroStep(effect);
		return selectionEffectChangesLength(normalized.type, normalized.params, AUDIO_SELECTION_EFFECT_DEFINITIONS[normalized.type]);
	});
}

type MacroEffect = EffectMacroRequestEffect;
interface NativeControlProject {
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly selection?: Readonly<{ trackIds?: readonly string[] }> | null;
}
interface MacroTargetOwner { readonly track: Readonly<{ id: string }>; readonly sourceTrackId?: string; readonly sourceId?: string; }
interface NativeControlBinding {
	readonly effects: readonly MacroEffect[];
	readonly refusal: 'selection' | 'control' | null;
}

/** Audacity3.7.7 AutoDuckBase::Init visits all tracks, including selected empty/label tracks. */
export function bindNativeAutoDuckControls(
	effects: readonly MacroEffect[], project: NativeControlProject,
	targets: readonly MacroTargetOwner[], explicitTarget: boolean,
): NativeControlBinding {
	if (!effects.some(effect => nativeAutoDuckContext(effect))) return { effects, refusal: null };
	const owners = targets.map(target => target.sourceTrackId ?? target.track.id);
	const selected = new Set(explicitTarget || targets.some(target => target.sourceId || target.sourceTrackId)
		? owners : project.selection?.trackIds?.length ? project.selection.trackIds : owners);
	const members = sequenceTrackMembers(project, owners[0]);
	if (members && [...selected].some(id => !members.has(id))) return { effects, refusal: 'selection' };
	const byId = new Map(project.tracks.map(track => [track.id, track]));
	const tracks = members ? [...members].flatMap(id => {
		const track = byId.get(id);
		return track ? [track] : [];
	}) : project.tracks;
	let lastWasSelectedAudio = false;
	let controlTrackId: string | null = null;
	for (const track of tracks) {
		const isSelected = typeof track.id === 'string' && selected.has(track.id);
		if (lastWasSelectedAudio && !isSelected) controlTrackId = track.type === 'audio' && typeof track.id === 'string' ? track.id : null;
		lastWasSelectedAudio = false;
		if (isSelected) {
			if (track.type !== 'audio') return { effects, refusal: 'selection' };
			lastWasSelectedAudio = true; controlTrackId = null;
		}
	}
	if (!controlTrackId) return { effects, refusal: 'control' };
	return { effects: effects.map(effect => {
		const context = nativeAutoDuckContext(effect);
		return context ? { ...effect, context: { ...context, controlTrackId } } : effect;
	}), refusal: null };
}

function nativeAutoDuckContext(effect: MacroEffect): Readonly<Record<string, unknown>> | null {
	const context = effect.context;
	return effect.type === 'audacity-auto-duck' && isRecord(context)
		&& context.audacityControlTrackPolicy === 'below-last-selected-audio'
		&& (context.controlTrackId == null || context.controlTrackId === '') ? context : null;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
