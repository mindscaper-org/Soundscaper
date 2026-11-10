/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Dialog, type Locator, type Page } from '@playwright/test';
import type { AssistanceWorkflowId } from '../../../src/common/editor/assistance/workflow.ts';
import { ASSISTANCE_TASKS } from '../../../src/common/editor/ui/assistance-task-catalog.ts';
import { createWavFixture } from '../../browser/audio-editor-test-fixtures.js';
import { chooseCommandAction, chooseNestedCommandAction, importFiles, waitForEditor } from '../../browser/audio-editor-test-helpers.js';
import { openAssistanceTask } from '../../browser/helpers/assistance-task-menu.js';
import { loadSpeechFixture, prepareModelInput } from './model-inputs.js';
import type { EditorWorkflowCase } from './editor-workflow-cases.ts';

const INFERENCE_TIMEOUT = 20 * 60_000;
type DataRecord = Record<string, unknown>;
interface Progress { readonly jobId: string; readonly workflowId?: string; readonly stageId?: string }
interface Observation { workflow: Progress[]; primitive: Progress[] }
interface ObservableBridge {
	readonly localAssistance: {
		workflow: { onProgress(listener: (event: Progress) => void): () => void };
		onProgress(listener: (event: Progress) => void): () => void;
	};
}
interface Library { readProjectBundle(id: string): Promise<{ document: string } | null> }
type TestScope = typeof globalThis & {
	__nightlyWorkflowObservation?: Observation;
	soundscaperDesktop: { v1: ObservableBridge };
	soundscaperProjectLibraryDesktop?: { v1: Library };
	framescaperDesktop: { v1: { projectLibrary: Library } };
};

/** Observe the real bridge; never replace it or manufacture workflow outcomes. */
export async function observeEditorWorkflows(page: Page): Promise<void> {
	await page.evaluate(() => {
		const scope = globalThis as TestScope;
		const observation: Observation = { workflow: [], primitive: [] };
		scope.__nightlyWorkflowObservation = observation;
		const bridge = scope.soundscaperDesktop.v1.localAssistance;
		bridge.workflow.onProgress(event => { observation.workflow.push(structuredClone(event)); });
		bridge.onProgress(event => { observation.primitive.push(structuredClone(event)); });
	});
}

export async function editorWorkflowObservation(page: Page): Promise<Observation> {
	return page.evaluate(() => (globalThis as TestScope).__nightlyWorkflowObservation ?? { workflow: [], primitive: [] });
}

export async function importWorkflowMedia(page: Page, modelCase: EditorWorkflowCase): Promise<Locator> {
	const editor = await waitForEditor(page);
	if (modelCase.video) {
		const buffer = await readFile(new URL('./fixtures/editor-workflows.webm', import.meta.url));
		assert.equal(createHash('sha256').update(buffer).digest('hex'), 'bed8440f0e32c8cdfdc8fca6dc8c6433b8ef318c3e2740ec9c7593b5e6beb29e');
		await editor.locator('[data-project-bin-input]').setInputFiles({ name: 'Nightly visual workflow.webm', mimeType: 'video/webm', buffer });
		await editor.getByRole('button', { name: 'Add to timeline: Nightly visual workflow', exact: true }).click();
	} else {
		const short = modelCase.fixture === 'short-mono' || modelCase.fixture === 'short-stereo';
		const input = short ? createWavFixture({ name: 'Nightly short 44100.wav', frequency: 330, duration: 2,
			sampleRate: 44_100, channelCount: modelCase.fixture === 'short-stereo' ? 2 : 1 })
			: await audioFixture(page, modelCase.fixture);
		await importFiles(editor, [input], { timeout: 60_000 });
	}
	await selectWorkflowClip(page, editor, modelCase.video === true);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	return editor;
}

async function audioFixture(page: Page, fixture: EditorWorkflowCase['fixture']) {
	const input = fixture === 'rhythm' ? await prepareModelInput('rhythmic-music-22050hz', page)
		: fixture === 'mixed-speech' ? await prepareModelInput('mixed-speech-44100hz', page) : await loadSpeechFixture(false);
	return { name: 'Nightly speech.wav', mimeType: 'audio/wav', buffer: input.bytes };
}

export async function selectWorkflowClip(page: Page, editor: Locator, video = false): Promise<void> {
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clip = editor.getByRole('group', { name: video ? /^Video clip:/u : / clip(?:,|$)/u }).first();
	await clip.focus(); await page.keyboard.press('Enter');
}

/** Read persisted canonical state through the shipped library API, never mutate it. */
export async function persistedEditorState(page: Page): Promise<DataRecord> {
	const persistedDocument = await page.evaluate(async () => {
		const scope = globalThis as TestScope;
		const editor = document.querySelector('[data-audio-editor]');
		const id = editor?.getAttribute('data-project-id');
		if (!id) throw new Error('The editor has no active project.');
		const library = editor?.getAttribute('data-product') === 'framescaper'
			? scope.framescaperDesktop.v1.projectLibrary : scope.soundscaperProjectLibraryDesktop?.v1;
		if (!library) throw new Error('The packaged editor has no production project library.');
		const bundle = await library.readProjectBundle(id);
		if (!bundle) throw new Error('The active editor project was not persisted.');
		return bundle.document;
	});
	const project = JSON.parse(persistedDocument) as DataRecord;
	const transient = new Set(['revision', 'updatedAt', 'selection', 'view']);
	return Object.fromEntries(Object.entries(project).filter(([key]) => !transient.has(key)));
}

