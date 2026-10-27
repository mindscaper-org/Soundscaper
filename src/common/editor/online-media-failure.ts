/* SPDX-License-Identifier: AGPL-3.0-only */
import { errorDiagnosticMessage } from './error-diagnostic-message.ts';

export type OnlineMediaFailureReason = 'archive-cancelled' | 'archive-invalid' | 'archive-size' | 'archive-request'
	| 'archive-refresh' | 'authentication' | 'connection-expired' | 'search' | 'preview';
export interface OnlineMediaFailure {
	readonly reason: OnlineMediaFailureReason;
	readonly diagnostic: string;
	readonly status?: number;
}
export class OnlineMediaOperationError extends Error {
	constructor(readonly reason: OnlineMediaFailureReason, message: string) { super(message); this.name = 'OnlineMediaOperationError'; }
}
/** Feedback metadata never supplies request, account, archive or media authority. */
export function onlineMediaFailure(reason: OnlineMediaFailureReason, error?: unknown): OnlineMediaFailure {
	const status: unknown = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'status')?.value : undefined;
	return Object.freeze({ reason: error instanceof OnlineMediaOperationError ? error.reason : reason,
		diagnostic: errorDiagnosticMessage(error, ''),
		...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) });
}
