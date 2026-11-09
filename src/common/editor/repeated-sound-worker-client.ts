/* SPDX-License-Identifier: AGPL-3.0-only */

import { runOneShotWorkerTask } from './one-shot-worker-task.ts';
import type { RepeatedSoundMatch } from './repeated-sound.ts';

/** Send bounded rendered PCM; keep the reusable example with its owner. */
export async function findRepeatedSoundInWorker(
	example: readonly Float32Array[], channels: readonly Float32Array[], threshold: number, signal: AbortSignal,
): Promise<readonly RepeatedSoundMatch[]> {
	signal.throwIfAborted();
	if (typeof Worker === 'undefined') {
		const { findRepeatedSoundMatches } = await import('./repeated-sound-correlation.ts');
		signal.throwIfAborted();
		return findRepeatedSoundMatches(example, channels, threshold);
	}
	return runOneShotWorkerTask({ example, channels, threshold }, () => new Worker(
		new URL('./repeated-sound-worker-entry.ts', import.meta.url), { type: 'module', name: 'find-repeated-sound' },
	), { signal });
}
