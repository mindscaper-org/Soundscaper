/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { IPC } from '../desktop/constants.js';
import type { HelperDataPlaneTransferPort } from '../desktop/helper-data-plane-transfer.ts';
import { createHarness, settled } from './helpers/helper-supervisor-double.ts';
import { createSettings } from './helpers/desktop-native-tier-harness.js';

const { registerDesktopNativeAudioHelper } = await import('../desktop/native-helper-registration.mjs');

test('registered native input, output, and inventory each reach an independent real helper supervisor', async () => {
	const fixture = registrationFixture();
	try {
		const input = await fixture.registration.sessions.open(fixture.owner, fixture.request('input'));
		assert.equal(input.status, 'opened');
		const output = await fixture.registration.sessions.open(fixture.owner, fixture.request('output'));
		assert.equal(output.status, 'opened');
		assert.equal(fixture.workers.length, 3, 'one discovery supervisor and two persistent session supervisors');
		assert.equal(fixture.workers[1]?.supervisor.snapshot().state, 'busy');
		assert.equal(fixture.workers[2]?.supervisor.snapshot().state, 'busy');
		const inventory = await fixture.registration.describeBackend({ owner: fixture.owner, backend: 'wasapi' });
		assert.equal(inventory.status, 'described', 'device refresh completes while both live streams remain open');
		assert.equal(fixture.workers[0]?.supervisor.snapshot().state, 'ready');
		const third = await fixture.registration.sessions.open(fixture.owner, fixture.request('input'));
		assert.equal(third.status, 'refused');
		assert.equal(fixture.workers.length, 3, 'capacity refusal creates no extra process');
		if (input.status !== 'opened' || output.status !== 'opened') return;
		const target = { postMessage: (_channel: string, _offer: unknown, ports: readonly unknown[]) => {
			fixture.delivered.push(ports[0] as QueuedPort);
		} };
		await fixture.registration.sessions.bind(fixture.owner, { sessionId: input.sessionId, owner: target, queueCapacity: 8 });
		await fixture.registration.sessions.bind(fixture.owner, { sessionId: output.sessionId, owner: target, queueCapacity: 8 });
		await fixture.registration.sessions.close(fixture.owner, input.sessionId);
		assert.equal(fixture.workers[1]?.supervisor.snapshot().state, 'disposed');
		assert.equal(fixture.workers[2]?.supervisor.snapshot().state, 'busy');
		assert.equal(fixture.delivered[1]?.closed, false, 'closing input preserves the output data plane');
		await fixture.registration.setEnabled(false);
		assert.equal(fixture.workers[2]?.supervisor.snapshot().state, 'disposed');
		assert.equal(fixture.delivered[1]?.closed, true);
	} finally { await fixture.registration.dispose(); }
});

test('registered audio session crashes expose and clear one shared quarantine across fresh helpers', async () => {
	const fixture = registrationFixture();
	try {
		for (let index = 0; index < 3; index += 1) {
			const opened = await fixture.registration.sessions.open(fixture.owner, fixture.request('input'));
			assert.equal(opened.status, 'opened');
			fixture.workers[index + 1]!.latest().exit(1);
			await settled();
			if (opened.status === 'opened') await fixture.registration.sessions.close(fixture.owner, opened.sessionId);
		}
		assert.equal(fixture.registration.controlSnapshot().quarantined, true);
		assert.equal((await fixture.registration.availability()).quarantined, true);
		const refused = await fixture.registration.sessions.open(fixture.owner, fixture.request('output'));
		assert.equal(refused.status, 'refused');
		assert.equal(fixture.workers.length, 4);
		fixture.registration.clearQuarantine();
		assert.equal(fixture.registration.controlSnapshot().quarantined, false);
		assert.equal((await fixture.registration.sessions.open(fixture.owner, fixture.request('output'))).status, 'opened');
	} finally { await fixture.registration.dispose(); }
});

