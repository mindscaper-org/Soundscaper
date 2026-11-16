/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditingAuthorityProject, EditingAuthoritySelection } from '../commands/editing-selection-authority.ts';
import { createEffectMenuEntries } from './effect-menu-organization.js';
import { repairSelectionAvailable } from './repair-menu-admission.ts';

interface MenuProject extends EditingAuthorityProject {
	readonly selection?: (EditingAuthoritySelection & { readonly frequencyRange?: unknown }) | null;
}
interface Input {
	readonly project?: MenuProject | null;
	readonly snapshot: { readonly effects?: {
		readonly selectionTypes?: readonly { readonly type: string; readonly label: string }[];
		readonly sourceSelectionFrames?: number | null;
	} };
	readonly preferences?: { readonly effects?: { readonly menuOrganization?: string } };
	readonly effectTargeting: { readonly effectAudioTrack: unknown;
		readonly explicitEffectSelectionActive: boolean; readonly effectPreferenceTargetsAll: boolean };
	readonly selectedClipId: string | null;
	readonly copy: Record<string, string>;
	readonly productId: string;
	readonly locale?: string;
	readonly editBlocked: boolean;
	readonly typeBlocked?: (type: string) => boolean;
	readonly openSelectionEffect: (type: string) => unknown;
}

/** Compose ordinary selection processors and the explicitly selected joint microphone operation. */
export function createSelectionEffectMenuGroups(input: Input) {
	const { project, snapshot, effectTargeting } = input;
	const effectLabels = new Map((snapshot.effects?.selectionTypes ?? []).map(({ type, label }) => [type, label]));
	if (input.productId === 'soundscaper') effectLabels.set('automatic-microphone-bleed-reduction', input.copy.microphoneBleedTitle!);
	const selection = project?.selection;
	const microphones = project?.tracks.filter(track => track.type === 'audio' && selection?.trackIds?.includes(track.id)).length ?? 0;
	const effectGroups = createEffectMenuEntries({
		organization: input.preferences?.effects?.menuOrganization,
		copy: input.copy, effectLabels, productId: input.productId, locale: input.locale,
		typeBlocked: input.typeBlocked,
		disabled: input.editBlocked || !effectTargeting.effectAudioTrack,
		selectionActive: effectTargeting.explicitEffectSelectionActive,
		allAudioTarget: effectTargeting.effectPreferenceTargetsAll,
		repairAvailable: repairSelectionAvailable(project, input.selectedClipId, snapshot.effects?.sourceSelectionFrames),
		microphoneBleedAvailable: Boolean(selection && !selection.frequencyRange
			&& typeof selection.startFrame === 'number' && typeof selection.endFrame === 'number'
			&& selection.endFrame > selection.startFrame && microphones >= 2 && microphones <= 8),
	}, input.openSelectionEffect);
	return { effectLabels, effectGroups };
}
