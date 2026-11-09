/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	addTrackAutomation,
	addTrackRackEffect,
	authorClipGainPoint,
	clipCount,
	clipProcessingState,
	copyClipAndPaste,
	deleteClipRange,
	duplicateClip,
	editClipProperties,
	expectContiguousSourceClips,
	persistedClipsByName,
	persistedProject,
	selectClipHeader,
	setTrackMuteSolo,
	splitClip,
	trackCount,
	trackRow,
	waitForSaved,
} from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const sessions = [
	{
		name: 'tightens two-track dialogue with a ripple delete before inserting copied room tone',
		run: dialogueRippleSession,
	},
	{
		name: 'keeps a cut sound-design layer pasteable through undo and redo after both sources are split',
		run: soundDesignClipboardSession,
	},
	{
		name: 'performs an all-track ripple cleanup before auditioning and processing a live multitrack take',
		run: liveMultitrackCleanupSession,
	},
	{
		name: 'keeps a muted safety duplicate while replacing part of a three-track edit and automating the bed',
		run: safetyDuplicateReplacementSession,
	},
];

test.describe('realistic multitrack arrangement sessions', () => {
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(120_000);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await session.run(page, editor);
			await waitForSaved(editor);
			expect(errors).toEqual([]);
		});
	}
});

async function dialogueRippleSession(page, editor) {
	await importFiles(editor, [longTone, toneA]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const dialogue = clipByName(editor, longTone.name);
	const roomTone = clipByName(editor, toneA.name);
	await editClipProperties(page, editor, dialogue, {
		sourceInFrame: 9_600,
		durationFrame: 307_200,
		fadeInFrame: 1_200,
		fadeOutFrame: 2_400,
	});
	const dialogueTrackId = await trackRow(dialogue).getAttribute('data-track-id');
	expect(dialogueTrackId).toBeTruthy();
	const dialogueRow = editor.locator(`[data-track-row][data-track-id="${dialogueTrackId}"]`);
	const automation = await addTrackAutomation(page, editor, dialogueRow, { parameter: 'Pan', nudge: -1 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await deleteClipRange(page, editor, dialogue, {
		start: 0.3,
		end: 0.45,
		mode: 'Delete and close gap per track',
	});
	await expect(dialogueRow.locator('[data-clip-id]')).toHaveCount(2);
	await expectContiguousSourceClips(page, projectId, longTone.name, 2);
	const [persistedRoomTone] = await persistedClipsByName(page, projectId, toneA.name);
	expect(persistedRoomTone.timelineStartFrame).toBe(0);
	const firstSurvivor = dialogueRow.locator('[data-clip-id]').first();
	await authorClipGainPoint(page, editor, firstSurvivor, 0.4);
	const beforeInsert = await clipCount(editor);
	await copyClipAndPaste(page, editor, roomTone, 'Insert');
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	await chooseTrackMenuAction(page, editor, dialogueRow, 'Add automation');
	const reopenedControls = dialogueRow.locator('[data-track-automation-controls]');
	await expect(reopenedControls).toBeVisible();
	const parameter = reopenedControls.getByRole('combobox', {
		name: 'Automation parameter', exact: true,
	});
	await parameter.selectOption({ label: 'Pan' });
	await expect(parameter.locator('option:checked')).toHaveText('Pan');
	const reopenedOverlay = dialogueRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
	const remainingPointIds = await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	expect(remainingPointIds).toEqual(expect.arrayContaining(pointIds));
}

async function soundDesignClipboardSession(page, editor) {
	await importFiles(editor, [toneA, toneB]);
	const impact = clipByName(editor, toneA.name);
	const tail = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, impact, {
		sourceInFrame: 1_200,
		durationFrame: 34_800,
		fadeInFrame: 600,
		fadeOutFrame: 3_600,
		gain: 2,
	});
	const impactRow = trackRow(impact);
	const tailRow = trackRow(tail);
	await splitClip(page, editor, impact, 0.36);
	await splitClip(page, editor, tail, 0.64);
	await expect(impactRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(tailRow.locator('[data-clip-id]')).toHaveCount(2);
	const target = impactRow.locator('[data-clip-id]').last();
	const targetId = await target.getAttribute('data-clip-id');
	await selectClipHeader(target);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut and leave gap']);
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toHaveCount(0);
	const beforePaste = await clipCount(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', String(beforePaste + 1));
	const panel = await addTrackRackEffect(page, editor, tailRow, 'Invert');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Invert', exact: true,
	})).toBeVisible();
}

async function liveMultitrackCleanupSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const guide = clipByName(editor, longTone.name);
	const left = clipByName(editor, toneA.name);
	const right = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, guide, {
		sourceInFrame: 4_800,
		durationFrame: 336_000,
		fadeInFrame: 2_400,
		fadeOutFrame: 4_800,
	});
	const guideRow = trackRow(guide);
	const leftRow = trackRow(left);
	const rightRow = trackRow(right);
	const automation = await addTrackAutomation(page, editor, guideRow, { nudge: 2 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await authorClipGainPoint(page, editor, guide, 0.16);
	await deleteClipRange(page, editor, guide, {
		start: 0.04,
		end: 0.075,
		mode: 'Delete and close gap on all tracks',
	});
	await expect(guideRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(leftRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(rightRow.locator('[data-clip-id]')).toHaveCount(2);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const [guideClips, leftClips, rightClips] = await Promise.all([
		expectContiguousSourceClips(page, projectId, longTone.name, 2),
		expectContiguousSourceClips(page, projectId, toneA.name, 2),
		expectContiguousSourceClips(page, projectId, toneB.name, 2),
	]);
	expect([guideClips[1], leftClips[1], rightClips[1]].map(({ timelineStartFrame }) => (
		timelineStartFrame
	))).toEqual(Array(3).fill(guideClips[1].timelineStartFrame));
	await setTrackMuteSolo(leftRow, { mute: true });
	await setTrackMuteSolo(rightRow, { solo: true });
	await chooseTrackMenuAction(page, editor, guideRow, 'Add automation');
	const reopenedOverlay = guideRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
	const ripplePointIds = await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	expect(ripplePointIds).toEqual(expect.arrayContaining(pointIds));
	expect(ripplePointIds.length).toBeGreaterThan(pointIds.length);
	const panel = await addTrackRackEffect(page, editor, guideRow, 'Invert');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Invert', exact: true,
	})).toBeVisible();
}

async function safetyDuplicateReplacementSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const bed = clipByName(editor, longTone.name);
	const lead = clipByName(editor, toneA.name);
	const replacement = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, lead, {
		sourceInFrame: 2_400,
		durationFrame: 32_400,
		fadeInFrame: 2_400,
		fadeOutFrame: 2_400,
		gain: -1,
	});
	const safety = await duplicateClip(page, editor, lead);
	const safetyRow = trackRow(safety);
	await setTrackMuteSolo(safetyRow, { mute: true });
	const bedRow = trackRow(bed);
	const bedTrackId = await bedRow.getAttribute('data-track-id');
	expect(bedTrackId).toBeTruthy();
	const automation = await addTrackAutomation(page, editor, bedRow, { nudge: -1 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await authorClipGainPoint(page, editor, replacement, 0.48);
	await selectClipHeader(replacement);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await waitForSaved(editor);
	const [replacementBeforePaste] = await persistedClipsByName(page, projectId, toneB.name);
	const tracksBeforeSourceRemoval = await trackCount(editor);
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await expect(editor).toHaveAttribute('data-track-count', String(tracksBeforeSourceRemoval - 1));
	await expect.poll(async () => (
		await persistedClipsByName(page, projectId, toneB.name)
	).length).toBe(0);
	await splitClip(page, editor, bed, 0.4);
	await expect(bedRow.locator('[data-clip-id]')).toHaveCount(2);
	let bedParts = [];
	await expect.poll(async () => {
		bedParts = await persistedClipsByName(page, projectId, longTone.name);
		return bedParts.length;
	}).toBe(2);
	const tailBeforeDelete = bedParts.at(-1);
	expect(tailBeforeDelete).toBeTruthy();
	const tail = editor.locator(`[data-clip-id="${tailBeforeDelete.id}"]`);
	await expect(tail).toBeVisible();
	await deleteClipRange(page, editor, tail, {
		start: 0.18,
		end: 0.36,
		mode: 'Delete and close gap per clip',
	});
	await expectContiguousSourceClips(page, projectId, longTone.name, 3);
	await chooseTrackMenuAction(page, editor, bedRow, 'Add automation');
	const reopenedOverlay = bedRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]'))
		.toHaveCount(pointIds.length);
	expect(await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	)).toEqual(pointIds);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const pasteFrame = Number(await playhead.getAttribute('aria-valuenow'));
	expect(pasteFrame).toBeGreaterThan(tailBeforeDelete.timelineStartFrame);
	expect(pasteFrame).toBeLessThan(tailBeforeDelete.timelineStartFrame + tailBeforeDelete.durationFrames);
	const beforeInsert = await clipCount(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert']);
	const mixDown = page.getByRole('dialog', { name: 'Mix down to mono', exact: true });
	await expect(mixDown).toBeVisible();
	await mixDown.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(mixDown).toBeHidden();
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	let pastedReplacement = null;
	await expect.poll(async () => {
		pastedReplacement = (await persistedClipsByName(page, projectId, toneB.name))
			.find(({ id }) => id !== replacementBeforePaste.id) ?? null;
		return pastedReplacement?.timelineStartFrame ?? null;
	}).not.toBeNull();
	expect(pastedReplacement.timelineStartFrame).toBe(pasteFrame);
	expect(clipProcessingState(pastedReplacement)).toEqual(clipProcessingState(replacementBeforePaste));
	expect(pastedReplacement.sourceId).not.toBe(replacementBeforePaste.sourceId);
	const replacementOwner = (await persistedProject(page, projectId)).tracks
		.find((track) => track.clipIds?.includes(pastedReplacement.id));
	expect(replacementOwner?.id).toBe(bedTrackId);
	const panel = await addTrackRackEffect(page, editor, bedRow, 'Reverb');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Reverb', exact: true,
	})).toBeVisible();
	await expect(safetyRow.getByRole('button', { name: 'Mute', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
}
