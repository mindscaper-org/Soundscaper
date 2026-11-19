/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrustedDesktopIpc } from '../desktop/main-trusted-ipc.ts';
import { resolveManagedPolicy } from '../desktop/managed-policy.ts';
import { enforceManagedIpc } from '../desktop/managed-network-policy.ts';

test('desktop IPC admits only the current application main frame and validates its URL', () => {
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
	const frame = { url: 'scape://app/' };
	const sender = { mainFrame: frame };
	let current: { webContents: typeof sender } | null = { webContents: sender };
	const ipc = createTrustedDesktopIpc({
		ipcMain: {
			handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener),
			on: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener),
		},
		windowFor: () => current,
		assertDocumentUrl: (url: string) => { assert.equal(url, 'scape://app/'); },
	});
	const calls: unknown[] = [];
	ipc.handle('request', (_event: unknown, value: unknown) => { calls.push(value); return value; });
	ipc.on('event', (_event: unknown, value: unknown) => { calls.push(value); });
	for (const channel of ['request', 'event']) {
		const invoke = handlers.get(channel)!;
		invoke({ sender, senderFrame: frame }, 7);
		assert.throws(() => invoke({ sender: {}, senderFrame: frame }, 8), /application window/u);
		assert.throws(() => invoke({ sender, senderFrame: { ...frame } }, 8), /active main document/u);
		assert.throws(() => invoke({ sender }, 8), /active main document/u);
		frame.url = 'https://other.example/';
		assert.throws(() => invoke({ sender, senderFrame: frame }, 8));
		frame.url = 'scape://app/';
	}
	current = null;
	assert.throws(() => handlers.get('request')!({ sender, senderFrame: frame }), /application window/u);
	assert.deepEqual(calls, [7, 7]);
});

test('a trusted renderer cannot bypass managed restrictions by directly invoking a channel', () => {
	const frame = { url: 'scape://app/' }, sender = { mainFrame: frame };
	let listener: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
	let started = false;
	const policy = resolveManagedPolicy({ machine: { ExternalCodecInstallationAllowed: 0 } });
	const ipc = createTrustedDesktopIpc({
		ipcMain: { handle: (_channel, handler) => { listener = handler; }, on: () => {} },
		windowFor: () => ({ webContents: sender }), assertDocumentUrl: () => {},
		beforeInvoke: (channel, args) => enforceManagedIpc(policy, channel, args),
	});
	ipc.handle('soundscaper:v1:ffmpeg:install', () => { started = true; });
	assert.throws(() => listener!({ sender, senderFrame: frame }), /administrator policy/u);
	assert.equal(started, false);
});
