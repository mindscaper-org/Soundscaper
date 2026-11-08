/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep one cancellable idle deadline across upstream connection, upload and response. */
export async function fetchUpstreamWithDeadline(
	fetchRequest: typeof fetch, url: URL, init: RequestInit, idleTimeoutMs = 30_000,
): Promise<Response> {
	const controller = new AbortController();
	const signal = init.signal;
	const abort = (): void => controller.abort(signal?.reason);
	let timer: ReturnType<typeof setTimeout>;
	const refresh = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => controller.abort(new DOMException('The upstream transfer stopped responding.', 'TimeoutError')), idleTimeoutMs);
	};
	const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cleanup); };
	let requestDone = !(init.body instanceof ReadableStream), responseDone = false;
	let retireRequest: (reason: unknown) => void = () => undefined;
	const complete = (): void => { if (requestDone && responseDone) cleanup(); };
	controller.signal.addEventListener('abort', cleanup, { once: true });
	if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
	refresh();
	const options: RequestInit & { duplex?: 'half' } = { ...init, signal: controller.signal };
	if (init.body instanceof ReadableStream) {
		options.body = deadlineStream(init.body, controller, refresh, () => { requestDone = true; complete(); }, value => { retireRequest = value; });
		options.duplex = 'half';
	}
	try {
		const pending = fetchRequest(url, options);
		void pending.then(response => {
			if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined);
		}, () => undefined);
		const response = await raceAbort(pending, controller.signal);
		refresh();
		if (!response.ok) retireRequest(new Error('The upstream rejected the upload.'));
		if (!response.body) { responseDone = true; complete(); return response; }
		return new Response(deadlineStream(response.body, controller, refresh, () => { responseDone = true; complete(); }), {
			status: response.status, statusText: response.statusText, headers: response.headers,
		});
	} catch (error) { controller.abort(error); cleanup(); throw error; }
}

function deadlineStream(
	stream: ReadableStream<Uint8Array>, owner: AbortController, refresh: () => void, cleanup: () => void,
	registerRetirement?: (retire: (reason: unknown) => void) => void,
): ReadableStream<Uint8Array> {
	const reader = stream.getReader();
	let settled = false;
	let output: ReadableStreamDefaultController<Uint8Array>;
	const finish = (): void => { settled = true; owner.signal.removeEventListener('abort', abort); cleanup(); };
	const cancel = (reason: unknown): void => { void reader.cancel(reason).catch(() => undefined); };
	const retire = (reason: unknown): void => {
		if (settled) return;
		finish(); output.error(reason); cancel(reason);
	};
	const abort = (): void => retire(owner.signal.reason);
	registerRetirement?.(retire);
	return new ReadableStream<Uint8Array>({
		start(value) { output = value; owner.signal.addEventListener('abort', abort, { once: true }); if (owner.signal.aborted) abort(); },
		async pull(value) {
			try {
				const next = await raceAbort(reader.read(), owner.signal);
				if (settled) return;
				if (next.done) { finish(); value.close(); reader.releaseLock(); }
				else { refresh(); value.enqueue(next.value); }
			} catch (error) {
				if (settled) return;
				finish(); value.error(error); cancel(error); owner.abort(error);
			}
		},
		cancel(reason) { if (!settled) { finish(); cancel(reason); } },
	}, { highWaterMark: 0 });
}

function raceAbort<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
	return new Promise((resolve, reject) => {
		const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		void pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
			(error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
		if (signal.aborted) abort();
	});
}
