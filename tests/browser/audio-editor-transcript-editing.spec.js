/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, clipByName, importFiles, registerAudioEditorHooks, closeWorkspacePanel, waitForEditor } from './audio-editor-test-helpers.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';
import { installMilestone7LocalAssistanceFixture, milestone7FixtureSnapshot, completeMilestone7Run } from './helpers/milestone-7-local-assistance.js';

test.describe('Transcript-based editing', () => {
	test.use({ viewport: { width: 1440, height: 1000 } });
	registerAudioEditorHooks();

	test('opens hidden at the bottom and generates timed transcripts for all audio tracks', async ({ page }) => {
		test.setTimeout(120_000);
		await installMilestone7LocalAssistanceFixture(page, [], { transcriptWordTiming: true });
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [
			createWavFixture({ name: 'interview-a.wav', frequency: 330, duration: 4, channelCount: 1 }),
			createWavFixture({ name: 'interview-b.wav', frequency: 440, duration: 4, channelCount: 1 }),
		]);
		await expect(editor.getByRole('textbox', { name: 'Transcript', exact: true })).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Transcript-based editing');
		const panel = editor.locator('[data-workspace-panel="transcript-editing"]');
		await expect(panel).toBeVisible();
		await expect(panel.locator('xpath=ancestor::*[@data-panel-dock][1]')).toHaveAttribute('data-panel-dock', 'bottom');
		await expect(panel.getByRole('button', { name: 'Generate transcript', exact: true })).toBeEnabled();
		page.on('dialog', dialog => { void dialog.accept(); });
		await panel.getByRole('button', { name: 'Generate transcript', exact: true }).click();
		for (let run = 1; run <= 2; run += 1) {
			await expect.poll(async () => ({ progress: (await milestone7FixtureSnapshot(page)).progressEvents, errors: await panel.getByRole('alert').allTextContents() })).toEqual({ progress: run, errors: [] });
			await completeMilestone7Run(page);
		}
		const transcript = panel.getByRole('textbox', { name: 'Transcript', exact: true });
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(2);
		await expect(panel.getByRole('button', { name: 'Generate transcript', exact: true })).toHaveCount(0);
		await expect(panel.getByRole('alert')).toHaveCount(0);

		const firstPassage = transcript.getByRole('group', { name: 'interview-a', exact: true });
		const launch = firstPassage.getByText('Launch', { exact: true });
		const plan = firstPassage.getByText('plan', { exact: true });
		await launch.click();
		await launch.evaluate(element => {
			element.closest('[contenteditable="true"]').focus();
			const range = document.createRange();
			range.selectNodeContents(element);
			range.collapse(false);
			const selection = document.getSelection();
			selection.removeAllRanges(); selection.addRange(range);
		});
		await page.keyboard.press('ControlOrMeta+x');
		await expect(transcript).toHaveAttribute('aria-busy', 'false');
		await expect(plan).toHaveCount(1);
		await expect(launch).toHaveCount(1);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Backspace');
		await expect(launch).toHaveCount(0);
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(1);
		await transcript.press('ControlOrMeta+z');
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(2);
		await launch.dblclick();
		await expect(launch).toHaveClass('is-selected');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Delete');
		await expect(plan).toHaveCount(0);
		await expect(launch).toHaveCount(1);
		await transcript.press('ControlOrMeta+z');
		await expect(plan).toHaveCount(1);
		const firstClip = clipByName(editor, 'interview-a.wav').first();
		await selectClipRange(page, editor, firstClip, 0.105, 0.12);
		await expect(firstPassage.getByText('interview.', { exact: true })).toHaveClass('is-selected');
		await expect(launch).toHaveClass('');
		for (let step = 0; step < 5; step += 1) await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const clipWidth = (await firstClip.boundingBox()).width;
		const scroll = editor.locator('.audio-editor-timeline-scroll');
		await scroll.evaluate(element => { element.scrollLeft = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
		await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(0);
		await firstPassage.getByText('interview.', { exact: true }).click();
		await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
		expect((await firstClip.boundingBox()).width).toBeCloseTo(clipWidth, 1);
		await launch.dblclick();
		await expect(launch).toHaveClass('is-selected');
		await transcript.press('Backspace');
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(1);
		await expect(plan).toHaveClass('');
		await transcript.press('Delete');
		await expect(transcript.getByText('plan', { exact: true })).toHaveCount(1);
		await transcript.press('ControlOrMeta+z');
		await expect(transcript.getByText('plan', { exact: true })).toHaveCount(2);
		await transcript.press('ControlOrMeta+z');
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(2);
		await transcript.press('ControlOrMeta+Shift+z');
		await expect(transcript.getByText('Launch', { exact: true })).toHaveCount(1);
		await expect(panel.getByRole('alert')).toHaveCount(0);

		await closeWorkspacePanel(editor, 'transcript-editing');
		await expect(transcript).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Transcript-based editing');
		await expect(editor.getByRole('textbox', { name: 'Transcript', exact: true }).getByText('Launch', { exact: true })).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		const reopened = await waitForEditor(page);
		await expect(reopened.getByRole('textbox', { name: 'Transcript', exact: true }).getByText('Launch', { exact: true })).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('web panel explains desktop generation without invoking inference', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Transcript-based editing');
		const panel = editor.locator('[data-workspace-panel="transcript-editing"]');
		await expect(panel.getByRole('button', { name: 'Generate transcript', exact: true })).toBeDisabled();
		await expect(panel).toContainText('Transcript generation is available in the desktop app.');
	});
});
