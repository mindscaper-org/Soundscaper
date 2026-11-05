/* SPDX-License-Identifier: AGPL-3.0-only */
import { rm } from 'node:fs/promises';

/** A failed physical cleanup retains its runtime and cannot mask the workload failure. */
export async function withMotionQualificationCleanup<Value>(
	work: () => Promise<Value>, cleanup: () => Promise<unknown>, temporary: string,
): Promise<Value> {
	let outcome: { ok: true; value: Value } | { ok: false; error: unknown };
	try { outcome = { ok: true, value: await work() }; } catch (error) { outcome = { ok: false, error }; }
	let finalization: { ok: true } | { ok: false; error: unknown } = { ok: true };
	try {
		await cleanup();
		await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
	} catch (error) {
		finalization = { ok: false, error };
	}
	if (!finalization.ok) {
		if (!outcome.ok) throw new AggregateError([outcome.error, finalization.error], 'Qualification workload and cleanup failed.', { cause: outcome.error });
		throw finalization.error;
	}
	if (!outcome.ok) throw outcome.error;
	return outcome.value;
}
