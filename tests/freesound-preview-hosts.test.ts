/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFreesoundSearchRequest } from '../functions/api/freesound/_shared/handlers.ts';
import { assertAllowedHost } from '../functions/api/freesound/_shared/oauth-http.ts';

test('actual Pages preview hosts admit public search and the shared OAuth host gate', async () => {
	for (const hostname of ['soundscaper-5ki.pages.dev', 'pr-123.soundscaper-5ki.pages.dev']) {
		const url = new URL(`https://${hostname}/api/freesound/search?q=rain`);
		const response = await handleFreesoundSearchRequest({ request: new Request(url), params: {}, env: { FREESOUND_API_KEY: 'key' } },
			{ fetchImpl: async () => Response.json({ count: 0, results: [] }) });
		assert.equal(response.status, 200, hostname);
		assert.doesNotThrow(() => assertAllowedHost(url, {}));
	}
	assert.throws(() => assertAllowedHost(new URL('https://soundscaper-5ki.pages.dev.attacker.example/api/freesound/search'), {}));
});
