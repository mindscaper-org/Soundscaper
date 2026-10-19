/* SPDX-License-Identifier: AGPL-3.0-only */

import { rename, rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

/** Windows can briefly retain Python DLL locks after the interpreter exits. */
export async function relocateNightlyPython(source: string, destination: string, {
	move = rename,
	delay = (milliseconds: number): Promise<void> => setTimeout(milliseconds),
} = {}): Promise<void> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			await move(source, destination);
			return;
		} catch (error) {
			const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
			if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes(String(code))) throw error;
			await delay(250 * (attempt + 1));
		}
	}
}

/** Remove temporary archives without hiding the provisioning diagnostic. */
export async function withNightlyInterchangeWork<T>(work: string, provision: () => Promise<T>, {
	remove = (path: string, options: { recursive: boolean; force: boolean; maxRetries: number; retryDelay: number }): Promise<void> => rm(path, options),
} = {}): Promise<T> {
	let outcome: { ok: true; value: T } | { ok: false; error: unknown };
	let cleanupFailure: { error: unknown } | null = null;
	try { outcome = { ok: true, value: await provision() }; }
	catch (error) { outcome = { ok: false, error }; }
	try { await remove(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
	catch (error) { cleanupFailure = { error }; }
	if (cleanupFailure) {
		if (!outcome.ok) {
			throw new AggregateError([outcome.error, cleanupFailure.error],
				`Nightly interchange provisioning failed: ${String(outcome.error)}. Cleanup also failed: ${String(cleanupFailure.error)}`,
				{ cause: outcome.error });
		}
		throw cleanupFailure.error;
	}
	if (!outcome.ok) throw outcome.error;
	return outcome.value;
}
