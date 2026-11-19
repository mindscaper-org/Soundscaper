/* SPDX-License-Identifier: AGPL-3.0-only */

import { analyzeMicrophoneBleedBlock, type MicrophoneBleedBlock } from './microphone-bleed.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: { readonly data: MicrophoneBleedBlock & { readonly requestId: string } }) => void) | null;
	postMessage(value: unknown): void;
};
scope.onmessage = ({ data }): void => {
	try { scope.postMessage({ type: 'result', requestId: data.requestId, result: analyzeMicrophoneBleedBlock(data) }); }
	catch (error) { scope.postMessage({ type: 'error', requestId: data.requestId,
		error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } }); }
};
