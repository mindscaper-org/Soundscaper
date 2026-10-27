/* SPDX-License-Identifier: AGPL-3.0-only */
import { TRACK_AUTOMATION_COPY_BY_LOCALE } from '../../../i18n/editor-track-automation-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { canonicalCopyValue, effectNameCopyKey } from '../../../i18n/canonical-extras.js';
import type { TrackAutomationTargetV21 } from '../../track-automation-targets-v21.ts';
import { nativeEffectParameterLabel } from '../effect-parameter-labels.ts';
import { formatLocalizedTemplate as fill } from '../localization-template.ts';

type Copy = Readonly<Record<string, string | undefined>>;
export function localizeTrackAutomationTargets(targets: readonly TrackAutomationTargetV21[], copy: Copy): readonly TrackAutomationTargetV21[] {
	const local = resolveEditorCopyScope('trackAutomation', TRACK_AUTOMATION_COPY_BY_LOCALE.en, copy);
	return targets.map(target => localizeTarget(target, copy, local));
}
function localizeTarget(target: TrackAutomationTargetV21, copy: Copy, local: Readonly<Record<keyof typeof TRACK_AUTOMATION_COPY_BY_LOCALE.en, string>>): TrackAutomationTargetV21 {
	const presentation = target.presentation;
	if (!presentation) return target;
	let label = target.label, groupLabel = target.groupLabel;
	if (presentation.group === 'track' && target.address.kind === 'strip') {
		label = target.address.parameterId === 'gain' ? copy['ui.designSystem.volume'] ?? 'Volume' : target.address.parameterId === 'pan' ? copy.pan ?? 'Pan' : copy.mute ?? 'Mute';
		groupLabel = copy.track ?? 'Track';
	} else if (presentation.group === 'routing') {
		const destination = presentation.destinationKind === 'master' ? copy.master ?? 'Master' : presentation.destinationName || local.automationRoute;
		label = fill(presentation.routeKind === 'send' ? local.automationSendTarget : local.automationAssignmentTarget, { destination });
		groupLabel = local.automationGroupRouting;
	} else if (presentation.group === 'effect' && target.address.kind === 'effect') {
		const type = presentation.effectType ?? '';
		const key = effectNameCopyKey(type), translatedGroup = canonicalCopyValue(key, copy as Readonly<Record<string, string>>);
		if (!presentation.authoredGroup && translatedGroup !== key) groupLabel = translatedGroup;
		const parameter = nativeEffectParameterLabel(type, target.address.parameterId, copy as Readonly<Record<string, string>>);
		label = target.address.elementId ? fill(local.automationElementParameter, { element: target.address.elementId, parameter }) : parameter;
	}
	const disabledReason = target.disabledReason === null ? null
		: target.address.kind === 'strip' && target.address.parameterId === 'pan' ? local.automationMultichannelPanUnavailable : local.automationParameterUnavailable;
	return { ...target, label, groupLabel, disabledReason };
}
