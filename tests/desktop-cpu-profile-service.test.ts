/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { WebContents } from 'electron';
import { registerCpuProfiler } from '../desktop/cpu-profile-service.ts';
import { CPU_PROFILE_CHANNEL, CPU_PROFILE_CANCEL_CHANNEL } from '../src/common/editor/cpu-profile-contract.ts';

function fixture() {
	const handlers = new Map<string, (event: unknown) => unknown>();
	const events = new EventEmitter();
	const debug = Object.assign(events, {
		attached: false, detached: 0,
		isAttached() { return this.attached; },
		attach() { this.attached = true; },
		detach() { this.detached++; this.attached = false; events.emit('detach'); },
		sendCommand: async (method: string): Promise<void> => {
			if (method === 'Tracing.start') throw new Error('Trace refused');
		},
	});
	const contents = Object.assign(new EventEmitter(), { debugger: debug,
		isDestroyed: () => false, isDevToolsOpened: () => false, getOSProcessId: () => 123,
	});
	registerCpuProfiler({ handle: (name, listener) => { handlers.set(name, listener); },
		windowFor: () => ({ webContents: contents as unknown as WebContents }), metrics: () => [], mainPid: 1 });
	return { debug, contents, capture: () => Promise.resolve(handlers.get(CPU_PROFILE_CHANNEL)!(null)),
		cancel: () => Promise.resolve(handlers.get(CPU_PROFILE_CANCEL_CHANNEL)!(null)) };
}

test('CPU capture refuses another debugger without detaching it', async () => {
	const value = fixture(); value.debug.attached = true;
	await assert.rejects(value.capture(), /Developer Tools/);
	assert.equal(value.debug.detached, 0);
	assert.equal(value.debug.attached, true);
});

test('a failed trace releases its debugger and listeners and can be retried', async () => {
	const value = fixture();
	await assert.rejects(value.capture(), /Trace refused/);
	assert.equal(value.debug.isAttached(), false);
	assert.equal(value.debug.listenerCount('message'), 0);
	assert.equal(value.debug.listenerCount('detach'), 0);
	assert.equal(value.contents.listenerCount('destroyed'), 0);
	assert.equal(value.contents.listenerCount('did-start-navigation'), 0);
	await value.cancel();
	await assert.rejects(value.capture(), /Trace refused/);
	assert.equal(value.debug.detached, 2);
});
