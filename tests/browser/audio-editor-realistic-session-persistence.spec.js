/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import { showClipTimingFields,
	bootEditor,
	chooseCommandAction,
	clipByName, closeClipProperties,
	closeEffectsPanel,
	collectClientErrors,
	importFiles,
	openClipProperties,
	openEffectsForTrack,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, expectClipMediaSettingChecked } from './audio-editor-clip-settings-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import {
	addClipGainPoint,
	addTrackAutomation,
	addTrackRackEffect,
	clipDurationFrames,
	deleteWholeClip,
	editClipProperties,
	persistedProject,
	revealTimelineClip,
	selectClipHeader,
	setProjectTempo,
	splitClip,
} from './helpers/complex-editing-workflows.js';

test.use({ viewport: { width: 1_600, height: 1_000 } });

// Node checks all ten editorial variants through actual controller history and store/Scape reopen.
const sessions = [
	{ name: 'duplicated processed track retains the original automated source', action: 'duplicate-track', tempo: 90, split: 0.47 },
	{ name: 'reversed and inverted phrase preserves its mixed automation state', action: 'reverse-invert', tempo: 132, split: 0.56 },
	{ name: 'removed accent restored by undo survives as part of the session', action: 'accent-delete-undo', tempo: 108, split: 0.33 },
];

test.describe('realistic mixed-state session persistence', () => {
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(150_000);
			const errors = collectClientErrors(page);
			let editor = await bootEditor(page, '/en/');
			const projectId = await editor.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();
			await importFiles(editor, [longTone], { timeout: 45_000 });
			let clip = clipByName(editor, longTone.name);
			await editClipProperties(page, editor, clip, {
				sourceInFrame: 4_800,
				durationFrame: 288_000,
				gain: -2,
				fadeInFrame: 4_800,
				fadeOutFrame: 9_600,
				stretchToTempo: session.tempo % 2 === 0,
			});
			await addClipGainPoint(page, editor, clip, 0.24);
			await addClipGainPoint(page, editor, clip, 0.71);
			let row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
			const sourceTrackId = await row.getAttribute('data-track-id');
			expect(sourceTrackId).toBeTruthy();
			row = editor.locator(`[data-track-row][data-track-id="${sourceTrackId}"]`);
			let clips = await splitClip(page, editor, clip, session.split);
			await addTrackAutomation(page, editor, row, {
				mode: 'read',
				nudge: session.tempo % 3 - 1,
			});
			const panel = await addTrackRackEffect(page, editor, row, 'Invert');
			await closeEffectsPanel(panel);
			await setProjectTempo(page, editor, session.tempo);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			const revisionEvidence = await applyEditorialRevision(
				page, editor, row, clips, session.action, projectId,
			);
			if (!await row.locator('[data-track-automation-controls]').isVisible()) {
				await chooseTrackMenuAction(page, editor, row, 'Add automation');
			}
			const clipCount = await editor.getAttribute('data-clip-count');
			const trackCount = await editor.getAttribute('data-track-count');
			// Duplicate keeps a valid multi-selection; reading one clip's native
			// duration requires picking that header rather than seeking with Enter.
			await selectClipHeader(clipByName(editor, longTone.name).first());
			const editedDuration = await clipDurationFrames(
				page,
				editor,
				clipByName(editor, longTone.name).first(),
			);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			const projectBeforeReload = await persistedProject(page, projectId);
			const automationPointIds = projectBeforeReload.automationLanes
				.filter((lane) => lane.address?.strip?.id === sourceTrackId)
				.flatMap((lane) => lane.points.map(({ id }) => id));
			expect(automationPointIds).not.toHaveLength(0);

			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await expect(editor).toHaveAttribute('data-clip-count', clipCount);
			await expect(editor).toHaveAttribute('data-track-count', trackCount);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await expect.poll(() => persistedProject(page, projectId)).toEqual(projectBeforeReload);
			await expect(editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true }))
				.toHaveValue(String(session.tempo));
			clip = clipByName(editor, longTone.name).first();
			// Verify the restored selection above before picking one clip for its individual fields.
			await selectClipHeader(clip);
			await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(1);
			expect(await clipDurationFrames(page, editor, clip)).toBe(editedDuration);

			row = editor.locator(`[data-track-row][data-track-id="${sourceTrackId}"]`);
			await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
			await chooseTrackMenuAction(page, editor, row, 'Add automation');
			const restoredPoints = row.locator('[data-track-automation-overlay] [data-automation-point-id]');
			await expect(restoredPoints).toHaveCount(automationPointIds.length);
			const restoredPointIds = await restoredPoints.evaluateAll(
				(nodes) => nodes.map((node) => node.dataset.automationPointId),
			);
			expect(restoredPointIds).not.toHaveLength(0);
			expect(restoredPointIds).toEqual(expect.arrayContaining(automationPointIds));
			const rowIndex = await trackRowIndex(editor, row);
			const restoredPanel = await openEffectsForTrack(editor, rowIndex);
			await expect(restoredPanel.locator('[data-effect-rack]').getByRole('group', {
				name: 'Invert',
				exact: true,
			})).toBeVisible();
			await assertRestoredRevision(page, editor, row, session.action, revisionEvidence);
			expect(errors).toEqual([]);
		});
	}
});

