/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopUpdateService } from '../desktop/update-service.ts';

function fixture(response = 2, portable = false) {
	const calls: string[] = [];
	let prompt: { buttons?: string[]; cancelId?: number; detail?: string } | undefined;
	const service = new DesktopUpdateService({
		appName: 'Soundscaper', portable, windowsStore: false,
		checkRelease: async () => { calls.push('check'); return { status: 'available', version: '2.0.0' }; },
		showMessage: async options => { prompt = options; return { response }; },
		openExternal: async () => { calls.push('external'); },
		install: async when => { calls.push(when); },
		installPending: async () => { calls.push('pending'); return false; },
	});
	return { service, calls, prompt: () => prompt };
}

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
