/* SPDX-License-Identifier: AGPL-3.0-only */

import type { utilityProcess } from 'electron/main';

import { readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import { createTracktionOfflineRender, type TracktionOfflineEffectHost, type TracktionOfflineEffectRender } from './tracktion-offline-effects.ts';
import {
	inspectTracktionReply, tracktionCommandTimeout, TracktionRejectedCommand, type TracktionCommand, type TracktionReply,
} from './tracktion-peer-contract.ts';
import type { TracktionLaunch } from './tracktion-peer.ts';

const READY_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 4_000;

/** Main supplies an authenticated executable and already granted storage roots. */
export async function startTracktionUtilitySession(
	fork: typeof utilityProcess.fork,
	entry: string,
	options: TracktionLaunch,
	effects?: TracktionOfflineEffectHost,
) {
	const child = fork(entry, [
		options.mode, options.executable, options.projectDirectory,
		options.stateDirectory, options.exchangeDirectory, String(options.mode === 'create' ? options.sampleRate : 0),
	], { serviceName: 'soundscaper-tracktion' });

	let sequence = 0;
	let exited = false;
	let closed = false;
	let pending: { resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
	let effectRender: TracktionOfflineEffectRender | undefined;
	let effectInFlight = false;
	let closing: Promise<void> | undefined;
	const exit = deferred<void>();

	function fail(error: Error): void {
		closed = true;
		pending?.reject(error);
		pending = undefined;
		if (!exited) child.kill();
	}

	child.on('error', () => { fail(new Error('The Tracktion utility process failed.')); });
	child.once('exit', (code) => {
		exited = true;
		closed = true;
		pending?.reject(new Error(`The Tracktion utility exited with code ${String(code)}.`));
		pending = undefined;
		exit.resolve();
	});

	child.on('message', (value: unknown) => {
		if (closed) return;
		try {
			if (!pending) throw new TypeError('The Tracktion utility sent an unsolicited message.');
			const ready = sequence === 0;
			const envelope = readClosedDomainRecord(value, 'Tracktion utility response',
				['kind', 'sequence', 'reply', 'request'], ['kind']);
			if (envelope.kind === 'effect') {
				readClosedDomainRecord(value, 'Tracktion utility effect request', ['kind', 'sequence', 'request']);
				if (!effectRender || effectInFlight || envelope.sequence !== sequence) {
					throw new TypeError('The Tracktion utility sent an unexpected effect request.');
				}
				effectInFlight = true;
				const renderPending = pending;
				const renderSequence = sequence;
				void effectRender.respond(envelope.request).then((reply) => {
					effectInFlight = false;
					if (!closed && pending === renderPending) child.postMessage({ kind: 'effectReply', sequence: renderSequence, reply });
				}).catch((error: unknown) => { fail(error instanceof Error ? error : new Error('Invalid Tracktion effect request.')); });
				return;
			}
			if (effectInFlight) throw new TypeError('The Tracktion utility finished before its effect request.');
			readClosedDomainRecord(value, 'Tracktion utility reply', ready ? ['kind'] : ['kind', 'sequence', 'reply']);
			if (ready ? envelope.kind !== 'ready' : envelope.kind !== 'reply' || envelope.sequence !== sequence) {
				throw new TypeError('The Tracktion utility replied out of sequence.');
			}
			const current = pending;
			pending = undefined;
			current.resolve(envelope.reply);
		} catch (error) {
			fail(error instanceof Error ? error : new Error('Invalid Tracktion utility reply.'));
		}
	});

	async function waitForReply(milliseconds: number, send?: () => void): Promise<unknown> {
		const slot = deferred<unknown>();
		pending = slot;
		const timer = setTimeout(() => { fail(new Error('The Tracktion utility timed out.')); }, milliseconds);
		timer.unref();
		try {
			send?.();
			return await slot.promise;
		} catch (error) {
			// A synchronous postMessage failure leaves the slot otherwise unsettled.
			if (pending === slot) pending = undefined;
			fail(error instanceof Error ? error : new Error('The Tracktion utility failed.'));
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	await waitForReply(READY_TIMEOUT_MS);

	let busy = false;
	async function request<Command extends TracktionCommand>(command: Command): Promise<TracktionReply<Command>> {
		if (closed) throw new Error('The Tracktion utility is closed.');
		if (busy) throw new Error('The Tracktion utility already has a command in flight.');
		busy = true;
		sequence += 1;
		try {
			effectRender = command.kind === 'render' ? createTracktionOfflineRender(effects) : undefined;
			const reply = await waitForReply(tracktionCommandTimeout(command) + 1_000, () => {
				child.postMessage({ kind: 'request', sequence, command });
			});
			return inspectTracktionReply(reply, command);
		} catch (error) {
			if (!(error instanceof TracktionRejectedCommand)) {
				fail(error instanceof Error ? error : new Error('Invalid Tracktion command result.'));
			}
			throw error;
		} finally {
			try { await effectRender?.dispose(); }
			finally {
				effectRender = undefined;
				busy = false;
			}
		}
	}

	function close(): Promise<void> {
		if (closing) return closing;
		if (exited) return exit.promise;
		if (pending) fail(new Error('The Tracktion utility closed during a command.'));
		if (!closed) {
			closed = true;
			try { child.postMessage({ kind: 'close' }); }
			catch { fail(new Error('The Tracktion utility could not be closed cleanly.')); }
		}
		const timer = setTimeout(() => { if (!exited) child.kill(); }, CLOSE_TIMEOUT_MS);
		timer.unref();
		closing = exit.promise.finally(() => { clearTimeout(timer); });
		return closing;
	}

	return Object.freeze({ request, close });
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}
