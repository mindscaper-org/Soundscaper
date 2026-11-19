/* SPDX-License-Identifier: AGPL-3.0-only */

/** A lightweight refusal raised while a manual file iterable is being read. */
export class TransferManualImportRefusalError extends Error {
	readonly code: 'entry-limit' | 'entry-too-large' | 'invalid-bound' | 'malformed-entry';

	constructor(
		code: TransferManualImportRefusalError['code'],
		message: string,
	) {
		super(message);
		this.name = 'TransferManualImportRefusalError';
		this.code = code;
	}
}

interface ManualTransferReadFailure {
	readonly title: string;
	readonly reason: string;
}

const localReadFailures = new WeakSet<object>();

/** An unreadable browser File occupies its own position in a manual batch. */
export function manualTransferReadFailure(title: string, reason: string): ManualTransferReadFailure {
	const failure = Object.freeze({ title, reason });
	localReadFailures.add(failure);
	return failure;
}

/** Only local file reads can report this outcome. Wire entries still need archive bytes. */
export function isManualTransferReadFailure(value: unknown): value is ManualTransferReadFailure {
	return value !== null && typeof value === 'object' && localReadFailures.has(value);
}