function registrationFixture() {
	const workers: ReturnType<typeof createHarness>[] = [];
	const owner = {};
	const delivered: QueuedPort[] = [];
	const settings = { ...createSettings(), setNativeAudioRoutePreference: async () => undefined };
	const createHelper = (options: Readonly<{ role: string; payloadKind: string }>) => {
		assert.equal(options.role, 'audio');
		assert.equal(options.payloadKind, 'professional');
		const worker = createHarness({ kinds: ['audio-device'], completeSpawn: (channel) => {
			const original = channel.postMessage.bind(channel);
			channel.postMessage = (message, ports = []) => {
				original(message, ports);
				if (message.type === 'cancel') {
					queueMicrotask(() => channel.receive({ contractVersion: 1, type: 'cancelled', jobId: message.jobId }));
					return;
				}
				if (message.type !== 'job' || message.kind !== 'audio-device') return;
				if (!('persistentPort' in message.grant)) {
					queueMicrotask(() => channel.receive({ contractVersion: 1, type: 'result', jobId: message.jobId,
						result: { backend: 'wasapi', status: 'available', detail: '', devices: [] } }));
					return;
				}
				const port = ports[0] as unknown as QueuedPort;
				port.on('message', ({ data }) => {
					const config = data as Record<string, unknown>;
					if (config.kind !== 'configure') return;
					port.postMessage({ protocolVersion: 1, kind: 'configured', status: 'opened', backend: 'wasapi',
						format: { direction: message.grant.direction, mode: 'shared', sampleRate: config.sampleRate,
							periodFrames: config.periodFrames, channelCount: config.channelCount } });
				});
			};
			return channel;
		} });
		workers.push(worker);
		return { supervisor: worker.supervisor, describePayload: async () => ({ status: 'available' }) };
	};
	const registration = registerDesktopNativeAudioHelper({ channels: IPC, handle() {}, ownerFor: () => owner,
		settings, desktopRoot: '/Soundscaper/desktop', packaged: false, resourcesPath: '/Soundscaper/resources',
		createMessageChannel: queuedChannel as unknown as NonNullable<Parameters<typeof registerDesktopNativeAudioHelper>[0]['createMessageChannel']>,
		isBackendActivated: () => true,
		createHelperSupervisor: createHelper as unknown as NonNullable<Parameters<typeof registerDesktopNativeAudioHelper>[0]['createHelperSupervisor']>,
	});
	return { registration, workers, owner, delivered,
		request: (direction: 'input' | 'output') => ({ direction, mode: 'shared', sampleRate: 48_000, periodFrames: 128,
			channelCount: 2, candidates: [{ backend: 'wasapi', deviceHandle: direction }] }),
	};
}

class QueuedPort {
	peer: QueuedPort | null = null;
	closed = false;
	readonly listeners = new Set<(event: Readonly<{ data: unknown }>) => void>();
	readonly queued: unknown[] = [];
	postMessage(message: unknown): void {
		const peer = this.peer;
		if (!peer || peer.closed) return;
		if (peer.listeners.size === 0) peer.queued.push(message);
		else for (const listener of peer.listeners) queueMicrotask(() => listener({ data: message }));
	}
	on(_event: 'message', listener: (event: Readonly<{ data: unknown }>) => void): void {
		this.listeners.add(listener);
		for (const data of this.queued.splice(0)) queueMicrotask(() => listener({ data }));
	}
	off(_event: 'message', listener: (event: Readonly<{ data: unknown }>) => void): void { this.listeners.delete(listener); }
	start(): void {}
	close(): void { this.closed = true; }
}

function queuedChannel(): Readonly<{ port1: QueuedPort & HelperDataPlaneTransferPort; port2: QueuedPort }> {
	const port1 = new QueuedPort(); const port2 = new QueuedPort();
	port1.peer = port2; port2.peer = port1;
	return { port1, port2 };
}
