/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionPreviewWorkerResponse } from '../../../motion-preview-worker-protocol.ts';
import { MOTION_PREVIEW_PROGRESS_PERIOD_MS } from '../../../motion-preview-worker-protocol.ts';

const IDLE_MS = 30_000;
const FRAME_MS = 600_000;
const MAXIMUM_PROGRESS_MESSAGES = Math.ceil(FRAME_MS / MOTION_PREVIEW_PROGRESS_PERIOD_MS) + 1;
type Failure = 'stall' | 'absolute' | 'invalid-progress';

/** Progress proves completed work; it can renew inactivity, never the absolute frame budget. */
export function createMotionPreviewWorkerWatchdog(kind: 'project' | 'render', fail: (reason: Failure) => void) {
	let stopped = false; let sequence = 0; let completedWork = 0;
	let idle = setTimeout(() => finish('stall'), IDLE_MS);
	const absolute = kind === 'render' ? setTimeout(() => finish('absolute'), FRAME_MS) : null;
	function stop(): void { if (!stopped) { stopped = true; clearTimeout(idle); if (absolute !== null) clearTimeout(absolute); } }
	function finish(reason: Failure): void { if (!stopped) { stop(); fail(reason); } }
	return {
		stop,
		cancel() { if (absolute !== null) clearTimeout(absolute); },
		progress(message: Extract<MotionPreviewWorkerResponse, { type: 'progress' }>) {
			if (stopped) return;
			if (kind !== 'render' || !Number.isSafeInteger(message.sequence) || message.sequence !== sequence + 1 || message.sequence > MAXIMUM_PROGRESS_MESSAGES
				|| !Number.isSafeInteger(message.completedWork) || message.completedWork <= completedWork) { finish('invalid-progress'); return; }
			sequence = message.sequence; completedWork = message.completedWork;
			clearTimeout(idle); idle = setTimeout(() => finish('stall'), IDLE_MS);
		},
	};
}
