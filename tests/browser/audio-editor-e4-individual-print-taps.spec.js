/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const [position, gain, mixDown, width = 2, control = 'plain'] of [['pre-fader', .5, false], ['post-fader', .5, false], ['pre-fader', 1, false], ['pre-fader', .5, true], ['pre-fader', .5, false, 1], ['pre-fader', .5, false, 'mixed'], ['pre-fader', .5, false, 6], ['pre-fader', .5, false, 2, 'automation'], ['pre-fader', .5, false, 2, 'sibling'], ['pre-fader', .5, false, 1, 'reverb'], ['pre-fader', .5, false, 2, 'reverb']]) test(`${mixDown ? 'Combined' : 'Individual'} print preserves ${position} send at fader ${gain} width ${width} ${control}`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', name: 'Recording', sampleRate: 48_000, frameCount: 48_000, channelCount: typeof width === 'number' ? width : 2 });
	const extra = width === 'mixed' ? createAudioSource({ id: 'mono', name: 'Mono', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 }) : null;
	const base = createSoundscaperProject({ id: `print-taps-${position}-${gain}-${mixDown}`, sources: extra ? [source, extra] : [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain, pan: control === 'sibling' ? .4 : 0, ...(control === 'reverb' ? { effects: [{ id: 'verb', type: 'reverb', enabled: true, params: { mix: .3, decay: .1, preDelay: 0 } }] } : {}), clipIds: extra ? ['clip', 'mono-clip'] : ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 48_000, durationFrames: 48_000 }), ...(extra ? [createAudioClip({ id: 'mono-clip', sourceId: extra.id, timelineStartFrame: 48_000, sourceDurationFrames: 48_000, durationFrames: 48_000 })] : [])] });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer,
		sends: [{ id: 'aux', name: 'Aux', color: '#456789', channelCount: 2, gain: 1, pan: 0, mute: false, solo: false, collapsed: false, effectsActive: true, effects: [] }],
		edges: [...base.mixer.edges,
			{ id: 'aux-send', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'aux' }, position, level: .2, enabled: true, channelMap: width === 1 ? [0, 0] : [0, 1] },
			{ id: 'aux-return', kind: 'assignment', source: { kind: 'mixer-node', id: 'aux' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }],
	}, ...(control === 'automation' ? { automationLanes: [{ id: 'gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'gain-start', position: 0, value: .25 }], segments: [] }, { id: 'pan', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' }, timebase: 'absolute-samples', points: [{ id: 'pan-start', position: 0, value: .4 }], segments: [] }] } : {}) });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const pcm = Float32Array.from({ length: source.frameCount }, (_, frame) => frame < 480 || frame >= 47_520 ? 0 : .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
		await writer.write(Array.from({ length: source.channelCount }, () => pcm)); await writer.commit();
		if (extra) { const monoWriter = await store.beginSourceWrite(extra.storageKey, extra); await monoWriter.write([pcm]); await monoWriter.commit(); } blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Print.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	const peak = samples => Math.max(...samples.slice(9600, 28800).map(Math.abs));
	if (control === 'plain') expect(Math.abs(peak(before) - .25 * ((control === 'automation' ? .25 : gain) * (width === 1 ? Math.SQRT1_2 : 1) + (position === 'pre-fader' ? .2 : gain * .2)))).toBeLessThan(.0001);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	if (!mixDown) await dialog.getByRole('checkbox', { name: 'Mix down', exact: true }).click();
	if (control === 'sibling') await dialog.getByRole('checkbox', { name: 'Replace originals', exact: true }).click();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	const refused = width === 'mixed' || width === 1 && control === 'reverb';
	if (refused) {
		await expect(dialog.getByRole('alert')).toContainText(width === 'mixed' ? 'changing channel widths' : 'mono track with stereo reverb');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	} else await expect(dialog).toBeHidden();
	const after = await exportSamples(page, editor);
	console.log('individual print tap amplitudes', { position, gain, mixDown, before: peak(before), after: peak(after), beforeLength: before.length, afterLength: after.length });
	expect(after).toHaveLength(before.length);
	expect(after.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - before[frame] * (control === 'sibling' ? 2 : 1))), 0)).toBeLessThan(.0001);
	if (refused) return;
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor);
	expect(undone.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - before[frame])), 0)).toBeLessThan(.0001);
});

async function exportSamples(page, editor) {
	const dialog = await openExportDialog(page, editor);
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const samples = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
			const result = [];
			for (let frame = 0; frame < audio.length; frame += 1) for (const channel of channels) result.push(channel[frame]);
			return result;
		} finally { await context.close(); }
	}, Array.from(bytes));
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return samples;
}
