/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { createBrowserAudioCodecRuntime } from '../../src/common/editor/browser-audio-codec-runtime.ts';
import { decodeDedicatedAudioFile, encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import type { createAudioEditorController } from './audio-editor-controller-harness.js';
import { registerMockModuleUrls } from './mock-module-urls.ts';

/** Supply only the local payload transport; production parsers and WASM still perform decoding. */
export function useLocalAudioCodecPayloads(context: Pick<TestContext, 'after'>, options: { wavpackWorkerTransport?: boolean } = {}): void {
	const original = globalThis.fetch;
	globalThis.fetch = async (resource, options) => resource instanceof URL && resource.protocol === 'file:' && resource.pathname.endsWith('.wasm')
		? new Response(Uint8Array.from(await readFile(resource))) : original(resource, options);
	context.after(() => { globalThis.fetch = original; });
	if (options.wavpackWorkerTransport) {
		const hooks = registerMockModuleUrls({ './browser-streamed-wavpack-decoder.ts': new URL('./reviewed-wavpack-group-decoder.ts', import.meta.url).href });
		context.after(() => { hooks.deregister(); });
	}
}

/** The shipping runtime, with its worker transport replaced by direct calls to the same real codecs. */
export function createReviewedAudioCodecRuntime() {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	return createBrowserAudioCodecRuntime({ codecClient: {
		async encode(request, options) {
			options?.signal?.throwIfAborted();
			const result = await encodeDedicatedAudioPcm(request, { loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
			options?.signal?.throwIfAborted();
			return result;
		},
		async decode(request, options) {
			options?.signal?.throwIfAborted();
			const result = await decodeDedicatedAudioFile(request, { loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
			options?.signal?.throwIfAborted();
			return result;
		},
		dispose() {},
	} }) as unknown as NonNullable<Options['ffmpeg']>;
}
