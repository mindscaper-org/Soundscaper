/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createDialogueAlignmentComposition } from '../../track-audio/dialogue-alignment-composition.ts';
import { createAudioWarpActionFacade } from '../../track-audio/audio-warp-action-facade.ts';
import { createTakeCompActionFacade } from '../../track-audio/take-comp-action-facade.ts';

export interface ProjectOwnedFeatureActionFacadeDependencies {
	readonly capabilities: Readonly<{ readonly audioWarp?: unknown; readonly takeComp?: unknown }>;
	readonly product: Readonly<{ readonly name: string }>;
	readonly dialogueAlignmentService: ReturnType<typeof createDialogueAlignmentComposition>;
	readonly audioWarpService: Readonly<Record<string, unknown>>;
	readonly takeCompService: Readonly<Record<string, unknown>>;
}

/** Keep project-owned feature facade wiring out of the near-limit root facade. */
export function createProjectOwnedFeatureActionFacades(
	dependencies: ProjectOwnedFeatureActionFacadeDependencies,
) {
	const requireDialogue = (): void => {
		if (!dependencies.capabilities.audioWarp) throw new RangeError(`${dependencies.product.name} does not support dialogue alignment.`);
	};
	type Dialogue = ProjectOwnedFeatureActionFacadeDependencies['dialogueAlignmentService'];
	return Object.freeze({
		dialogueAlignment: Object.freeze({
			prepare: (...args: Parameters<Dialogue['prepare']>) => { requireDialogue(); return dependencies.dialogueAlignmentService.prepare(...args); },
			apply: (...args: Parameters<Dialogue['apply']>) => { requireDialogue(); return dependencies.dialogueAlignmentService.apply(...args); },
			preview: (...args: Parameters<Dialogue['preview']>) => { requireDialogue(); return dependencies.dialogueAlignmentService.preview(...args); },
			stopPreview: () => dependencies.dialogueAlignmentService.stopPreview(),
			discard: () => dependencies.dialogueAlignmentService.discard(),
		}),
		audioWarp: createAudioWarpActionFacade({
			enabled: Boolean(dependencies.capabilities.audioWarp),
			productName: dependencies.product.name,
			service: dependencies.audioWarpService,
		}),
		takeComp: createTakeCompActionFacade({
			enabled: Boolean(dependencies.capabilities.takeComp),
			productName: dependencies.product.name,
			service: dependencies.takeCompService,
		}),
	});
}
