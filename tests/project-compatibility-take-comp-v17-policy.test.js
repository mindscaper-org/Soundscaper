/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('family-v1 policy records native Soundscaper take/comp and read-only Framescaper preservation', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-take-comp-v17-preservation');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.equal(rule.policyAuthority, 'family-v1-active');

	const evidence = new Set(rule.evidence);
	for (const reference of [
		'src/common/editor/take-comp-domain.ts',
		'src/common/editor/take-comp-document-v17.ts',
		'src/soundscaper/editor-project.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/soundscaper/editor-project-commands.ts',
		'src/framescaper/editor-project.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/audio-editor-scape-v1-baseline.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
	]) {
		assert.equal(evidence.has(reference), true, reference);
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.equal([...evidence].some((path) => /project-v17|project-library-v\d+/u.test(path)), false);

	assert.equal(rule.historicalPreFreezeNarrative?.status, 'provenance-only-not-runtime-authority');
});
