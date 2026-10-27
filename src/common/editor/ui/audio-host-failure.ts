/* SPDX-License-Identifier: AGPL-3.0-only */
export type AudioHostFailureCode = 'unavailable' | 'recording-active' | 'closed' | 'session-close' | 'rate-mismatch'
	| 'startup' | 'inventory' | 'session-open' | 'device-loss' | 'availability' | 'operation';
export class AudioHostError extends Error {
	constructor(readonly code: AudioHostFailureCode, message: string) { super(message); this.name = 'AudioHostError'; }
}
export async function audioHostOperation<Value>(code: AudioHostFailureCode, operation: () => Promise<Value>): Promise<Value> {
	try { return await operation(); } catch (error) {
		throw error instanceof AudioHostError ? error : new AudioHostError(code, error instanceof Error ? error.message : String(error));
	}
}
