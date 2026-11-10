/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffect, updateEffect } from '../../../effects.js';
import { isStandardEffect } from '../../../first-party-effects/standard/definition.ts';
import { standardEffectStateBytes } from '../../../first-party-effects/standard/selection-contract.ts';
import { autoTuneRealtimeGeometry } from '../../../first-party-effects/auto-tune/realtime-contract.ts';
import { STEREO_LIMITED_RENDER_EFFECT_TYPES } from '../../../adm-render-safety.ts';
import { rackEffectChannelCount, rackEffectsActive, unavailableRackEffectTypes } from '../../../rack-effect-channel-width.ts';
import type { CommandObject } from '../../../commands/protocol.ts';
import type { ControllerRackEffect, RackEffectProject, RackEffectScope } from './rack-effect-service-types.ts';

/** Match the graph's processor geometry before history or autosave can adopt a configuration. */
export function assertStandardRackEffectConfiguration(project: RackEffectProject, scope: RackEffectScope,
	targetId: string | null, effect: ControllerRackEffect, engineSampleRate?: number, unsupportedMessage = 'This effect is not supported.'): void {
	if (effect.enabled !== false && effect.bypassed !== true && STEREO_LIMITED_RENDER_EFFECT_TYPES.includes(effect.type)
		&& rackEffectsActive(project, scope, targetId) && unavailableRackEffectTypes(project, scope, targetId).length) {
		throw new RangeError(unsupportedMessage);
	}
	if (effect.type === 'auto-tune') {
		autoTuneRealtimeGeometry(project.sampleRate ?? engineSampleRate ?? 48000, rackEffectChannelCount(project, scope, targetId));
		return;
	}
	if (!isStandardEffect(effect.type)) return;
	const normalized = normalizeEffect(effect) as ControllerRackEffect;
	const channels = rackEffectChannelCount(project, scope, targetId);
	standardEffectStateBytes(effect.type, normalized.params, project.sampleRate ?? engineSampleRate ?? 48000, channels);
}

/** Type replacement and partial parameters follow the same normalization as the rack command. */
export function assertStandardRackEffectUpdate(project: RackEffectProject, scope: RackEffectScope,
	targetId: string | null, effect: ControllerRackEffect, changes: CommandObject, engineSampleRate?: number, unsupportedMessage?: string): void {
	const type = String(changes.type || effect.type);
	if (type !== 'auto-tune' && !isStandardEffect(type) && !STEREO_LIMITED_RENDER_EFFECT_TYPES.includes(type)) return;
	assertStandardRackEffectConfiguration(project, scope, targetId,
		updateEffect(effect, changes) as ControllerRackEffect, engineSampleRate, unsupportedMessage);
}
