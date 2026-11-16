/* SPDX-License-Identifier: AGPL-3.0-only */

import { test } from '@playwright/test';
import { runFramescaperWebVcrPackagedSmoke } from '../../scripts/framescaper-web-vcr-smoke.mjs';
import { resolvePackagedProductExecutable } from '../../scripts/lib/desktop-packaged-product-executable.mjs';

test('packaged Web VCR keeps its guest dormant, then captures real 720p and 1080p video and audio', async ({ browserName: _browserName }, testInfo) => {
	test.skip(process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS !== '1', 'Runs from the nightly packaged Electron collection.');
	test.setTimeout(240_000);
	const executable = resolvePackagedProductExecutable({
		productRoot: process.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT,
		productId: 'framescaper',
		platform: process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform,
		arch: process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch,
	});
	const evidence = await runFramescaperWebVcrPackagedSmoke({ executable });
	await testInfo.attach('web-vcr-packaged-workflow.json', {
		body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
	});
});
