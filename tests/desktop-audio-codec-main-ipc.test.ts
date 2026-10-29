/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	registerDesktopAudioCodecMainIpc,
	type DesktopAudioCodecMainIpcOptions,
	type DesktopAudioCodecMainIpcService,
} from '../desktop/desktop-audio-codec-main-ipc.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

const CHANNELS = Object.freeze({
	desktopAudioCodecExecute: 'soundscaper:v1:codecs:audio:execute',
	desktopAudioCodecCancel: 'soundscaper:v1:codecs:audio:cancel',
	desktopAudioCodecCapabilities: 'soundscaper:v1:codecs:audio:capabilities',
});

test('capability query is owned, closed, and result-sanitized', async () => {
	const fixture = registrationFixture();
	const query = capabilityQuery();
	const result = await fixture.invoke(CHANNELS.desktopAudioCodecCapabilities, fixture.event, query);
	assert.equal(fixture.capabilityQueries.length, 1);
	assert.notEqual(fixture.capabilityQueries[0], query);
	assert.deepEqual(result, capabilityResult(query));
	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecCapabilities, fixture.event, { ...query, executablePath: '/tmp/ffmpeg' }),
		/inexact shape/u,
	);
	const malicious = registrationFixture({
		capabilities: async (request) => ({
			...capabilityResult(request), executablePath: '/tmp/ffmpeg',
		}),
	});
	await assert.rejects(
		malicious.invoke(CHANNELS.desktopAudioCodecCapabilities, malicious.event, query),
		/inexact shape/u,
	);
	await Promise.all([fixture.registration.dispose(), malicious.registration.dispose()]);
});

test('execute requires a closed request ID and passes owned bytes to the main service', async () => {
	const fixture = registrationFixture();
	const input = new Uint8Array(8);
	const result = await fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(input));
	assert.deepEqual(result, { status: 'executed' });
	assert.equal(fixture.executions.length, 1);
	assert.notEqual(fixture.executions[0]?.request.input, input);
	input[0] = 255;
	assert.equal(fixture.executions[0]?.request.input[0], 0);
	assert.equal(fixture.executions[0]?.signal.aborted, false);

	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, {
			...encodeRequest(new Uint8Array(8)), argv: ['-version'],
		}), /inexact shape/u,
	);
	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, {
			...encodeRequest(new Uint8Array(8)), requestId: undefined,
		}), /request ID/u,
	);
	await fixture.registration.dispose();
});

test('only the owning renderer can cancel its active request', async () => {
	const pending = deferred<unknown>();
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
			void pending.promise.then(resolve);
		}),
	});
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, { owner: {} }, 'audio-request-1'), false);
	assert.equal(fixture.executions[0]?.signal.aborted, false);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'audio-request-1'), true);
	assert.deepEqual(await running, { status: 'cancelled' });
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'audio-request-1'), false);
	await fixture.registration.dispose();
});

test('owner revocation aborts and drains every owned operation', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'revoked' }), { once: true });
		}),
	});
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	assert.equal(await fixture.registration.revokeOwner(fixture.owner), true);
	assert.deepEqual(await running, { status: 'revoked' });
	assert.equal(await fixture.registration.revokeOwner(fixture.owner), false);
	await fixture.registration.dispose();
});

test('execute queues work behind per-owner and global operation slots', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
		}),
	}, {
		maximumActiveOperationsPerOwner: 1,
		maximumActiveOperations: 2,
		maximumActiveInputBytes: 64,
	});
	const first = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'owner-one'),
	);
	await until(() => fixture.executions.length === 1);
	const ownerQueued = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'owner-one-second'),
	);
	const ownerCancelled = assert.rejects(ownerQueued, { name: 'AbortError' });
	assert.equal(await remainsPending(ownerQueued), true);
	assert.equal(fixture.executions.length, 1);
	const secondOwner = {};
	const second = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, { owner: secondOwner },
		encodeRequest(new Uint8Array(8), 'owner-two'),
	);
	await until(() => fixture.executions.length === 2);
	const thirdEvent = { owner: {} };
	const globalQueued = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, thirdEvent,
		encodeRequest(new Uint8Array(8), 'owner-three'),
	);
	assert.equal(await remainsPending(globalQueued), true);
	assert.equal(fixture.executions.length, 2);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'owner-one-second'), true);
	await ownerCancelled;
	await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'owner-one');
	await first;
	await until(() => fixture.executions.length === 3);
	assert.equal(fixture.executions[2]?.request.requestId, 'owner-three');
	await fixture.registration.dispose();
	await Promise.all([second, globalQueued]);
});

