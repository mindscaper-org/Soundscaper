/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture, milestone7FixtureSnapshot } from './helpers/milestone-7-local-assistance.js';

async function openTranscriptFixture(page) {
	await installMilestone7LocalAssistanceFixture(page, [], { transcriptWordTiming: true });
	page.on('dialog', dialog => { void dialog.accept(); });
	const editor = await bootEditor(page, '/en/');
	await importFiles(editor, ['First', 'Second'].map(name => createWavFixture({ name: `${name}.wav`, channelCount: 1, duration: 1 })));
	return editor;
}

async function openTranscript(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Transcript-based editing');
	return editor.locator('[data-workspace-panel="transcript-editing"]');
}

test('transcript generation can resume with the unprocessed recording after Cancel', async ({ page }) => {
	const editor = await openTranscriptFixture(page);
	const panel = await openTranscript(page, editor);
	const generate = panel.getByRole('button', { name: 'Generate transcript', exact: true });
	const transcript = panel.getByRole('textbox', { name: 'Transcript', exact: true });
	const progress = async () => (await milestone7FixtureSnapshot(page)).progressEvents;
	await generate.click();
	await expect.poll(progress).toBe(1);
	await completeMilestone7Run(page);
	await expect.poll(progress).toBe(2);
	await expect(transcript.getByRole('group', { name: 'First', exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(generate).toBeEnabled();
	await generate.click();
	await expect.poll(progress).toBe(3);
	const { workflowFences } = await milestone7FixtureSnapshot(page);
	const sourceIds = workflowFences.map(({ fence }) => fence.sourceRanges[0].sourceId);
	expect(sourceIds[0]).not.toBe(sourceIds[1]);
	expect(sourceIds[2]).toBe(sourceIds[1]);
	await completeMilestone7Run(page);
	await expect(transcript.getByRole('group', { name: 'Second', exact: true })).toBeVisible();
	await expect(generate).toHaveCount(0);
});

test('a reversed recording leaves forward audio available for transcript generation', async ({ page }) => {
	const editor = await openTranscriptFixture(page);
	const first = editor.locator('[data-clip-id]').filter({ hasText: 'First.wav' }).first();
	const properties = await openClipProperties(page, editor, first, { additional: false });
	await properties.getByRole('switch', { name: 'Reverse', exact: true }).click();
	await closeClipProperties(properties);
	const panel = await openTranscript(page, editor);
	await panel.getByRole('button', { name: 'Generate transcript', exact: true }).click();
	await expect.poll(async () => ({ runs: (await milestone7FixtureSnapshot(page)).progressEvents,
		errors: await panel.getByRole('alert').allTextContents() })).toEqual({ runs: 1, errors: [] });
	await completeMilestone7Run(page);
	const transcript = panel.getByRole('textbox', { name: 'Transcript', exact: true });
	await expect(transcript.getByRole('group', { name: 'Second', exact: true })).toBeVisible();
	await expect(transcript.getByRole('group', { name: 'First', exact: true })).toHaveCount(0);
});
