/* SPDX-License-Identifier: AGPL-3.0-only */

/** Own every accepted encoder pull independently of ZIP cancellation. A ZIP
 * add rejection does not establish that its source's pending File read joined.
 * Close fences pulls, joins the actual next receipt, then captured return. */
export function ownPhotoCatalogArchiveByteStreamCurrentV1(chunks: AsyncIterable<Uint8Array>): Readonly<{
	stream: ReadableStream<Uint8Array>; close(): Promise<void>;
}> {
	const iterate = chunks[Symbol.asyncIterator], iterator = Reflect.apply(iterate, chunks, []) as AsyncIterator<Uint8Array>;
	const next = iterator.next, leave = iterator.return;
	if (typeof next !== 'function' || leave !== undefined && typeof leave !== 'function') throw new TypeError('Photo archive requires a complete encoder iterator.');
	let reading: Promise<IteratorResult<Uint8Array>> | undefined, closing: Promise<void> | undefined, closed = false, done = false;
	const pullFailures: unknown[] = [];
	const close = (): Promise<void> => {
		if (closing) return closing;
		closed = true; const accepted = reading;
		closing = Promise.resolve().then(async () => {
			const failures: unknown[] = [...pullFailures];
			try { await accepted; } catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
			try { if (!done && leave !== undefined) await Reflect.apply(leave, iterator, []); }
			catch (error) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
			done = true;
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Photo archive encoder read and retirement failed.');
		}); return closing;
	};
	const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
		if (closed) return;
		const work = Promise.resolve().then(() => Reflect.apply(next, iterator, []) as Promise<IteratorResult<Uint8Array>>); reading = work;
		try {
			const result = await work;
			if (result.done) done = true;
			if (!closed) { if (result.done) controller.close(); else controller.enqueue(result.value); }
		} catch (error) { pullFailures.push(error); throw error; }
		finally { if (reading === work) reading = undefined; }
	}, cancel: close });
	return Object.freeze({ stream, close });
}
