/* SPDX-License-Identifier: AGPL-3.0-only */

import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import {
	createWavFixture,
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	chooseCommandAction,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { selectClipRange } from './helpers/complex-editing-workflows.js';
import {
	completeMilestone7Run,
	installMilestone7LocalAssistanceFixture,
	milestone7FixtureSnapshot,
} from './helpers/milestone-7-local-assistance.js';

const AUDIO = createWavFixture({
	name: 'assistance-acceptance.wav',
	frequency: 330,
	duration: 4,
	channelCount: 1,
});

test.describe('Local Assistance result acceptance', () => {
	registerAudioEditorHooks();

	test('publishes reviewed reaction, beat, tempo, and cleanup results', async ({ page }) => {
		test.setTimeout(240_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [AUDIO], { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		acceptConsentDialogs(page);

		await selectSource(editor, page);
		let review = await runAndReview(page, editor, 'Mark Reactions');
		await review.getByRole('checkbox', { name: 'Reaction range 1', exact: true }).check();
		await applyAndClose(page);
		await expect(editor.locator('[data-label-track] [data-label-id]', { hasText: 'Laughter' }))
			.toHaveCount(1);

		await selectSource(editor, page);
		await openAssistanceTask(page, editor, 'Detect Beats & Tempo');
		let assistance = page.locator('[data-local-assistance]');
		await assistance.getByRole('checkbox', {
			name: 'Add a Beats label track', exact: true,
		}).check();
		await assistance.getByRole('checkbox', {
			name: 'Update the project tempo map', exact: true,
		}).check();
		review = await runSelectedAndReview(page, assistance);
		await review.getByRole('checkbox', { name: 'Beat point 1', exact: true }).check();
		await review.getByRole('checkbox', { name: 'Tempo map', exact: true }).check();
		await applyAndClose(page);
		await expect(editor.locator('[data-label-track] [data-label-id]', { hasText: 'Downbeat' }))
			.toHaveCount(1);

		await selectSource(editor, page);
		review = await runAndReview(page, editor, 'Clean Filler & Silence');
		await review.getByRole('checkbox', { name: 'Cleanup edit 1', exact: true }).check();
		await applyAndClose(page);

		await expect.poll(() => acceptedProjectSummary(page, projectId)).toMatchObject({
			assistanceSourceNames: [],
			beatLabels: ['Downbeat'],
			cleanupClipCount: 2,
			reactionLabels: ['Laughter'],
			tempoBpm: { den: 1, num: 120 },
		});
		expect(errors).toEqual([]);
	});

	test('applies effects without configuration dialogs and undoes each selected-audio replacement', async ({ page }) => {
		test.setTimeout(180_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [AUDIO], { timeout: 30_000 });
		const projectId = await editor.getAttribute('data-project-id');
		acceptConsentDialogs(page);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const initial = await storedAudioSummary(page, projectId);
		for (const [task, names] of [
			['Enhance Dialogue', ['Enhanced Dialogue']],
			['Reduce Reverb', ['Reduced Reverb']],
			['Separate Dialogue / Music / Effects', ['Dialogue', 'Music', 'Effects']],
		]) {
			const { progressEvents } = await milestone7FixtureSnapshot(page);
			await chooseCommandAction(page, editor, 'Select', 'Select none');
			await selectClipRange(page, editor, clipByName(editor, AUDIO.name).first(), 0.25, 0.75);
			const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
			await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
			const startFrame = Number(await playhead.getAttribute('aria-valuenow'));
			await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
			const endFrame = Number(await playhead.getAttribute('aria-valuenow'));
			await openAssistanceTask(page, editor, task);
			const assistance = page.getByRole('dialog', { name: task, exact: true });
			await expect(assistance.getByRole('progressbar', { name: 'Processing status' })).toBeVisible();
			await expect.poll(() => milestone7FixtureSnapshot(page).then((state) => state.progressEvents))
				.toBe(progressEvents + 1);
			await expect(assistance.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
			await expect(assistance.getByRole('combobox')).toHaveCount(0);
			await expect(assistance.getByRole('button', { name: 'Add result to', exact: true })).toHaveCount(0);
			await expect(assistance.getByText('Technical details', { exact: true })).toHaveCount(0);
			await expect(assistance.getByText('Exact settings', { exact: true })).toHaveCount(0);
			await expect(assistance.getByRole('button', { name: 'Review result', exact: true })).toHaveCount(0);
			await completeMilestone7Run(page);
			await expect(assistance).toBeHidden();
			await expect.poll(() => storedAudioSummary(page, projectId)).toMatchObject({
				clipSourceNames: [AUDIO.name, AUDIO.name, ...names].sort(),
				projectBinClipCount: initial.projectBinClipCount,
			});
			const applied = await storedAudioSummary(page, projectId);
			const replacements = applied.clips.filter(({ sourceName }) => names.includes(sourceName));
			expect(replacements).toHaveLength(names.length);
			for (const clip of replacements) {
				expect(clip.startFrame).toBe(startFrame);
				expect(clip.durationFrames).toBe(endFrame - startFrame);
				expect(clip.startFrame).toBeGreaterThan(0);
				expect(clip.durationFrames).toBeLessThan(initial.clips[0].durationFrames);
				expect(clip.startFrame + clip.durationFrames).toBeLessThan(initial.clips[0].durationFrames);
			}
			expect(applied.mutedAudioTrackCount).toBe(0);
			expect(applied.audioTrackCount).toBe(initial.audioTrackCount + names.length - 1);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect.poll(() => storedAudioSummary(page, projectId)).toEqual(initial);
		}
		expect(errors).toEqual([]);
	});

	test('applies a shared range on multiple tracks as one undoable edit', async ({ page }) => {
		test.setTimeout(120_000);
		const companion = createWavFixture({
			name: 'assistance-second-track.wav', frequency: 440, duration: 4, channelCount: 1,
		});
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installMilestone7LocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/');
		await importFiles(editor, [AUDIO, companion], { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id');
		const initial = await storedAudioSummary(page, projectId);
		acceptConsentDialogs(page);
		await selectClipRange(page, editor, clipByName(editor, AUDIO.name).first(), 0.25, 0.75);
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
		await openAssistanceTask(page, editor, 'Enhance Dialogue');
		const processing = page.getByRole('dialog', { name: 'Enhance Dialogue', exact: true });
		await expect(processing.getByRole('progressbar', { name: 'Processing status' })).toBeVisible();
		await expect.poll(() => milestone7FixtureSnapshot(page).then(({ progressEvents }) => progressEvents)).toBe(1);
		await completeMilestone7Run(page);
		await expect.poll(() => milestone7FixtureSnapshot(page).then(({ progressEvents }) => progressEvents)).toBe(2);
		expect(await storedAudioSummary(page, projectId)).toEqual(initial);
		await completeMilestone7Run(page);
		await expect(processing).toBeHidden();
		await expect.poll(() => storedAudioSummary(page, projectId)).toMatchObject({
			audioTrackCount: initial.audioTrackCount,
			clipSourceNames: [AUDIO.name, AUDIO.name, companion.name, companion.name,
				'Enhanced Dialogue', 'Enhanced Dialogue'].sort(),
			mutedAudioTrackCount: 0,
			projectBinClipCount: initial.projectBinClipCount,
		});
		const applied = await storedAudioSummary(page, projectId);
		expect(applied.clips.filter(({ sourceName }) => sourceName === 'Enhanced Dialogue')
			.map(({ trackName }) => trackName).sort()).toEqual(initial.clips.map(({ trackName }) => trackName).sort());
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedAudioSummary(page, projectId)).toEqual(initial);
		expect(errors).toEqual([]);
	});
});

async function selectSource(editor, page) {
	const clip = clipByName(editor, AUDIO.name).first();
	await expect(clip).toBeVisible();
	await clip.focus();
	await page.keyboard.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
}

function acceptConsentDialogs(page) {
	page.on('dialog', async (dialog) => {
		expect(dialog.type()).toBe('confirm');
		await dialog.accept();
	});
}

async function runAndReview(page, editor, task) {
	await openAssistanceTask(page, editor, task);
	return runSelectedAndReview(page, page.locator('[data-local-assistance]'));
}

async function runSelectedAndReview(page, assistance) {
	await assistance.getByRole('button', { name: /^(?:Apply|Analyze)$/u }).click();
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toHaveText('Processing selected media locally');
	await completeMilestone7Run(page);
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toContainText('Processing finished.');
	await assistance.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = assistance.getByRole('region', { name: 'Guided workflow review', exact: true });
	await expect(review).toBeVisible();
	return review;
}

async function applyAndClose(page) {
	const assistance = page.locator('[data-local-assistance]');
	await assistance.getByRole('button', { name: 'Apply selected', exact: true }).click();
	await expect(assistance.getByRole('status', { name: 'Processing status' }))
		.toHaveText('The proposal was accepted.');
	await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
	await expect(assistance).toBeHidden();
}

async function acceptedProjectSummary(page, projectId) {
	return page.evaluate(async ({ databaseName, id, sourceName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const labels = (name) => project.tracks.find((track) => track.name === name)?.labels ?? [];
			const source = project.sources.find(({ name }) => name === sourceName);
			return {
				assistanceSourceNames: project.sources
					.filter(({ name }) => name === 'Enhanced Dialogue').map(({ name }) => name),
				beatLabels: labels('Beats').map(({ title }) => title),
				cleanupClipCount: project.clips.filter(({ sourceId }) => sourceId === source?.id).length,
				reactionLabels: labels('Reactions').map(({ title }) => title),
				tempoBpm: project.tempoMap?.events?.[0]?.bpm,
			};
		} finally {
			database.close();
		}
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId, sourceName: AUDIO.name });
}

async function storedAudioSummary(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(database.transaction('projects', 'readonly')
				.objectStore('projects').get(id));
			const audioTracks = project.tracks.filter(({ type }) => type === 'audio');
			return {
				audioTrackCount: audioTracks.length,
				mutedAudioTrackCount: audioTracks.filter(({ mute }) => mute).length,
				clipSourceNames: project.clips.map(({ sourceId }) => project.sources
					.find(({ id: candidate }) => candidate === sourceId)?.name).sort(),
				clips: project.clips.map(({ id: clipId, sourceId, timelineStartFrame, durationFrames }) => ({
					trackName: project.tracks.find(({ clipIds }) => clipIds?.includes(clipId))?.name,
					sourceName: project.sources.find(({ id: candidate }) => candidate === sourceId)?.name,
					startFrame: timelineStartFrame, durationFrames,
				})),
				projectBinClipCount: project.projectBin.clips.length,
			};
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}
