/* SPDX-License-Identifier: AGPL-3.0-only */
import { AI_DENOISE_CONNECT, AI_DENOISE_IPC, aiDenoiseRequest } from
	'../src/common/editor/first-party-effects/ai-denoise/contract.ts';

/** PCM ports cross the isolated world; native paths never do. */
export function installAiDenoisePreload(target: Pick<Window, 'addEventListener'>, ipc: {
	postMessage(channel: string, request: unknown, ports: MessagePort[]): void;
}): void {
	target.addEventListener('message', (event: MessageEvent) => {
		if (event.source !== target || event.data?.type !== AI_DENOISE_CONNECT) return;
		const ports = Array.from(event.ports);
		try {
			if (Object.keys(event.data).sort().join(',') !== 'request,type' || ports.length !== 1) throw new TypeError('Invalid denoising port.');
			ipc.postMessage(AI_DENOISE_IPC, aiDenoiseRequest(event.data.request), ports);
		} catch {
			for (const port of ports) {
				try { port.postMessage({ type: 'error', message: 'Invalid AI denoising connection.' }); }
				catch { /* The sender may already have retired its port. */ } finally { port.close(); }
			}
		}
	});
}