export async function runGuidedWorkflow(page: Page, editor: Locator, workflowId: AssistanceWorkflowId): Promise<void> {
	const task = ASSISTANCE_TASKS.find(task => task.workflowId === workflowId);
	assert.ok(task, `No menu command exists for ${workflowId}`);
	await openAssistanceTask(page, editor, task.label);
	const dialog = page.getByRole('dialog', { name: task.label, exact: true });
	await expect(dialog).toBeVisible();
	if (['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'].includes(workflowId)) {
		await expect(dialog).toBeHidden({ timeout: INFERENCE_TIMEOUT });
		return;
	}
	if (workflowId === 'mark-cuts' || workflowId === 'index-video') {
		await dialog.getByRole('radio', { name: 'Accurate · TransNetV2', exact: true }).check();
	}
	if (workflowId === 'generate-editorial-text') await dialog.getByRole('checkbox', { name: 'Generate text suggestions', exact: true }).check();
	if (workflowId === 'make-highlights') await dialog.getByRole('checkbox', { name: 'Refine highlight suggestions', exact: true }).check();
	if (workflowId === 'mark-reactions') {
		const threshold = dialog.getByRole('spinbutton', { name: 'Reaction threshold', exact: true });
		await threshold.fill('0'); await threshold.press('Tab');
	}
	if (workflowId === 'detect-beats-tempo') {
		await dialog.getByRole('checkbox', { name: 'Add a Beats label track', exact: true }).check();
		await dialog.getByRole('checkbox', { name: 'Update the project tempo map', exact: true }).check();
	}
	await dialog.getByRole('button', { name: /^(Analyze|Apply|Generate)$/u }).click();
	await dialog.getByRole('button', { name: 'Review result', exact: true }).click({ timeout: INFERENCE_TIMEOUT });
	const review = dialog.getByRole('region', { name: 'Guided workflow review', exact: true });
	await expect(review).toBeVisible({ timeout: INFERENCE_TIMEOUT });
	if (workflowId === 'reframe') {
		await review.getByRole('slider', { name: 'Horizontal position', exact: true }).fill('0.2');
	}
	if (workflowId === 'make-highlights') {
		const proposal = review.getByRole('article', { name: 'Highlight proposal 1', exact: true });
		await proposal.getByRole('textbox', { name: 'Title', exact: true }).fill('Nightly edited highlight');
		await proposal.getByRole('textbox', { name: 'Title', exact: true }).press('Tab');
	}
	const choices = review.getByRole('checkbox');
	expect(await choices.count(), `${workflowId} returned no applicable proposals`).toBeGreaterThan(0);
	for (const choice of await choices.all()) {
		await expect(choice).not.toBeChecked();
		if (await choice.isEnabled()) await choice.check();
	}
	await dialog.getByRole('button', { name: 'Apply selected', exact: true }).click();
	await expect(dialog.getByRole('status', { name: 'Processing status' })).toHaveText('The proposal was accepted.', { timeout: INFERENCE_TIMEOUT });
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

export async function runAdvancedWorkflow(page: Page, editor: Locator, workflowId: AssistanceWorkflowId): Promise<void> {
	const operation = workflowId.replace(/^advanced:/u, '');
	await chooseCommandAction(page, editor, 'Tools', 'Advanced Local Processing');
	const dialog = page.getByRole('dialog', { name: 'Advanced Local Processing', exact: true });
	await dialog.getByRole('combobox', { name: 'Operation', exact: true }).selectOption(operation);
	if (operation === 'shot-detection') await dialog.getByRole('radio', { name: 'Accurate · TransNetV2', exact: true }).check();
	await dialog.getByRole('button', { name: /^(Analyze|Apply|Generate)$/u }).click();
	await expect(dialog.getByText('A validated local result is available.', { exact: true })).toBeVisible({ timeout: INFERENCE_TIMEOUT });
	await dialog.getByRole('button', { name: 'Review result', exact: true }).click();
	await expect(dialog.getByText(/\d+ validated outputs/u)).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

export async function verifyUndoRedoAndReopen(page: Page, editor: Locator, before: DataRecord): Promise<void> {
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const accepted = await persistedEditorState(page);
	expect(accepted).not.toEqual(before);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => persistedEditorState(page)).toEqual(before);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => persistedEditorState(page)).toEqual(accepted);
	await reopenEditorProject(page);
	await expect.poll(() => persistedEditorState(page)).toEqual(accepted);
}

export async function reopenEditorProject(page: Page): Promise<void> {
	await expect(page.locator('[data-audio-editor] [data-save-state]')).toHaveAttribute('data-state', 'saved');
	// Reload is intentional and persistence was checked above. Electron can
	// retire its beforeunload prompt before CDP acknowledges our navigation.
	const handle = (dialog: Dialog): void => {
		void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
	};
	page.on('dialog', handle);
	try { await page.reload(); await waitForEditor(page); }
	finally { page.off('dialog', handle); }
}

export async function verifyIndexedSearch(page: Page, editor: Locator, query = 'country'): Promise<void> {
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.focus(); await playhead.press('End');
	const before = await playhead.getAttribute('aria-valuenow');
	await chooseNestedCommandAction(page, editor, 'Tools', ['Search', 'Indexed Search']);
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill(query);
	const result = editor.locator('[data-editor-search-option][data-editor-search-kind="assistance"]').first();
	await expect(result).toBeVisible({ timeout: INFERENCE_TIMEOUT });
	await result.click();
	await expect(search).toBeHidden();
	await expect(playhead).toHaveAttribute('aria-valuenow', /^\d+$/u);
	await expect(playhead).not.toHaveAttribute('aria-valuenow', before!);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}
