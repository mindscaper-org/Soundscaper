/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base, expect } from '@playwright/test';
import catalog from '../../../config/local-model-catalog.json' with { type: 'json' };
import { assistanceWorkflowStageGraph } from '../../../src/common/editor/assistance/workflow.ts';
import { launchModelTestElectron } from './electron-fixture.js';
import { createModelTestElectronFixture } from './model-test-fixture.ts';
import { assertModelGpuEvidence } from './model-gpu-evidence.ts';
import { EDITOR_WORKFLOW_CASES, EDITOR_TRANSCRIPT_MODEL_IDS } from './editor-workflow-cases.ts';
import {
	editorWorkflowObservation, importWorkflowMedia, observeEditorWorkflows, persistedEditorState,
	reopenEditorProject, runAdvancedWorkflow, runGuidedWorkflow, selectWorkflowClip, verifyIndexedSearch, verifyUndoRedoAndReopen,
} from './editor-workflow-driver.ts';

const test = base.extend({
	launchModelHost: [createModelTestElectronFixture(testInfo => launchModelTestElectron({
		testInfo, productId: testInfo.project.metadata.productId, editor: true,
	})), { timeout: 120_000 }],
});

for (const [workflowId, modelCase] of Object.entries(EDITOR_WORKFLOW_CASES)) {
	test(`packaged editor: ${workflowId} runs through its real menu, preload and workflow service`, async ({ launchModelHost }, testInfo) => {
		test.skip(modelCase.video && testInfo.project.metadata.productId !== 'framescaper', 'Video menus belong to Framescaper.');
		const ids = [...new Set([...modelCase.modelIds,
			...(modelCase.transcript ? EDITOR_TRANSCRIPT_MODEL_IDS : []),
			...(modelCase.visualIndex ? EDITOR_WORKFLOW_CASES['index-video'].modelIds : [])])];
		const models = ids.map(id => catalog.entries.find(model => model.modelId === id));
		for (const [index, model] of models.entries()) expect(model, ids[index]).toBeDefined();
		const target = `${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform}-${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch}`;
		test.skip(models.some(model => !model.platforms.includes(target)), `Required models are not published on ${target}.`);
		const host = await launchModelHost();
		const { page } = host;
		if (modelCase.externalFfmpeg) {
			const status = await page.evaluate(() => globalThis.soundscaperDesktop.v1.getExternalFfmpegStatus());
			test.skip(status.state !== 'ready', `Optional model-free shot detector unavailable: ${status.state}: ${status.detail}`);
		}
		for (const model of models) await test.step(`Authenticate and install ${model.modelId}`, () => host.installModel(model));
		await observeEditorWorkflows(page);
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const editor = await importWorkflowMedia(page, modelCase);
		if (modelCase.transcript) {
			await runGuidedWorkflow(page, editor, 'transcribe-captions');
			await selectWorkflowClip(page, editor);
		}
		if (modelCase.visualIndex) {
			await runGuidedWorkflow(page, editor, 'index-video');
			await selectWorkflowClip(page, editor, true);
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const before = await persistedEditorState(page);
		try {
			if (workflowId.startsWith('advanced:')) {
				await runAdvancedWorkflow(page, editor, workflowId);
				expect(await persistedEditorState(page)).toEqual(before);
			} else {
				await runGuidedWorkflow(page, editor, workflowId);
			}
			const observation = await editorWorkflowObservation(page);
			const progress = observation.workflow.filter(event => event.workflowId === workflowId);
			const jobIds = [...new Set(progress.map(event => event.jobId))];
			expect(jobIds).toHaveLength(1);
			for (const stage of assistanceWorkflowStageGraph(workflowId).filter(stage => stage.required)) {
				expect(progress.some(event => event.stageId === stage.stageId), `No real progress for ${stage.stageId}`).toBe(true);
			}
			const executedModels = modelCase.modelIds.map(id => models.find(model => model.modelId === id));
			const gpuExecution = await host.readGpuEvidence(jobIds[0]);
			assertModelGpuEvidence(gpuExecution, { jobId: jobIds[0], models: executedModels });
			await testInfo.attach('editor-workflow-evidence.json', { contentType: 'application/json',
				body: JSON.stringify({ workflowId, package: host.packageIdentity, progress, gpuExecution }, null, 2) });
			if (workflowId === 'index-transcript' || workflowId === 'index-video') {
				const query = workflowId === 'index-video' ? 'LOCAL MODEL TEST' : 'country';
				await verifyIndexedSearch(page, editor, query);
				await reopenEditorProject(page);
				await verifyIndexedSearch(page, editor, query);
			} else if (workflowId === 'generate-editorial-text') {
				// Editorial choices acknowledge reviewed text; they never store raw
				// generated prose in the project or consume a history entry.
				expect(await persistedEditorState(page)).toEqual(before);
				await reopenEditorProject(page);
				expect(await persistedEditorState(page)).toEqual(before);
			} else if (!workflowId.startsWith('advanced:')) {
				await verifyUndoRedoAndReopen(page, editor, before);
			}
			expect(errors).toEqual([]);
		} finally {
			if (!page.isClosed()) await testInfo.attach('editor-workflow-progress.json', { contentType: 'application/json',
				body: JSON.stringify(await editorWorkflowObservation(page), null, 2) });
		}
	});
}
