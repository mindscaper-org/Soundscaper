/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createReadCapabilityStream,
	readCapabilityRequestRetiredError,
} from './read-capability-support.js';

/**
 * Wait for an existing request to settle, then revalidate and compete for its slot.
 * @template Lease
 * @param {() => Lease | null} acquire
 * @param {() => boolean} isLive
 * @param {ReadonlySet<Promise<unknown>>} operations
 * @param {AbortSignal} signal
 * @returns {Promise<Lease | null>}
 */
export async function acquireQueuedReadCapabilityRequest(acquire, isLive, operations, signal) {
	signal.throwIfAborted();
	let onAbort = () => {};
	const aborted = new Promise((_, reject) => {
		onAbort = () => { reject(signal.reason); };
	});
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		while (isLive()) {
			signal.throwIfAborted();
			const lease = acquire();
			if (lease) return lease;
			// The store tracks leases through body completion and cancellation.
			// Queued callers hold neither a handle lease nor a concurrency slot.
			if (!operations.size) return null;
			await Promise.race([...operations, aborted]);
		}
		return null;
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

export function acquireReadCapabilityRequestLease(entry, expectedProfile, { operations, retire, renew }) {
	if (!entry || entry.request
		|| (expectedProfile !== undefined && entry.readProfile !== expectedProfile)) return null;
	const rangeRequest = entry.rangeTicket
		? entry.rangeAdmission.acquireRequest(entry.rangeTicket)
		: null;
	if (entry.rangeTicket && !rangeRequest) return null;
	renew();
	try {
		return createReadCapabilityRequestLease(entry, rangeRequest, { operations, retire });
	} catch (error) {
		rangeRequest?.release();
		throw error;
	}
}

export function createReadCapabilityRequestLease(entry, rangeRequest, { operations, retire }) {
	const requestBarrier = Promise.withResolvers();
	let completePromise = null;
	let forceClosePromise = null;
	let settled = false;
	let stream = null;
	let streamBarrier = null;
	let streamSettled = false;
	const observeError = () => {
		// Native FileHandle streams emit close after an error; keep the handle leased until then.
		if (!settled) stream.once('error', observeError);
	};
	const settleStream = () => {
		if (streamSettled) return;
		streamSettled = true;
		stream.removeListener?.('end', settleStream);
		stream.removeListener?.('error', observeError);
		stream.removeListener?.('close', settleStream);
		streamBarrier?.resolve();
	};
	const finishRequest = () => {
		if (settled) return;
		settled = true;
		if (entry.request === request) entry.request = null;
		rangeRequest?.release();
		requestBarrier.resolve();
	};
	const createReadStream = (options) => {
		if (settled) throw new Error('Desktop read request lease is closed');
		if (stream) throw new Error('Desktop read request lease already has a stream');
		let candidate;
		try {
			candidate = createReadCapabilityStream(entry, options);
		} catch (error) {
			finishRequest();
			throw error;
		}
		if (!candidate || typeof candidate.once !== 'function'
			|| typeof candidate.removeListener !== 'function'
			|| typeof candidate.destroy !== 'function') {
			finishRequest();
			throw new TypeError('Desktop read capability returned an invalid stream');
		}
		stream = candidate;
		streamBarrier = Promise.withResolvers();
		stream.once('end', settleStream);
		stream.once('error', observeError);
		stream.once('close', settleStream);
		if (stream.readableEnded === true || stream.closed === true) settleStream();
		return stream;
	};
	const complete = () => {
		if (completePromise) return completePromise;
		if (stream && !streamSettled) {
			return Promise.reject(new Error('Desktop read request cannot complete before its stream settles'));
		}
		completePromise = (async () => {
			finishRequest();
			await requestBarrier.promise;
		})();
		return completePromise;
	};
	const forceClose = () => {
		if (forceClosePromise) return forceClosePromise;
		forceClosePromise = (async () => {
			if (stream && !streamSettled) {
				if (!stream.destroyed) {
					try {
						stream.destroy(readCapabilityRequestRetiredError());
					} catch (error) {
						settleStream();
						finishRequest();
						throw error;
					}
				}
				await streamBarrier.promise;
			}
			finishRequest();
			await requestBarrier.promise;
		})();
		return forceClosePromise;
	};
	const request = { close: forceClose, completion: requestBarrier.promise };
	entry.request = request;
	operations.add(request.completion);
	entry.state.operations.add(request.completion);
	void request.completion.then(() => {
		operations.delete(request.completion);
		entry.state.operations.delete(request.completion);
	});
	return Object.freeze({
		id: entry.id,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		readProfile: entry.readProfile,
		lastModified: entry.lastModified,
		createReadStream,
		close: complete,
		cancel: forceClose,
		retire,
	});
}
