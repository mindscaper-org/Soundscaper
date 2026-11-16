/* SPDX-License-Identifier: AGPL-3.0-only */

interface DesktopDatabaseContentionOptions {
	readonly waitMs: number;
	readonly pollIntervalMs?: number;
	readonly isWriterLeaseBusy?: (error: unknown) => error is Error;
}

/** Bound SQLite lock retries and preserve an observed live-writer refusal. */
export async function retryDesktopDatabaseContention<Result>(
	operation: () => Result,
	options: DesktopDatabaseContentionOptions,
): Promise<Result> {
	const waitMs = boundedMilliseconds(options.waitMs, 'database wait');
	const pollIntervalMs = Math.max(10, Math.min(
		boundedMilliseconds(options.pollIntervalMs ?? 100, 'database poll interval'), 1_000,
	));
	const deadline = Date.now() + waitMs;
	let leaseBusyError: Error | null = null;
	for (;;) {
		try { return operation(); }
		catch (error) {
			if (options.isWriterLeaseBusy?.(error)) leaseBusyError ??= error;
			else if (!isSqliteContention(error)) throw error;
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw leaseBusyError ?? error;
			await new Promise<void>(resolve => { setTimeout(resolve, Math.min(pollIntervalMs, remaining)); });
		}
	}
}

function isSqliteContention(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const { errcode } = error as { readonly errcode?: unknown };
	// Extended SQLite result codes retain BUSY (5) or LOCKED (6) in their low byte.
	return typeof errcode === 'number' && Number.isSafeInteger(errcode) && errcode >= 0
		&& [5, 6].includes(errcode & 0xff);
}

function boundedMilliseconds(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > 600_000) {
		throw new RangeError(`${name} must be an integer from 0 through 600000 milliseconds`);
	}
	return value;
}
