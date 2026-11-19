/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from '../shared/deferred-module-facade.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import type { AudioEditorControllerEditState } from '../../edit-blocking.ts';
import type { TranscriptEditingWord, TranscriptGenerationTarget } from '../../transcript-editing.ts';

export interface TranscriptEditingDocument {
	readonly projectId: string;
	readonly revision: number;
	readonly words: readonly TranscriptEditingWord[];
	readonly targets: readonly TranscriptGenerationTarget[];
}

export interface TranscriptEditingDependencies {
	readonly state: AudioEditorControllerEditState & { readonly missingSourceIds?: ReadonlySet<string> };
	readonly store: { loadMediaAsset(key: string): PromiseLike<unknown> | unknown };
	getProject(): unknown;
	commit(command: AudioEditorCommand): unknown;
}

export function createDeferredTranscriptEditingActions(dependencies: TranscriptEditingDependencies) {
	return createDeferredModuleFacade(async () => {
		const { createTranscriptEditingActions } = await import('./internal/transcript-editing-actions.ts');
		return createTranscriptEditingActions(dependencies);
	}, ['read', 'remove']);
}
