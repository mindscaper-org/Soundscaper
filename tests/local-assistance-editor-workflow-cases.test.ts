/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import catalog from '../config/local-model-catalog.json' with { type: 'json' };
import { ASSISTANCE_WORKFLOW_IDS } from '../src/common/editor/assistance/workflow.ts';
import { EDITOR_WORKFLOW_CASES } from './electron/local-assistance-models/editor-workflow-cases.ts';

test('packaged editor nightly covers every guided and Advanced recipe with published models', () => {
	assert.deepEqual(Object.keys(EDITOR_WORKFLOW_CASES).sort(), [...ASSISTANCE_WORKFLOW_IDS].sort());
	const ids = new Set(catalog.entries.map(model => model.modelId));
	for (const [workflowId, modelCase] of Object.entries(EDITOR_WORKFLOW_CASES)) {
		assert.ok(modelCase.modelIds.length > 0, workflowId);
		for (const id of modelCase.modelIds) assert.ok(ids.has(id), `${workflowId}: ${id} must be published`);
	}
});

test('the packaged editor visual fixture retains its licensed, authenticated bytes', async () => {
	const bytes = await readFile(new URL('./electron/local-assistance-models/fixtures/editor-workflows.webm', import.meta.url));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), 'bed8440f0e32c8cdfdc8fca6dc8c6433b8ef318c3e2740ec9c7593b5e6beb29e');
});
