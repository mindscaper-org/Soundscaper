/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy records family-qualified local-assistance custody', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const localAssistance = policy.rules.find(
		(rule) => rule.id === 'current-local-assistance-transcript-custody',
	);
	assert.ok(localAssistance);
	assert.equal(localAssistance.policyAuthority, 'family-v1-active');
	for (const reference of localAssistance.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.deepEqual(localAssistance.evidence, [
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts',
		'src/soundscaper/editor-project.ts',
		'src/framescaper/editor-project-assistance.ts',
		'tests/audio-editor-assistance-workflow-contract.test.ts',
		'tests/audio-editor-assistance-transcript-scape-v1.test.ts',
		'tests/audio-editor-soundscaper-baseline.test.ts',
		'tests/audio-editor-framescaper-baseline.test.ts',
	]);
});
