/* SPDX-License-Identifier: AGPL-3.0-only */

/** A trusted recorder input-presence failure, distinct from PCM/storage corruption. */
export class RecordingInputLossError extends Error {
	readonly code = 'RECORDING_INPUT_LOST';
	constructor() {
		super('The recording input stopped delivering audio channels and did not recover.');
		this.name = 'RecordingInputLossError';
	}
}

/** Translate worklet lifecycle messages without importing controller coordination. */
export function handleRecordingInputEvent(
	message: unknown,
	onLost: (error: RecordingInputLossError) => void,
	log: (message: string) => void = value => globalThis.console?.warn?.(value),
): boolean {
	if (!message || typeof message !== 'object' || !('type' in message)) return false;
	if (message.type === 'input-lost') {
		try { onLost(new RecordingInputLossError()); }
		catch { /* A failed observer cannot escape the recording message event. */ }
		return true;
	}
	if (message.type !== 'input-status' || !('available' in message) || typeof message.available !== 'boolean') return false;
	try { log(message.available ? 'Recording input delivery recovered; capture continues.' : 'Recording input delivery temporarily unavailable; waiting for recovery.'); }
	catch { /* Diagnostics cannot own capture. */ }
	return true;
}
