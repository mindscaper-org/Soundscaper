/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import electron from 'electron';
import { _electron } from 'playwright-core';

import { waveData, wavFixture } from '../native/soundscaper-tracktion/tests/wave_fixture.ts';

const stagedApplication = resolve(process.argv[2] ?? '.desktop-build/app');
const scratch = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-stage-'));
const projectDirectory = join(scratch, 'Project');
const input = join(scratch, 'reference.wav');
const output = join(scratch, 'mix.wav');
const clipboardDestination = join(scratch, 'Clipboard destination');
let application;
try {
	await mkdir(projectDirectory);
	await mkdir(clipboardDestination);
	await writeFile(input, wavFixture(24_576));
	const env = { ...process.env, XDG_CONFIG_HOME: scratch, APPDATA: scratch };
	delete env.ELECTRON_RUN_AS_NODE;
	application = await _electron.launch({
		executablePath: electron,
		args: [stagedApplication],
		env,
	});
	const window = await application.firstWindow();
	await window.getByRole('heading', { name: 'Soundscaper Tracktion' }).waitFor();
	assert.equal(new URL(window.url()).protocol, 'soundscaper-tracktion-app:');
	assert.equal(await window.evaluate(() => typeof require), 'undefined');
	await application.evaluate(({ dialog }, paths) => {
		dialog.showOpenDialog = async (_window, options) => ({
			canceled: false,
			filePaths: [options.properties.includes('openDirectory') ? paths.projectDirectory : paths.input],
		});
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output });
		dialog.showMessageBoxSync = () => 1;
	}, { projectDirectory, input, output });
	async function fileCommand(name) {
		await window.getByText('File', { exact: true }).click();
		await window.getByRole('button', { name, exact: true }).click();
	}
	await fileCommand('New project');
	await window.getByRole('heading', { name: 'Project' }).waitFor();
	await fileCommand('Import audio');
	await window.getByText('1 clip', { exact: true }).waitFor();
	const editing = window.getByText('Editing tools', { exact: true });
	const track = window.getByRole('combobox', { name: 'Track', exact: true });
	await editing.click();
	await window.getByRole('button', { name: 'Add track', exact: true }).click();
	await window.getByText('0 clips', { exact: true }).waitFor();
	await track.selectOption({ index: 0 });
	await window.getByText('1 clip', { exact: true }).waitFor();
	await editing.click();
	await window.getByRole('button', { name: 'Move clip', exact: true }).click();
	const move = window.getByRole('dialog', { name: 'Move clip' });
	const destination = await move.getByRole('option', { name: 'Audio track 2' }).getAttribute('value');
	await move.getByRole('combobox', { name: 'Destination track' }).selectOption({ label: 'Audio track 2' });
	await move.getByRole('button', { name: 'Apply' }).click();
	await window.locator('main[aria-busy="false"]').waitFor();
	await window.getByText('1 clip', { exact: true }).waitFor();
	assert.equal(await track.inputValue(), destination);
	await editing.click();
	await window.getByRole('button', { name: 'Delete time range', exact: true }).click();
	const range = window.getByRole('dialog', { name: 'Delete time range' });
	await range.getByRole('spinbutton', { name: 'Start frame' }).fill('128');
	await range.getByRole('spinbutton', { name: 'End frame' }).fill('129');
	await range.getByRole('combobox', { name: 'Delete mode' }).selectOption('track');
	await range.getByRole('button', { name: 'Apply' }).click();
	await window.getByRole('list', { name: 'Audio clips' }).getByText('reference (128–24575)', { exact: true }).waitFor();
	await editing.click();
	await window.getByRole('button', { name: 'Track automation', exact: true }).click();
	const automation = window.getByRole('dialog', { name: 'Track automation' });
	await automation.getByRole('spinbutton', { name: /Curve to next point/u }).fill('1');
	await automation.getByRole('button', { name: 'Add point' }).click();
	await automation.getByRole('option', { name: '0 · 0.000', exact: true }).waitFor({ state: 'attached' });
	await automation.getByRole('spinbutton', { name: 'Frame' }).fill('8192');
	await automation.getByRole('spinbutton', { name: 'Value' }).fill('-12');
	await automation.getByRole('button', { name: 'Add point' }).click();
	await automation.getByRole('option', { name: '8192 · -12.000', exact: true }).waitFor({ state: 'attached' });
	await automation.getByRole('button', { name: 'Close' }).click();
	await editing.click();
	await window.getByRole('button', { name: 'Duplicate track', exact: true }).click();
	const copiedTrack = track.getByRole('option', { name: 'Audio track 2 copy', exact: true });
	await copiedTrack.waitFor({ state: 'attached' });
	assert.equal(await track.inputValue(), await copiedTrack.getAttribute('value'));
	await fileCommand('Export mix (WAV)');
	await window.locator('main[aria-busy="false"]').waitFor();
	const duplicateMix = waveData(await readFile(output));
	assert.equal(duplicateMix.readInt16LE(4 * 4_096), 8192);
	assert.ok(Math.abs(duplicateMix.readInt16LE(4 * 12_288) - 2058) <= 4);
	await editing.click();
	await window.getByRole('button', { name: 'Undo', exact: true }).click();
	await copiedTrack.waitFor({ state: 'detached' });
	await track.selectOption({ label: 'Audio track 2' });
	await fileCommand('Save project');
	await window.getByText('All changes saved locally').waitFor();
	const savedProjectFile = join(projectDirectory, 'project.tracktionedit');
	assert.match(await readFile(savedProjectFile, 'utf8'), /<EDIT\b/u);
	await editing.click();
	await window.getByRole('button', { name: 'Add track', exact: true }).click();
	await track.getByRole('option', { name: 'Audio track 3', exact: true }).waitFor({ state: 'attached' });
	await application.evaluate(({ dialog }, file) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
	}, savedProjectFile);
	await window.evaluate(() => {
		window.confirm = (message) => {
			document.body.setAttribute('data-confirmation', message);
			return true;
		};
	});
	await fileCommand('Open projects');
	await window.locator('main[aria-busy="false"]').waitFor();
	assert.match(await window.locator('body').getAttribute('data-confirmation'), /discard unsaved changes/iu);
	assert.equal(await track.locator('option').count(), 2, 'reopening the same file discards the unsaved third track');
	await track.selectOption({ label: 'Audio track 2' });
	await fileCommand('Export mix (WAV)');
	await window.locator('main[aria-busy="false"]').waitFor();
	const mix = waveData(await readFile(output));
	assert.equal(mix.length, 24_575 * 4);
	assert.deepEqual([mix.readInt16LE(128 * 4), mix.readInt16LE(128 * 4 + 2)], [4096, -2048]);
	assert.ok(Math.abs(mix.readInt16LE(4 * 12_288) - 1029) <= 2);
	await editing.click();
	await window.getByRole('button', { name: 'Copy', exact: true }).click();
	const copy = window.getByRole('dialog', { name: 'Copy' });
	await copy.getByRole('spinbutton', { name: 'Start frame' }).fill('120');
	await copy.getByRole('spinbutton', { name: 'End frame' }).fill('160');
	await copy.getByRole('button', { name: 'Apply' }).click();
	await application.evaluate(({ dialog }, directory) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
	}, clipboardDestination);
	await fileCommand('New project');
	await window.getByRole('heading', { name: 'Clipboard destination' }).waitFor();
	await editing.click();
	await window.getByRole('button', { name: 'Paste', exact: true }).click();
	const paste = window.getByRole('dialog', { name: 'Paste' });
	await paste.getByRole('spinbutton', { name: 'Start frame' }).fill('20');
	await paste.getByRole('button', { name: 'Apply' }).click();
	await window.getByRole('list', { name: 'Audio clips' }).getByText('reference (28–60)', { exact: true }).waitFor();
	await fileCommand('Export mix (WAV)');
	await window.locator('main[aria-busy="false"]').waitFor();
	const pasted = waveData(await readFile(output));
	assert.equal(pasted.length, 60 * 4);
	assert.equal(pasted.readInt16LE(19 * 4), 0);
	assert.equal(pasted.readInt16LE(20 * 4), 4096);
	await fileCommand('Save project');
	await window.getByText('All changes saved locally').waitFor();
	console.log('The prepared Soundscaper entry saved Tracktion Edits and verified duplication, automation and cross-project clipboard PCM.');
} finally {
	try { await application?.close(); }
	finally { await rm(scratch, { recursive: true, force: true }); }
}
