/* SPDX-License-Identifier: AGPL-3.0-only */

import { findRepeatedSoundMatches } from './repeated-sound-correlation.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: Readonly<{
		requestId: string; example: Float32Array[]; channels: Float32Array[]; threshold: number;
	}> }>) => void) | null;
	postMessage(value: unknown): void;
};
scope.onmessage = ({ data }): void => {
	void findRepeatedSoundMatches(data.example, data.channels, data.threshold).then(
		result => { scope.postMessage({ type: 'result', requestId: data.requestId, result }); },
		error => { scope.postMessage({ type: 'error', requestId: data.requestId,
			error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } }); },
	);
};