async function applyEditorialRevision(page, editor, row, clips, action, projectId) {
	const beforeClips = Number(await editor.getAttribute('data-clip-count'));
	const evidence = {};
	switch (action) {
		case 'duplicate-track':
			evidence.sourceTrackId = await row.getAttribute('data-track-id');
			evidence.trackIdsBefore = (await persistedProject(page, projectId)).tracks
				.map(({ id }) => id);
			await clips.first().locator('.clip-header').click();
			await chooseCommandAction(page, editor, 'Tracks', 'Duplicate track');
			await expect(editor).toHaveAttribute('data-clip-count', String(beforeClips * 2));
			await expect.poll(async () => (await persistedProject(page, projectId)).tracks.length)
				.toBe(evidence.trackIdsBefore.length + 1);
			evidence.duplicateTrackId = (await persistedProject(page, projectId)).tracks
				.find(({ id }) => !evidence.trackIdsBefore.includes(id))?.id;
			assertDuplicatedTrackState(await persistedProject(page, projectId), evidence);
			break;
		case 'reverse-invert': {
			const clipId = await clips.last().getAttribute('data-clip-id');
			const dialog = await openClipProperties(page, editor, clips.last());
			await showClipTimingFields(dialog);
			await dialog.getByRole('switch', { name: 'Reverse', exact: true }).click();
			await chooseClipMediaSetting(dialog, 'Invert');
			await closeClipProperties(dialog);
			evidence.clipId = clipId;
			break;
		}
		case 'accent-delete-undo': {
			await importFiles(editor, [toneA]);
			const accent = clipByName(editor, toneA.name);
			await deleteWholeClip(page, editor, accent);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(clipByName(editor, toneA.name)).toBeVisible();
			break;
		}
		default:
			throw new RangeError(`Unknown editorial revision: ${action}`);
	}
	return evidence;
}

async function assertRestoredRevision(page, editor, row, action, evidence) {
	if (action === 'reverse-invert') {
		expect(evidence.clipId).toBeTruthy();
		await revealTimelineClip(page, editor, evidence.clipId);
		const dialog = await openClipProperties(
			page, editor, editor.locator(`[data-clip-id="${evidence.clipId}"]`),
		);
		await showClipTimingFields(dialog);
		await expect(dialog.getByRole('switch', { name: 'Reverse', exact: true })).toHaveAttribute('aria-checked', 'true');
		await expectClipMediaSettingChecked(dialog, 'Invert', true);
		await closeClipProperties(dialog);
	}
	if (action === 'accent-delete-undo') {
		await expect(clipByName(editor, toneA.name)).toBeVisible();
	}
	if (action === 'duplicate-track') {
		assertDuplicatedTrackState(await persistedProject(
			page, await editor.getAttribute('data-project-id'),
		), evidence);
	}

}

function assertDuplicatedTrackState(project, evidence) {
	const sourceTrack = project.tracks.find(({ id }) => id === evidence.sourceTrackId);
	const duplicateTrack = project.tracks.find(({ id }) => id === evidence.duplicateTrackId);
	expect(sourceTrack).toBeTruthy();
	expect(duplicateTrack).toBeTruthy();
	expect(duplicateTrack.effects.map(({ id, ...effect }) => effect))
		.toEqual(sourceTrack.effects.map(({ id, ...effect }) => effect));
	const laneState = (trackId) => project.automationLanes
		.filter((lane) => lane.address?.strip?.id === trackId)
		.map(({ id, address, points, ...lane }) => ({
			...lane,
			address: { ...address, strip: { ...address.strip, id: '<track>' } },
			points: points.map(({ id: pointId, ...point }) => point),
		}));
	expect(laneState(duplicateTrack.id)).toEqual(laneState(sourceTrack.id));
}

async function trackRowIndex(editor, row) {
	const trackId = await row.getAttribute('data-track-id');
	const index = await editor.locator('[data-track-row]').evaluateAll(
		(nodes, id) => nodes.findIndex((node) => node.dataset.trackId === id),
		trackId,
	);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}
