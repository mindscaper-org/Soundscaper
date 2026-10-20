/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import releaseLines from '../config/product-release-lines.json' with { type: 'json' };
import {
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
} from '../scripts/lib/product-release-lines.mjs';

test('checked-in packaging metadata agrees with the selected Soundscaper release line', async () => {
	const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
	const [metadata, lock, desktop] = await Promise.all([
		json('package.json'), json('package-lock.json'), json('desktop/product.json'),
	]);
	const version = resolveProductApplicationVersion('soundscaper', releaseLines);
	assert.equal(metadata.version, version);
	assert.equal(lock.version, version);
	assert.equal(lock.packages[''].version, version);
	assert.deepEqual(desktop, resolveProductDesktopMetadata('soundscaper', releaseLines));
});

test('product-owned previews exclude the Soundscaper stable tag and any release-admission step', async () => {
	for (const product of Object.values(releaseLines.products)) {
		assert.equal(product.candidate.tagPrefix, `${product.productId}-v`);
	}
	assert.equal(releaseLines.products.soundscaper.stable.tagPrefix, 'v');
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	assert.match(workflow, /'soundscaper-v\*-beta\.\*'/u);
	assert.match(workflow, /'soundscaper-v\*-rc\.\*'/u);
	assert.match(workflow, /'framescaper-v\*-rc\.\*'/u);
	assert.doesNotMatch(workflow, /- 'v\*'/u);
	assert.match(workflow, /resolveProductReleaseTag\(tag/u);
	assert.doesNotMatch(workflow, /release admission|qualification|stable-1:admission/iu);
	const stable = await readFile(new URL('../.github/workflows/soundscaper-stable-1.yml', import.meta.url), 'utf8');
	assert.match(stable, /tags:\s*\n\s*- 'v1\.0\.0'/u);
});
