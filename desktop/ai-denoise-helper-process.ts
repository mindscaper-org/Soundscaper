/* SPDX-License-Identifier: AGPL-3.0-only */
import { verifyAssistanceNativeRuntimePayload } from './assistance-native-runtime-payload.mjs';
import { authenticateAiDenoiseModel } from './ai-denoise-model.ts';
import { createAiDenoiseKernelForProvider } from './ai-denoise-kernel.ts';
import { aiDenoiseRequest } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';
import { isSherpaNativeExecutionErrorV1, type SherpaExecutionProvider } from './assistance-sherpa-acceleration.ts';

interface Port {
	on(event: 'message', callback: (event: { data: unknown }) => void): unknown;
	on(event: 'close', callback: () => void): unknown;
	postMessage(value: unknown): void;
	start(): void;
	close(): void;
}
interface Grant { readonly manifest: unknown; readonly targetId: string; readonly runtimeRoot: string; readonly modelPath: string; }
interface Parent {
	on(event: 'message', callback: (event: { data: { type: string; request: unknown; grant: Grant; provider: SherpaExecutionProvider }; ports: Port[] }) => void): unknown;
	postMessage(value: unknown): void;
}
const parent = (process as unknown as { parentPort?: Parent }).parentPort;
let preparing = false, closed = false, peer: Port | undefined;
let kernel: ReturnType<typeof createAiDenoiseKernelForProvider> | undefined;
let lastInput = Date.now();
let heartbeat: ReturnType<typeof setInterval> | undefined;

function close(): void {
	if (closed) return;
	closed = true;
	if (heartbeat) clearInterval(heartbeat);
	kernel?.dispose(); peer?.close();
	// Main terminates this process, including provider-owned native resources.
	parent?.postMessage('closed');
}
function fail(error: unknown): void {
	const message = error instanceof Error ? error.cause instanceof Error ? error.cause.message : error.message : 'AI denoising failed.';
	parent?.postMessage({ type: 'error', message,
		recoverable: !peer && isSherpaNativeExecutionErrorV1(error) });
	if (peer) {
		try { peer.postMessage({ type: 'error', message: 'AI denoising stopped: the device or processing deadline is unavailable. Use Enhance Dialogue for offline processing.' }); }
		finally { close(); }
	} else if (heartbeat) clearInterval(heartbeat);
}
parent?.on('message', event => {
	if (closed) return;
	if (event.data?.type === 'prepare' && !preparing) {
		preparing = true;
		heartbeat = setInterval(() => {
			parent.postMessage('heartbeat');
			if (peer && Date.now() - lastInput > 5000) fail(new Error('The denoising PCM port is idle.'));
		}, 250);
		void prepare(event.data).catch(fail);
	} else if (event.data?.type === 'attach' && kernel && !peer && event.ports.length === 1) {
		peer = event.ports[0]!;
		lastInput = Date.now();
		peer.on('close', close);
		peer.on('message', ({ data }) => {
			if (closed) return;
			if ((data as { type?: unknown } | null)?.type === 'close') { close(); return; }
			try {
				lastInput = Date.now();
				// Electron utility ports clone PCM; their transfer list accepts ports only.
				peer!.postMessage(kernel!.process(data));
			} catch (error) { fail(error); }
		});
		peer.start(); peer.postMessage({ type: 'ready', metrics: kernel.metrics });
	} else fail(new TypeError('Invalid denoising helper initialization.'));
});

async function prepare(message: { request: unknown; grant: Grant; provider: SherpaExecutionProvider }): Promise<void> {
	const request = aiDenoiseRequest(message.request), grant = message.grant;
	await authenticateAiDenoiseModel(grant.modelPath);
	const verified = await verifyAssistanceNativeRuntimePayload({ manifest: grant.manifest, targetId: grant.targetId, outputRoot: grant.runtimeRoot });
	if (verified.status !== 'built' || !verified.moduleSpecifier) throw new Error('The authenticated speech runtime is unavailable.');
	const providers = (verified.executionProviders ?? ['cpu']) as readonly string[];
	if (!providers.includes(message.provider)) throw new TypeError('The selected denoising provider is unauthenticated.');
	const runtime = await import(verified.moduleSpecifier);
	kernel = createAiDenoiseKernelForProvider(runtime, grant.modelPath, request.channelCount, message.provider);
	parent?.postMessage({ type: 'ready' });
}
