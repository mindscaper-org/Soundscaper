/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('E2E coverage commands and their reference link remain reachable', async () => {
	const [packageMetadata, technicalReadme] = await Promise.all([
		readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../Technical_README.md', import.meta.url), 'utf8'),
	]);

	assert.equal(
		packageMetadata.scripts['coverage:e2e:assemble'],
		'node scripts/assemble-e2e-coverage.mjs',
	);
	assert.equal(
		packageMetadata.scripts['coverage:e2e:prepare'],
		'node scripts/prepare-e2e-coverage.mjs',
	);
	assert.equal(
		packageMetadata.scripts['coverage:e2e:check'],
		'node scripts/check-e2e-coverage.mjs',
	);
	assert.match(technicalReadme, /\[end-to-end coverage\]\(docs\/development\/end-to-end-coverage\.md\)/u);
});
