/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createReadCapabilityStream,
	readCapabilityRequestRetiredError,
} from './read-capability-support.js';
import { MAX_READ_CAPABILITIES_PER_OWNER } from './constants.js';

/** Bounded store-wide admission; eligible waiters retain arrival order. */
export function createReadCapabilityRequestQueue() {
	const waiting = new Set();
	let notifying = false;
	const settle = (waiter, failed, value) => {
		if (!waiting.delete(waiter)) return;
		waiter.signal.removeEventListener('abort', waiter.onAbort);
		if (failed) waiter.reject(value);
		else waiter.resolve(value);
	};
	/**
	 * @template Lease
	 * @param {() => Lease | null} acquire
	 * @param {() => boolean} isLive
	 * @param {AbortSignal} signal
	 * @returns {Promise<Lease | null>}
	 */
	async function enqueue(acquire, isLive, signal) {
		signal.throwIfAborted();
		if (!isLive()) return null;
		const lease = acquire();
		if (lease) return lease;
		if (waiting.size >= MAX_READ_CAPABILITIES_PER_OWNER) {
			throw new RangeError('The desktop read request queue is full.');
		}
		return new Promise((resolve, reject) => {
			const waiter = { acquire, isLive, signal, resolve, reject, onAbort: () => {} };
			waiter.onAbort = () => settle(waiter, true, signal.reason);
			waiting.add(waiter);
			signal.addEventListener('abort', waiter.onAbort, { once: true });
			if (signal.aborted) waiter.onAbort();
		});
	}
	return Object.freeze({
		acquire: enqueue,
		notify() {
			if (notifying) return;
			notifying = true;
			try {
				for (const waiter of waiting) {
					try {
						waiter.signal.throwIfAborted();
						if (!waiter.isLive()) { settle(waiter, false, null); continue; }
						const lease = waiter.acquire();
						if (lease) settle(waiter, false, lease);
					} catch (error) { settle(waiter, true, error); }
				}
			} finally { notifying = false; }
		},
	});
}

export function acquireReadCapabilityRequestLease(entry, expectedProfile, { operations, retire, renew, onComplete }) {
	if (!entry || entry.request
		|| (expectedProfile !== undefined && entry.readProfile !== expectedProfile)) return null;
	const rangeRequest = entry.rangeTicket
		? entry.rangeAdmission.acquireRequest(entry.rangeTicket)
		: null;
	if (entry.rangeTicket && !rangeRequest) return null;
	renew();
	try {
		return createReadCapabilityRequestLease(entry, rangeRequest, { operations, retire, onComplete });
	} catch (error) {
		rangeRequest?.release();
		throw error;
	}
}

export function createReadCapabilityRequestLease(entry, rangeRequest, { operations, retire, onComplete = () => {} }) {
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
		onComplete();
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
