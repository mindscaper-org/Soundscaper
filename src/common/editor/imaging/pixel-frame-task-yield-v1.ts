/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve a real host-task boundary without nested-timer delay where the
 * native scheduler supports continuations. The caller owns cancellation fences.
 * https://wicg.github.io/scheduling-apis/#dom-scheduler-yield */
export async function yieldPixelFrameTaskV1(): Promise<void> {
	const scheduler = (globalThis as { readonly scheduler?: Readonly<{ yield?: () => Promise<void> }> }).scheduler;
	const yieldTask = scheduler?.yield;
	if (typeof yieldTask === 'function') {
		await yieldTask.call(scheduler); return;
	}
	await new Promise<void>(resolve => { setTimeout(resolve, 0); });
}
