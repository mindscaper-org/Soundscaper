/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipField, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('linked camera speed refuses clearly until ordinary Unlink, then changes audio with one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('speed-camera.webm')]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	const audio = editor.getByRole('group', { name: /^speed-camera Audio clip,/u });
	const projectId = await editor.getAttribute('data-project-id'), clipId = await audio.getAttribute('data-clip-id');
	expect(clipId).not.toBeNull();
	const properties = await openClipProperties(page, editor, audio);
	await properties.getByText('Pitch and tempo', { exact: true }).click();
	const originalDuration = Number(await clipField(properties, 'durationFrame').inputValue());
	expect(originalDuration).toBe(104_000);
	const readSavedDuration = async () => {
		const saved = await persistedProject(page, projectId);
		return { sampleRate: saved?.sampleRate, frames: saved?.clips.find(clip => clip.id === clipId)?.durationFrames };
	};
	const expectDuration = async (panel, frames) => {
		const input = clipField(panel, 'durationFrame');
		// Focusing restores the authored seconds beyond the three-decimal display.
		await input.focus(); await expect(input).toHaveValue(String(frames / 48_000)); await input.blur();
		await expect.poll(readSavedDuration).toEqual({ sampleRate: 48_000, frames });
	};
	const speed = properties.locator('[data-clip-field="speedRatio"] input');
	const video = editor.locator('[data-clip-kind="video"]');
	const originalVideoStyle = await video.getAttribute('style');
	await speed.fill('2');
	await speed.press('Enter');
	const failure = editor.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]').first();
	await expect(failure).toContainText('Unlink audio');
	await speed.press('Escape');
	await expect(speed).toHaveValue('1');
	await failure.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(clipField(properties, 'durationFrame')).toHaveValue(String(originalDuration));
	await expect.poll(readSavedDuration).toEqual({ sampleRate: 48_000, frames: 104_000 });
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await closeClipProperties(properties);
	await audio.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	await audio.locator('.clip-header').click();
	const unlinked = await openClipProperties(page, editor, audio);
	const unlinkedSpeed = clipField(unlinked, 'speedRatio');
	await unlinkedSpeed.fill('200'); await unlinkedSpeed.press('Enter');
	await expect(unlinkedSpeed).toHaveValue('200');
	await expectDuration(unlinked, 52_000);
	await expect(unlinked.getByRole('alert')).toHaveCount(0);
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await closeClipProperties(unlinked);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, audio);
	await expectDuration(restored, 104_000);
	await closeClipProperties(restored);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await openClipProperties(page, editor, audio);
	await expectDuration(redone, 52_000);
	await expect(video).toHaveAttribute('style', originalVideoStyle);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
