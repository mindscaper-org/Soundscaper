/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { deferred, FakeWindow, settle, type FakeMessageEvent } from './project-transfer-page-fixture.ts';
import { runtimeFor } from './project-transfer-runtime-fixture.ts';

const selfOrigin = 'https://framescaper.org';
const peerOrigin = 'https://soundscaper.org';
const configuration = { selfOrigin, peerOrigin, allowedOrigins: [selfOrigin, peerOrigin], loopback: false };

test('manual import becomes available after the live receiving session releases the page', async () => {
	const receiver = new FakeWindow(selfOrigin);
	receiver.opener = new FakeWindow(peerOrigin);
	const loading = deferred<never>();
	const mounted = mountTransferPage({
		scope: receiver as never,
		role: 'receive',
		configuration,
		dependencies: {
			loadRuntime: () => loading.promise,
			openStore: () => Promise.reject(new Error('No live store')),
		},
	});
	await settle();
	const input = receiver.document.body.querySelector('input[type=file]');
	assert.ok(input);
	const disabledDuringLiveSession = input.disabled;
	loading.reject(new Error('Live transfer runtime did not load'));
	await mounted;
	assert.equal(disabledDuringLiveSession, true);
	assert.equal(input.disabled, false);
});

test('returning to a cached transfer page still allows a later large archive confirmation', async () => {
	const receiver = new FakeWindow(selfOrigin);
	const lifecycle = new EventTarget();
	const listenForMessages = receiver.addEventListener.bind(receiver);
	const scope = Object.assign(receiver, {
		addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions) {
			if (type === 'pagehide') lifecycle.addEventListener(type, listener, options);
			else listenForMessages(type, listener as unknown as (event: FakeMessageEvent) => void);
		},
	});
	await mountTransferPage({
		scope: scope as never,
		role: 'receive',
		configuration,
		dependencies: {
			loadRuntime: async () => runtimeFor(createFakeArchive()),
			openStore: async () => ({ id: 'fake', label: 'Fake', store: new FakeStore(), close: async () => undefined }) as never,
		},
	});
	lifecycle.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
	lifecycle.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));

	const input = receiver.document.body.querySelector('input[type=file]');
	assert.ok(input);
	input.files = [{ name: 'Large recording.sscape', size: 1024 ** 3, arrayBuffer: async () => new ArrayBuffer(0) }];
	input.dispatch('change');
	await settle();
	assert.ok(receiver.document.body.buttonLabels().includes('Continue'));
	await receiver.document.clickButton('Cancel');
});