test('queued codec inputs share the byte budget and owner revocation cancels them before execution', async () => {
	const fixture = registrationFixture({ execute: (_request, { signal }) => new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve({ status: 'revoked' }), { once: true });
	}) }, { maximumActiveOperationsPerOwner: 1, maximumActiveOperations: 1, maximumActiveInputBytes: 16 });
	const first = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8), 'running'));
	await until(() => fixture.executions.length === 1);
	const second = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8), 'waiting'));
	const cancelled = assert.rejects(second, { name: 'AbortError' });
	assert.equal(await remainsPending(second), true);
	await assert.rejects(fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'excess-bytes')), /aggregate.*byte.*limit/iu);
	await assert.rejects(fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'waiting')), /already active/iu);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, { owner: {} }, 'waiting'), false);
	await fixture.registration.revokeOwner(fixture.owner);
	await cancelled;
	await first;
	assert.equal(fixture.executions.length, 1);
	await fixture.registration.dispose();
});

test('execute admits aggregate active input bytes before cloning', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
		}),
	}, {
		maximumActiveOperationsPerOwner: 2,
		maximumActiveOperations: 4,
		maximumActiveInputBytes: 12,
	});
	const first = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'aggregate-one'),
	);
	await until(() => fixture.executions.length === 1);
	await assert.rejects(fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, { owner: {} },
		encodeRequest(new Uint8Array(8), 'aggregate-two'),
	), /aggregate.*byte.*limit/iu);
	assert.equal(fixture.executions.length, 1);
	await fixture.registration.dispose();
	await first;
});

test('codec waiters retain owned input bytes before their turn starts', async () => {
	const release = deferred<unknown>();
	const fixture = registrationFixture({ execute: (request) => request.requestId === 'hold'
		? release.promise : Promise.resolve({ status: 'executed' }) },
	{ maximumActiveOperations: 1, maximumActiveOperationsPerOwner: 1 });
	const first = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8), 'hold'));
	await until(() => fixture.executions.length === 1);
	const input = new Uint8Array(8);
	const second = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(input, 'owned-waiter'));
	assert.equal(await remainsPending(second), true);
	input[0] = 255;
	release.resolve({ status: 'executed' });
	await Promise.all([first, second]);
	assert.equal(fixture.executions[1]?.request.input[0], 0);
	await fixture.registration.dispose();
});

test('dispose removes every handler, aborts jobs, and returns one drain barrier', async () => {
	const release = deferred<unknown>();
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => {
				void release.promise.then(() => resolve({ status: 'disposed' }));
			}, { once: true });
		}),
	}, { maximumActiveOperations: 1, maximumActiveOperationsPerOwner: 1 });
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	const queued = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8), 'queued-at-disposal'));
	const queuedCancelled = assert.rejects(queued, { name: 'AbortError' });
	const first = fixture.registration.dispose();
	const second = fixture.registration.dispose();
	assert.equal(first, second);
	assert.equal(first, fixture.registration.dispose());
	assert.deepEqual(fixture.removed, Object.values(CHANNELS));
	await queuedCancelled;
	let disposed = false;
	void first.then(() => { disposed = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(disposed, false);
	release.resolve(undefined);
	await first;
	assert.equal(disposed, true);
	assert.deepEqual(await running, { status: 'disposed' });
});

