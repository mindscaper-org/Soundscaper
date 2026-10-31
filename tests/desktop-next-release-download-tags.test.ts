/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedProductReleaseTag } from '../scripts/lib/product-release-lines.mjs';
import { handleDesktopDownloadRequest } from '../functions/download/desktop/index.ts';

for (const product of ['soundscaper', 'framescaper'] as const) {
	test(`the desktop download route admits the registered ${product} candidate tag`, async () => {
		const tag = expectedProductReleaseTag(product);
		const prefix = product === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
		const fetchImpl: typeof fetch = async () => Response.json([{
			tag_name: tag, published_at: '2026-10-20T00:00:00Z', draft: false,
			assets: [{ name: `${prefix}-candidate.exe`, state: 'uploaded' }],
		}]);
		const response = await handleDesktopDownloadRequest(new Request(`https://${product}.org/download/desktop/`), fetchImpl);
		assert.equal(response.status, 302);
		assert.equal(response.headers.get('location'), `https://github.com/LeoWattenberg/Soundscaper/releases/tag/${tag}`);
	});
}

test('desktop downloads retain the repository identity after its owner URL redirects', async () => {
	const canonicalApi = 'https://api.github.com/repositories/1299822768/releases?per_page=100&page=1';
	const requested: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		requested.push(String(input));
		assert.equal(init?.redirect, 'manual');
		if (String(input) !== canonicalApi) return new Response(null, { status: 301, headers: { Location: canonicalApi } });
		return Response.json([{
			tag_name: 'v1.0.0', published_at: '2026-10-20T00:00:00Z', draft: false,
			assets: [{ name: 'Soundscaper-1.0.0.exe', state: 'uploaded' }],
		}]);
	};
	const response = await handleDesktopDownloadRequest(new Request('https://soundscaper.org/download/desktop/'), fetchImpl);
	assert.equal(response.headers.get('location'), 'https://github.com/LeoWattenberg/Soundscaper/releases/tag/v1.0.0');
	assert.deepEqual(requested, [canonicalApi]);
});
