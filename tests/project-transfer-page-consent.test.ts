/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mountTransferPage } from '../src/common/transfer/transfer-page-entry.ts';
import { FakeStore } from './project-transfer-bundle-fixture.ts';
import { FakeWindow, settle } from './project-transfer-page-fixture.ts';

const selfOrigin = 'https://soundscaper.org';
const peerOrigin = 'https://framescaper.org';

async function openSender() {
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
			openStore: async () => ({ id: 'fake', label: 'Fake', store, close: async () => undefined }) as never,
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
