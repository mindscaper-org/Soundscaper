/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation, clipByName, openEffectsForTrack, commitInput } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../../src/common/editor/automation-lane-v21.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const gesture of ['none', 'master', 'rack']) test(`muted folder remains silent after live ${gesture} commit and Pause/Play`, async ({ page }) => {
	await installNativeOutputPeer(page);
	const fixture = await programme(gesture === 'rack');
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Folder.sscape', mimeType: 'application/zip', buffer: fixture.bytes });
	await expect(editor).toHaveAttribute('data-project-id', fixture.project.id);
	await waitForProjectActivation(editor);
	const clip = clipByName(editor, 'Programme');
	await clip.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, clip.locator('xpath=ancestor::*[@data-track-row][1]'), 'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]');
	await expect(folder).toHaveCount(1);
	const mute = folder.getByRole('button', { name: 'Mute folder', exact: true });
	await mute.click();
	await expect(mute).toHaveAttribute('aria-pressed', 'true');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Speakers', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__nativeOutput.packets)).toBeGreaterThan(12);
	expect(await nativeRms(page)).toBeLessThan(.00001);
	if (gesture === 'master') {
		const fader = editor.locator('.kw-audio-editor__mixer-channel--master').getByRole('slider', { name: /volume$/u });
		await expect(fader).toBeEnabled();
		const before = await fader.getAttribute('aria-valuenow');
		await fader.press('ArrowDown');
		await expect(fader).not.toHaveAttribute('aria-valuenow', before);
	}
	if (gesture === 'rack') {
		const panel = await openEffectsForTrack(editor, 0);
		const slot = panel.locator('[data-effect-rack]').getByRole('group', { name: 'Tremolo', exact: true });
		await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await commitInput(dialog.locator('[data-effect-param="depth"]').getByRole('spinbutton'), '50');
		await expect(dialog.locator('[data-effect-param="depth"]').getByRole('spinbutton')).toHaveValue('50');
	}
	await editor.getByRole('button', { name: 'Pause', exact: true }).click();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const packetFence = await page.evaluate(() => window.__nativeOutput.packets);
	await expect.poll(() => page.evaluate(() => window.__nativeOutput.packets)).toBeGreaterThan(packetFence + 12);
	const rms = await nativeRms(page);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(rms, 'the child mute=0 lane must remain behind its authored folder mute').toBeLessThan(.00001);
	await expect(mute).toHaveAttribute('aria-pressed', 'true');
	await mute.click();
	await expect(mute).toHaveAttribute('aria-pressed', 'false');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => nativeRms(page)).toBeGreaterThan(.03);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
});

function nativeRms(page) {
	return page.evaluate(() => Math.max(0, ...window.__nativeOutput.channelRms));
}

async function programme(tremolo) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 240_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'folder-custody', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Programme', sourceId: source.id, durationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', name: 'Programme', clipIds: ['clip'], effects: tremolo
			? [{ id: 'tremolo', type: 'tremolo', enabled: true, params: { depth: 40 } }] : [] })],
		automationLanes: [normalizeAutomationLaneV21({ id: 'mute',
			address: { kind: 'strip', strip: { kind: 'track', id: 'track' }, parameterId: 'mute' },
			timebase: 'absolute-samples', points: [{ id: 'zero', position: 0, value: 0 }], segments: [] })],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let frame = 0; frame < source.frameCount; frame += source.chunkFrames) {
			await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - frame) },
				(_, index) => .2 * Math.sin(2 * Math.PI * 440 * (frame + index) / source.sampleRate))]);
		}
		await writer.commit();
		return { project, bytes: Buffer.from(await (await exportScapeProject(project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}
