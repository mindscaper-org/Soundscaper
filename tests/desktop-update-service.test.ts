/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopUpdateService } from '../desktop/update-service.ts';
import { deferred } from './helpers/async-test-control.ts';

function fixture(response = 2, portable = false, policyAllowed = true) {
	const calls: string[] = [];
	let prompt: { buttons?: string[]; cancelId?: number; detail?: string } | undefined;
	const service = new DesktopUpdateService({
		appName: 'Soundscaper', portable, windowsStore: false, policyAllowed,
		checkRelease: async () => { calls.push('check'); return { status: 'available', version: '2.0.0' }; },
		showMessage: async options => { prompt = options; return { response }; },
		openExternal: async () => { calls.push('external'); },
		install: async when => { calls.push(when); },
		installPending: async () => { calls.push('pending'); return false; },
	});
	return { service, calls, prompt: () => prompt };
}

test('a manual check joining startup retains requested current or error feedback', async () => {
	for (const status of ['current', 'error', 'offline']) {
		const result = deferred<{ status: string }>();
		const messages: string[] = [];
		let checks = 0;
		const service = new DesktopUpdateService({ appName: 'Soundscaper', portable: false, windowsStore: false,
			checkRelease: () => { checks++; return result.promise; },
			showMessage: async options => { messages.push(options.title); return { response: 2 }; },
			openExternal: async () => {}, install: async () => {}, installPending: async () => false });
		const automatic = service.check(false);
		const manual = service.check(true);
		result.resolve({ status });
		await Promise.all([automatic, manual]);
		assert.equal(checks, 1);
		assert.deepEqual(messages, [status === 'current' ? 'Soundscaper is up to date' : 'Could not check for updates']);
	}
});

test('the update notification offers installation now or next launch and closing skips it', async () => {
	for (const response of [0, 1, 2]) {
		const f = fixture(response);
		await f.service.check(true);
		assert.deepEqual(f.calls, response === 2 ? ['check'] : ['check', response === 0 ? 'now' : 'next-launch']);
		assert.deepEqual(f.prompt()?.buttons, ['Install now', 'Install on next launch', 'Skip']);
		assert.equal(f.prompt()?.cancelId, 2);
		assert.equal(f.prompt()?.detail, undefined);
	}
});

test('portable profiles skip automatic and manual checks and deferred installers', async () => {
	const f = fixture(0, true);
	assert.deepEqual(await f.service.check(false), { status: 'portable' });
	assert.deepEqual(await f.service.check(true), { status: 'portable' });
	await f.service.startup();
	assert.deepEqual(f.calls, []);
});

test('startup opens a deferred installer before attempting a fresh check', async () => {
	const f = fixture();
	await f.service.startup();
	assert.deepEqual(f.calls, ['pending', 'check']);
});

test('managed update restrictions block automatic/manual checks and already staged installers', async () => {
	const f = fixture(0, false, false);
	await f.service.startup();
	assert.deepEqual(await f.service.check(true), { status: 'disabled' });
	assert.deepEqual(await f.service.check(false), { status: 'disabled' });
	assert.deepEqual(f.calls, []);
});