test('the codec IPC queue rejects overflow before cloning and cancellation returns queue places', async () => {
	const fixture = registrationFixture({ execute: (_request, { signal }) => new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
	}) }, { maximumActiveOperations: 1, maximumActiveOperationsPerOwner: 1 });
	const first = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8), 'active'));
	await until(() => fixture.executions.length === 1);
	const queued = Array.from({ length: 8 }, (_, index) => fixture.invoke(CHANNELS.desktopAudioCodecExecute,
		fixture.event, encodeRequest(new Uint8Array(8), `queued-${index}`)));
	const settled = Promise.allSettled([first, ...queued]);
	await assert.rejects(fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'overflow')), /queue.*full/iu);
	await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'queued-0');
	const replacement = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'replacement'));
	const rejected = assert.rejects(replacement, { name: 'AbortError' });
	assert.equal(await remainsPending(replacement), true);
	await fixture.registration.dispose();
	await rejected;
	await settled;
	assert.equal(fixture.executions.length, 1);
});

test('registration rolls back partial bindings', () => {
	const removed: string[] = [];
	assert.throws(() => registerDesktopAudioCodecMainIpc({
		channels: CHANNELS,
		handle(channel) { if (channel === CHANNELS.desktopAudioCodecCancel) throw new Error('binding failed'); },
		removeHandler: (channel) => { removed.push(channel); },
		ownerFor: () => ({}), service: { execute: async () => null, capabilities: async () => null },
	}), /binding failed/u);
	assert.deepEqual(removed, [CHANNELS.desktopAudioCodecExecute]);
});

function registrationFixture(
	overrides: Partial<DesktopAudioCodecMainIpcService> = {},
	limits: Pick<DesktopAudioCodecMainIpcOptions<object>,
		'maximumActiveOperationsPerOwner' | 'maximumActiveOperations' | 'maximumActiveInputBytes'> = {},
) {
	const handlers = new Map<string, (event: unknown, ...arguments_: unknown[]) => unknown>();
	const removed: string[] = [];
	const executions: Array<Readonly<{ request: ReturnType<typeof encodeRequest>; signal: AbortSignal }>> = [];
	const capabilityQueries: unknown[] = [];
	const owner = {};
	const event = { owner };
	const registration = registerDesktopAudioCodecMainIpc({
		...limits,
		channels: CHANNELS,
		handle: (channel, listener) => { handlers.set(channel, listener); },
		removeHandler: (channel) => { removed.push(channel); handlers.delete(channel); },
		ownerFor: (value) => (value as typeof event).owner,
		service: {
			capabilities: async (query) => {
				capabilityQueries.push(query);
				return overrides.capabilities
					? overrides.capabilities(query)
					: capabilityResult(query);
			},
			execute: async (request, options) => {
				executions.push({ request: request as ReturnType<typeof encodeRequest>, signal: options.signal });
				return overrides.execute
					? overrides.execute(request, options)
					: { status: 'executed' };
			},
		},
	});
	return {
		capabilityQueries, event, executions, owner, registration, removed,
		invoke: async (channel: string, invocationEvent: unknown, ...arguments_: unknown[]) => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error('Missing IPC handler.');
			return handler(invocationEvent, ...arguments_);
		},
	};
}

function capabilityQuery() {
	return {
		schemaVersion: 2 as const,
		operations: [{
			operation: 'audio-encode' as const, format: 'opus' as const,
			sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 128, vbrMode: 1 },
		}],
	};
}

function capabilityResult(query: DesktopAudioCodecCapabilityQuery) {
	return {
		schemaVersion: 2 as const,
		capabilities: query.operations.map((operation) => ({
			...operation, available: false as const, provider: null,
			reason: 'configure-external-ffmpeg' as const,
		})),
	};
}

function encodeRequest(input: Uint8Array, requestId = 'audio-request-1') {
	return {
		operation: 'audio-encode' as const, format: 'opus' as const, input,
		sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 128, vbrMode: 1 },
		maximumOutputBytes: 8_192, requestId,
	};
}

async function until(predicate: () => boolean): Promise<void> {
	await waitFor(predicate, 'the codec main-process condition');
}
