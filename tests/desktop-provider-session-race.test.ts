/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopAudiocomProxy } from '../desktop/audiocom-integration.ts';
import { createDesktopFreesoundProxy } from '../desktop/freesound-integration.js';

for (const [name, create] of [['freesound', createDesktopFreesoundProxy], ['audiocom', createDesktopAudiocomProxy]] as const) {
	for (const method of ['GET', 'DELETE']) {
		test(`${name} preserves a reconnected account when an old ${method} request finishes`, async () => {
			let token: string | null = 'A'.repeat(40);
			const old = Promise.withResolvers<Response>();
			const started = Promise.withResolvers<void>();
			const proxy = create({ appOrigin: 'soundscaper-app://bundle', apiOrigin: 'https://soundscaper.org',
				sessionStore: { get: () => token, set: async (value: string) => { token = value; }, clear: async () => { token = null; } },
				fetchImpl: async (input: RequestInfo | URL) => {
					if (String(input).endsWith('/oauth/poll')) return Response.json({ data: { sessionToken: 'B'.repeat(40), status: 'connected' } });
					started.resolve();
					return old.promise;
				} });
			const pending = proxy(new Request(`soundscaper-app://bundle/_desktop/${name}/api/${name}/oauth/session`, { method }));
			await started.promise;
			await proxy(new Request(`soundscaper-app://bundle/_desktop/${name}/api/${name}/oauth/poll`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: 'x'.repeat(40) }),
			}));
			assert.equal(token, 'B'.repeat(40));
			old.resolve(new Response(null, { status: method === 'GET' ? 401 : 204 }));
			await pending;
			assert.equal(token, 'B'.repeat(40));
		});
	}
}
