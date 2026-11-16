/* SPDX-License-Identifier: AGPL-3.0-only */

import { dialogueAlignmentTargets, type DialogueTargetProject } from '../dialogue-alignment-targets.ts';

/** Included exclusively in Edit > Audio clips, never the timeline's clip context menu. */
export function dialogueAlignmentMenuItem(input: { readonly productId: string; readonly project: DialogueTargetProject | null;
	readonly editBlocked: boolean; readonly copy: Readonly<Record<string, string>>; open(): unknown }) {
	return input.productId === 'soundscaper' ? [{ id: 'align-dialogue', label: input.copy.dialogueAlignmentTitle,
		preserveLabel: true, disabled: input.editBlocked || dialogueAlignmentTargets(input.project).length < 2, onClick: input.open }] : [];
}
