/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrossProductHandoffLaunchIntent, serializeCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import type { TransferPageDependencies } from '../src/common/transfer/transfer-page-context.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { deferred, FakeWindow, settle } from './project-transfer-page-fixture.ts';
import { runtimeFor } from './project-transfer-runtime-fixture.ts';

const selfOrigin = 'https://soundscaper.org';
const peerOrigin = 'https://framescaper.org';

async function openSender(dependencies: Partial<TransferPageDependencies> = {}) {
	const sender = new FakeWindow(selfOrigin);
	const store = new FakeStore([
		{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
		{ id: 'video-2', title: 'Title card', schemaFamily: 'framescaper', schemaVersion: 1 },
	] as never);
	await mountTransferPage({
		scope: sender as never,
		role: 'send',
		configuration: { selfOrigin, peerOrigin, allowedOrigins: [selfOrigin, peerOrigin], loopback: false },
		dependencies: {
			loadRuntime: async () => runtimeFor(createFakeArchive()),
			openStore: async () => ({ id: 'fake', label: 'Fake', store, close: async () => undefined }) as never,
			...dependencies,
		},
	});
	await sender.document.clickButton('Find my projects');
	await settle();
	return sender;
}

test('checking another project while Send is awaiting confirmation asks for fresh consent', async () => {
	const sender = await openSender();
	const [, titleCard] = sender.document.body.querySelectorAll('[data-transfer-choice]');
	titleCard.checked = false;
	await sender.document.clickButton(/^Send /u);

	titleCard.checked = true;
	await sender.document.clickButton(/^Yes, send/u);
	await settle();

	assert.equal(sender.opened, 0);
	assert.match(sender.document.statusText(), /choose Send again/u);
});

test('refreshing the project list while Send is awaiting confirmation invalidates the old consent', async () => {
	const sender = await openSender();
	await sender.document.clickButton(/^Send /u);
	await sender.document.clickButton('Find my projects');
	await settle();
	const boxes = sender.document.body.querySelectorAll('[data-transfer-choice]');
	for (const box of boxes) box.checked = false;

	await sender.document.clickButton(/^Yes, send/u);
	await settle();

	assert.equal(sender.opened, 0);
	assert.match(sender.document.statusText(), /choose Send again/u);
});

test('a sender cannot start another transfer while the download is preparing', async () => {
	const loading = deferred<never>();
	const sender = await openSender({ loadRuntime: () => loading.promise });
	await sender.document.clickButton('Download the ticked archives');
	await sender.document.clickButton(/^Send /u);
	const competingPrompt = sender.document.body.buttonLabels().some((label) => label.startsWith('Yes, send'));
	loading.reject(new Error('Download runtime did not load'));
	await settle();

	assert.equal(competingPrompt, false);
	assert.equal(sender.opened, 0);
	await sender.document.clickButton(/^Send /u);
	assert.ok(sender.document.body.buttonLabels().includes('Yes, send these'));
});

test('Find my projects cannot race the automatic listing for an editable handoff', async () => {
	const sender = new FakeWindow(selfOrigin);
	const project = { id: 'audio-1', title: 'Original mix', schemaFamily: 'soundscaper', schemaVersion: 1, revision: 1 };
	sender.location.search = serializeCrossProductHandoffLaunchIntent(createCrossProductHandoffLaunchIntent({
		sourceProject: project,
		destinationFamily: 'framescaper',
	}));
	const listing = deferred<void>();
	let reads = 0;
	const mounted = mountTransferPage({
		scope: sender as never,
		role: 'send',
		configuration: { selfOrigin, peerOrigin, allowedOrigins: [selfOrigin, peerOrigin], loopback: false },
		dependencies: {
			loadRuntime: async () => runtimeFor(createFakeArchive()),
			openStore: async () => {
				reads += 1;
				await listing.promise;
				return { id: 'fake', label: 'Fake', store: new FakeStore([project] as never), close: async () => undefined } as never;
			},
		},
	});
	const find = sender.document.body.querySelectorAll('button').find((button) => button.textContent === 'Find my projects');
	assert.ok(find);
	const wasDisabled = find.disabled;
	listing.resolve();
	await mounted;

	assert.equal(wasDisabled, true);
	assert.equal(find.disabled, false);
	await sender.document.clickButton('Find my projects');
	await settle();
	assert.equal(reads, 2);
});
