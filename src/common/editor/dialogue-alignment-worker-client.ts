/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DialogueAlignment, DialogueAlignmentRequest } from './dialogue-alignment.ts';
import { runOneShotWorkerTask } from './one-shot-worker-task.ts';

export interface RenderedDialogueAlignment { readonly alignment: DialogueAlignment; readonly channels: Float32Array[] }
export function alignDialogueInWorker(request: DialogueAlignmentRequest, signal: AbortSignal): Promise<RenderedDialogueAlignment> {
	// Cached render inputs are lent to this operation; transferring them would detach editor audio.
	return runOneShotWorkerTask({ ...request }, () => new Worker(
		new URL('./dialogue-alignment-worker-entry.ts', import.meta.url), { type: 'module', name: 'dialogue-alignment' },
	), { signal });
}
