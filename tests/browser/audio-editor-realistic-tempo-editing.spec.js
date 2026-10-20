/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	addClipGainPoint,
	addTrackAutomation,
	clipDurationFrames,
	editClipProperties,
	setProjectTempo,
	splitClip,
} from './helpers/complex-editing-workflows.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const sessions = [
	{
		name: 'music-bed pickup trim, gain ride, verse split, and slower client tempo',
		tempo: 92, sourceInFrame: 2_400, durationFrame: 240_000, split: 0.42,
		gain: -2.5, fadeInFrame: 4_800, fadeOutFrame: 9_600, points: [0.2, 0.72],
		stretchToTempo: true, mode: 'read', nudge: 2,
	},
	{
		name: 'podcast cold-open cleanup, sponsor split, and revised scoring tempo',
		tempo: 108, sourceInFrame: 4_800, durationFrame: 264_000, split: 0.35,
		gain: -1.25, fadeInFrame: 2_400, fadeOutFrame: 7_200, points: [0.16, 0.61],
		stretchToTempo: false, mode: 'touch', nudge: -1, addAccent: true,
	},
	{
		name: 'dialogue pre-roll trim, breath split, clip envelope, and faster rehearsal tempo',
		tempo: 132, sourceInFrame: 7_200, durationFrame: 216_000, split: 0.28,
		gain: 1.5, fadeInFrame: 1_200, fadeOutFrame: 3_600, points: [0.12, 0.48],
		stretchToTempo: true, mode: 'trim', nudge: 1,
	},
];

test.describe('realistic tempo editing sessions', () => {
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(120_000);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/en/');
			const projectId = await editor.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();
			await importFiles(editor, [longTone], { timeout: 45_000 });
			const clip = clipByName(editor, longTone.name);
			await editClipProperties(page, editor, clip, {
				sourceInFrame: session.sourceInFrame,
				durationFrame: session.durationFrame,
				gain: session.gain,
				fadeInFrame: session.fadeInFrame,
				fadeOutFrame: session.fadeOutFrame,
				stretchToTempo: session.stretchToTempo,
			});
			for (const point of session.points) await addClipGainPoint(page, editor, clip, point);
			const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
			const clips = await splitClip(page, editor, clip, session.split);
			await expect(clips).toHaveCount(2);
			const leftDurationBeforeTempo = await clipDurationFrames(page, editor, clips.first());
			const automation = await addTrackAutomation(page, editor, row, {
				mode: session.mode,
				nudge: session.nudge,
			});
			await expect(automation.overlay.locator('[data-automation-point-id]')).toHaveCount(2);
			if (session.addAccent) {
				await importFiles(editor, [toneA], { timeout: 45_000 });
				await expect(clipByName(editor, toneA.name)).toBeVisible();
			}
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 15_000,
			});
			const authoredState = await persistedAuthoredState(page, projectId);
			await setProjectTempo(page, editor, session.tempo);
			const leftDurationAfterTempo = await clipDurationFrames(page, editor, clips.first());
			// Imported media remains sample-anchored. Changing the musical map must
			// leave its destructive trim and split boundaries exactly where they were.
			expect(leftDurationAfterTempo).toBe(leftDurationBeforeTempo);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 15_000,
			});
			expect(await persistedAuthoredState(page, projectId)).toEqual(authoredState);
			expect(errors).toEqual([]);
		});
	}
});

async function persistedAuthoredState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				const project = request.result;
				resolve({
					automation: (project?.automationLanes ?? []).map((lane) => ({
						id: lane.id,
						points: lane.points,
						segments: lane.segments,
					})),
					envelopes: (project?.clips ?? []).map((clip) => ({
						id: clip.id,
						envelope: clip.envelope,
					})),
				});
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
}
