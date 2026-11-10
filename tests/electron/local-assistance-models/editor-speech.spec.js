/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base, expect } from '@playwright/test';
import catalog from '../../../config/local-model-catalog.json' with { type: 'json' };
import { chooseCommandAction, waitForEditor } from '../../browser/audio-editor-test-helpers.js';
import { launchModelTestElectron } from './electron-fixture.js';
import { createModelTestElectronFixture } from './model-test-fixture.ts';
import { assertModelGpuEvidence } from './model-gpu-evidence.ts';
import { editorWorkflowObservation, observeEditorWorkflows, persistedEditorState,
	selectWorkflowClip, verifyUndoRedoAndReopen } from './editor-workflow-driver.ts';

const test = base.extend({
	launchModelHost: [createModelTestElectronFixture(testInfo => launchModelTestElectron({
		testInfo, productId: testInfo.project.metadata.productId, editor: true,
	})), { timeout: 120_000 }],
});

test('packaged editor: real speech preview, insertion, regeneration, undo and reopen', async ({ launchModelHost }, testInfo) => {
	const model = catalog.entries.find(model => model.modelId === 'kokoro-82m-v1.0');
	const target = `${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform}-${process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch}`;
	test.skip(!model.platforms.includes(target), `Kokoro is not published on ${target}.`);
	const host = await launchModelHost();
	await host.installModel(model);
	const { page } = host;
	let editor = await waitForEditor(page);
	await observeEditorWorkflows(page);
	const initial = await persistedEditorState(page);
	const script = 'Hello from Soundscaper. This is a local speech test.';
	let speech = await preview(script);
	await speech.getByRole('button', { name: 'Add as new track at playhead', exact: true }).click();
	await expect(speech.getByText('Speech added on a new track.', { exact: true })).toBeVisible();
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	await gpuReceipt('insertion');
	await verifyUndoRedoAndReopen(page, editor, initial);
	editor = await waitForEditor(page);
	await observeEditorWorkflows(page);
	await selectWorkflowClip(page, editor);
	const inserted = await persistedEditorState(page);
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	await expect(speech.getByRole('textbox', { name: 'Script', exact: true })).toHaveValue(script);
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	speech = await preview('This is the regenerated narration, made locally.');
	await speech.getByRole('button', { name: 'Replace selected speech clip', exact: true }).click();
	await expect(speech.getByText('Selected speech clip replaced.', { exact: true })).toBeVisible();
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	await gpuReceipt('regeneration');
	await verifyUndoRedoAndReopen(page, editor, inserted);

	async function preview(text) {
		await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
		const dialog = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
		await dialog.getByRole('textbox', { name: 'Script', exact: true }).fill(text);
		await dialog.getByRole('button', { name: 'Generate preview', exact: true }).click();
		const audio = dialog.locator('audio');
		await expect(audio).toBeVisible({ timeout: 10 * 60_000 });
		await expect.poll(() => audio.evaluate(element => element.duration)).toBeGreaterThan(0);
		await audio.evaluate(async element => { await element.play(); element.pause(); });
		return dialog;
	}

	async function gpuReceipt(name) {
		const progress = (await editorWorkflowObservation(page)).primitive;
		const jobs = [...new Set(progress.map(event => event.jobId))];
		expect(jobs).toHaveLength(1);
		const records = await host.readGpuEvidence(jobs[0]);
		assertModelGpuEvidence(records, { jobId: jobs[0], models: [model], language: 'a' });
		await testInfo.attach(`speech-${name}-gpu.json`, { contentType: 'application/json',
			body: JSON.stringify({ package: host.packageIdentity, progress, records }, null, 2) });
	}
});
