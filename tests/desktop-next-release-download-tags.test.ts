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
