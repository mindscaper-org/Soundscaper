/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { Locator } from '@playwright/test';

async function maximumQueueState(job: Locator) {
	const observed = await job.evaluate(element => ({
		alerts: Array.from(element.querySelectorAll('[role="alert"]'), node => node.textContent ?? ''),
		statuses: Array.from(element.querySelectorAll('[role="status"]'), node => node.textContent ?? ''),
		progress: Array.from(element.querySelectorAll('progress, [role="progressbar"]'))
			.filter(node => node.getAttribute('aria-label') === 'Rendered frames').map(node => node.getAttribute('value')),
		text: element.textContent ?? '',
	}));
	if (observed.alerts.length) throw new Error(observed.alerts.join('\n'));
	assert.equal(observed.statuses.length, 1, 'Maximum queue status ownership is ambiguous.');
	assert.ok(observed.progress.length <= 1, 'Maximum rendered frames ownership is ambiguous.');
	return { status: observed.statuses[0]!, progress: observed.progress, text: observed.text };
}
function maximumQueueProgress(observed: Awaited<ReturnType<typeof maximumQueueState>>, frames: number) {
	const status = observed.status;
	if (status === 'Failed' || status === 'Cancelled') throw new Error(`Maximum index retry ${status}: ${observed.text}`);
	if (status === 'Completed') return frames;
	const raw = observed.progress[0];
	if (observed.progress.length) assert.ok(raw !== null && raw !== undefined && raw.trim() !== '', 'Maximum rendered frames value is missing.');
	const value = observed.progress.length ? Number(raw) : 0;
	assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= frames); return value;
}
export async function motionMaximumQueueProgress(job: Locator, frames: number) {
	return maximumQueueProgress(await maximumQueueState(job), frames);
}
/** The index observer starts on its verified cancelled job before Retry opens a chooser. */
export function motionMaximumRetryProgress(job: Locator, frames: number): () => Promise<number> {
	let cancelledBaseline = true;
	return async () => {
		const observed = await maximumQueueState(job);
		if (observed.status !== 'Cancelled') cancelledBaseline = false;
		if (cancelledBaseline) {
			assert.equal(observed.progress.length, 0, 'Cancelled baseline must have no active progressbar.');
			return 0;
		}
		return maximumQueueProgress(observed, frames);
	};
}
