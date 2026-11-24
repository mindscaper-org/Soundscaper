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
let application;
try {
	await mkdir(projectDirectory);
	await writeFile(input, wavFixture(512));
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
	await fileCommand('Save project');
	await window.getByText('All changes saved locally').waitFor();
	assert.match(await readFile(join(projectDirectory, 'project.tracktionedit'), 'utf8'), /<EDIT\b/u);
	await fileCommand('Export mix (WAV)');
	await window.locator('main[aria-busy="false"]').waitFor();
	const mix = waveData(await readFile(output));
	assert.equal(mix.length, 512 * 4);
	assert.deepEqual([mix.readInt16LE(128 * 4), mix.readInt16LE(128 * 4 + 2)], [4096, -2048]);
	console.log('The prepared Soundscaper entry saved a Tracktion Edit and exported the expected PCM.');
} finally {
	try { await application?.close(); }
	finally { await rm(scratch, { recursive: true, force: true }); }
}
