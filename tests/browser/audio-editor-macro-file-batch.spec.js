/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

function recordings() {
	const reference = createWavFixture({ name: 'jingle.wav', frequency: 0, duration: .1, channelCount: 1 });
	let seed = 11;
	for (let frame = 0; frame < 4800; frame++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		reference.buffer.writeInt16LE(Math.round((seed / 2 ** 32 - .5) * 18000), 44 + frame * 2);
	}
	const episodes = ['episode-one.wav', 'episode-two.wav'].map(name => {
		const file = createWavFixture({ name, frequency: 0, duration: 8, channelCount: 1 });
		for (const offset of [24_000, 312_000]) reference.buffer.copy(file.buffer, 44 + offset * 2, 44);
		return file;
	});
	return [...episodes, reference];
}

async function desktopFiles(page, inputs, cancelReference = false) {
	await installDesktopSpeedWarmupManifest(page);
	await page.route('**/macro-input/*', async route => {
		const index = Number(route.request().url().split('/').at(-1));
		await route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'content-length': String(inputs[index].buffer.length) }, body: inputs[index].buffer });
	});
	await page.addInitScript(({ files, cancelReference }) => {
		const writes = new Map(), outputs = [], state = { outputs, referencePicks: 0, folderReleased: false, names: [] };
		globalThis.__macroBatchFiles = state;
		const descriptor = index => ({ id: String(index + 1).repeat(64), name: files[index].name,
			readProfile: 'materialized-v1', size: files[index].size, mimeType: 'audio/wav', url: `${location.origin}/macro-input/${index}` });
		globalThis.soundscaperDesktop = { v1: {
			chooseFiles: async request => {
				if (request.multiple) return [descriptor(0), descriptor(1)];
				state.referencePicks++; return cancelReference ? [] : [descriptor(2)];
			},
			releaseRead: async () => true, releaseOriginalFile: async () => true, releaseSaveTarget: async () => true,
			chooseBatchSaveDirectory: async request => { state.names = request.suggestedNames; return { id: 'a'.repeat(48), name: 'Outputs', files: state.names }; },
			prepareBatchSaveTarget: async request => ({ id: String(request.index + 1).repeat(48), name: state.names[request.index] }),
			releaseBatchSaveDirectory: async () => { state.folderReleased = true; return true; },
			beginWrite: async request => {
				const writeId = request.targetId.slice(0, 32); writes.set(writeId, { id: request.targetId, bytes: [] });
				return { writeId, chunkSize: 1024 * 1024 };
			},
			writeChunk: async request => {
				const write = writes.get(request.writeId), bytes = Array.from(new Uint8Array(request.bytes));
				if (request.offset !== write.bytes.length) throw new Error('Nonsequential output');
				write.bytes = write.bytes.concat(bytes); return { nextOffset: write.bytes.length };
			},
			patchFinalPrefix: async request => { const write = writes.get(request.writeId); const bytes = new Uint8Array(request.bytes); for (let i = 0; i < bytes.length; i++) write.bytes[i] = bytes[i]; },
			finishWrite: async writeId => { const write = writes.get(writeId); outputs.push(write); writes.delete(writeId); return { byteLength: write.bytes.length }; },
			abortWrite: async writeId => { writes.delete(writeId); },
		} };
	}, { files: inputs.map(file => ({ name: file.name, size: file.buffer.length })), cancelReference });
}

const source = [
	"const reference = await sound.input.audio('jingle');",
	'const result = await sound.analyze.repeatedSound({ referenceInput: reference.key, similarityThreshold: .98 });',
	'sound.assertEqual(result.matches.length, 2);',
	'await sound.select.frames(result.matches[0].endFrame, result.matches[1].startFrame, { trackIds: [result.sourceTrackId] });',
	'await sound.edit.deleteAndCloseGap();',
	'await sound.select.frames(0, 0, { trackIds: [result.trackId] });',
	"await sound.command('RemoveTracks');",
].join('\n');

test('desktop manager applies a program to separate files and reuses its chosen reference audio', async ({ page }) => {
	await desktopFiles(page, recordings());
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false }); await importFiles(editor, [toneA]);
	const projectId = await editor.getAttribute('data-project-id'), tracks = await editor.getAttribute('data-track-count');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Apply to files', exact: true }).click();
	const batch = page.getByRole('dialog', { name: 'Apply to files', exact: true });
	await batch.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await expect(batch.getByText('episode-two.wav', { exact: true })).toBeVisible();
	await batch.getByRole('button', { name: 'Choose output folder and run', exact: true }).click();
	await expect(batch.getByText('episode-one.wav: Completed', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(batch.getByText('episode-two.wav: Completed', { exact: true })).toBeVisible({ timeout: 30_000 });
	const outputs = await page.evaluate(async () => {
		const state = globalThis.__macroBatchFiles, decoder = new OfflineAudioContext(2, 1, 48_000);
		const durations = [];
		for (const output of state.outputs) durations.push((await decoder.decodeAudioData(Uint8Array.from(output.bytes).buffer)).duration);
		return { referencePicks: state.referencePicks, folderReleased: state.folderReleased, names: state.names, durations };
	});
	expect(outputs).toEqual({ referencePicks: 1, folderReleased: true,
		names: ['episode-one-processed.wav', 'episode-two-processed.wav'], durations: [2.1, 2.1] });
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(editor).toHaveAttribute('data-track-count', tracks);
	await batch.getByRole('button', { name: 'Close', exact: true }).last().click();
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill('Apply to files');
	await expect(editor.getByRole('option', { name: /Apply to files/u })).toBeVisible();
	await search.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Apply to files', exact: true })).toBeVisible();
});

test('cancelling the shared reference picker skips later files and publishes no outputs', async ({ page }) => {
	await desktopFiles(page, recordings(), true);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Apply to files', exact: true }).click();
	const batch = page.getByRole('dialog', { name: 'Apply to files', exact: true });
	await batch.getByRole('button', { name: 'Choose audio files', exact: true }).click();
	await expect(batch.getByText('episode-two.wav', { exact: true })).toBeVisible();
	await batch.getByRole('button', { name: 'Choose output folder and run', exact: true }).click();
	await expect(batch.getByText(/^episode-one.wav: Cancelled/u)).toBeVisible();
	await expect(batch.getByText('episode-two.wav: Skipped', { exact: true })).toBeVisible();
	expect(await page.evaluate(() => globalThis.__macroBatchFiles.outputs.length)).toBe(0);
});

test('the web macro manager does not offer Apply to files', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await expect(manager.getByRole('button', { name: 'Apply to files', exact: true })).toHaveCount(0);
});
