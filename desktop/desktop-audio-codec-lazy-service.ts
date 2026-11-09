/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortablePromise } from '../src/common/foundation/abort-race.ts';
import type { DesktopAudioCodecMainIpcService } from './desktop-audio-codec-main-ipc.ts';

/** Register trusted IPC immediately; authenticate and probe codecs on the first admitted request. */
export function createLazyDesktopAudioCodecService(create: () => Promise<DesktopAudioCodecMainIpcService>): Readonly<{
	readonly service: DesktopAudioCodecMainIpcService;
	dispose(): Promise<void>;
}> {
	const stopped = new AbortController();
	let loading: Promise<DesktopAudioCodecMainIpcService> | null = null;
	let disposal: Promise<void> | null = null;
	function prepare(signal?: AbortSignal): Promise<DesktopAudioCodecMainIpcService> {
		stopped.signal.throwIfAborted();
		signal?.throwIfAborted();
		loading ??= Promise.resolve().then(create).catch((error: unknown) => {
			loading = null;
			throw error;
		});
		return raceAbortablePromise(loading,
			signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal);
	}
	const service: DesktopAudioCodecMainIpcService = Object.freeze({
		async capabilities(query: Parameters<DesktopAudioCodecMainIpcService['capabilities']>[0]) {
			const ready = await prepare();
			stopped.signal.throwIfAborted();
			return ready.capabilities(query);
		},
		async execute(request: Parameters<DesktopAudioCodecMainIpcService['execute']>[0],
			options: Parameters<DesktopAudioCodecMainIpcService['execute']>[1]) {
			const ready = await prepare(options.signal);
			stopped.signal.throwIfAborted();
			options.signal.throwIfAborted();
			return ready.execute(request, options);
		},
	});
	return Object.freeze({
		service,
		dispose(): Promise<void> {
			if (disposal) return disposal;
			stopped.abort(new Error('The desktop audio codec service stopped.'));
			// Shared canaries own their helpers until they finish. A canceled owner
			// need not wait for them; application shutdown must drain them.
			disposal = loading?.then(() => undefined, () => undefined) ?? Promise.resolve();
			return disposal;
		},
	});
}
