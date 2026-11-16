/* SPDX-License-Identifier: AGPL-3.0-only */

import { analyzeDialogueAlignment, type DialogueAlignmentRequest } from './dialogue-alignment.ts';
import { renderAlignedDialogue } from './dialogue-alignment-render.ts';
import { loadStaffPadWasm } from './staffpad/runtime.js';

const scope = globalThis as unknown as {
	onmessage: ((event: { readonly data: DialogueAlignmentRequest & { readonly requestId: string } }) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = ({ data }) => {
	void Promise.resolve().then(async () => {
		const alignment = analyzeDialogueAlignment(data);
		const channels = renderAlignedDialogue(data.replacement, data.sampleRate, alignment, await loadStaffPadWasm());
		scope.postMessage({ type: 'result', requestId: data.requestId, result: { alignment, channels } }, channels.map(channel => channel.buffer));
	}).catch((cause: unknown) => {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		scope.postMessage({ type: 'error', requestId: data.requestId, error: { name: error.name, message: error.message } });
	});
};
