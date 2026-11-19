/* SPDX-License-Identifier: AGPL-3.0-only */

import { analyzeMicrophoneBleedBlock, type MicrophoneBleedBlock } from './microphone-bleed.ts';
import { runOneShotWorkerTask } from './one-shot-worker-task.ts';

export async function analyzeMicrophoneBleedInWorker(request: MicrophoneBleedBlock, signal: AbortSignal): Promise<boolean[][]> {
	signal.throwIfAborted();
	if (typeof Worker === 'undefined') return analyzeMicrophoneBleedBlock(request);
	// The renderer may lend cached channel views, so never transfer or detach its buffers.
	return runOneShotWorkerTask({ ...request }, () => new Worker(
		new URL('./microphone-bleed-worker-entry.ts', import.meta.url), { type: 'module', name: 'microphone-bleed' },
	), { signal });
}
