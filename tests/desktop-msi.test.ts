/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { msiPackageVersion, prepareMsiProject } from '../scripts/lib/desktop-msi-project.ts';

test('MSI versions preserve date/build/channel order within all three native field limits', () => {
	assert.equal(msiPackageVersion('Soundscaper-rc.2026.Nov.11.a'), '38.83.2');
	assert.equal(msiPackageVersion('Framescaper.2026.Nov.11.a'), '38.83.3');
	const versions = ['Soundscaper-alpha.2026.Nov.11.a', 'Soundscaper-beta.2026.Nov.11.a', 'Soundscaper-rc.2026.Nov.11.a',
		'Soundscaper.2026.Nov.11.a', 'Soundscaper-alpha.2026.Nov.11.b', 'Soundscaper-alpha.2026.Nov.12.a',
		'Soundscaper.2026.Dec.31.a', 'Soundscaper-alpha.2027.Jan.1.a'];
	const numbers = versions.map(value => msiPackageVersion(value).split('.').map(Number));
	for (let i = 1; i < numbers.length; i++) {
		const a = numbers[i - 1]!, b = numbers[i]!;
		const different = a.findIndex((part, index) => part !== b[index]);
		assert.ok(different >= 0 && a[different]! < b[different]!);
		assert.ok(b[0]! <= 255 && b[1]! <= 255 && b[2]! <= 65535);
	}
	assert.throws(() => msiPackageVersion('Soundscaper.1999.Dec.31.a'), /range/u);
	assert.throws(() => msiPackageVersion('Soundscaper.2180.Jan.1.a'), /range/u);
});

test('the generated WiX project registers MSI ownership without changing application version metadata', () => {
	const input = '<Product Name="Soundscaper" Version="2026.1111.2.0"><ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER"></ComponentGroup></Product>';
	const output = prepareMsiProject(input, 'soundscaper', 'Soundscaper-rc.2026.Nov.11.a');
	assert.match(output, /Version="38\.83\.2"/u);
	assert.match(output, /Key="Software\\Mindscaper\\Soundscaper\\Installation"/u);
	assert.match(output, /Name="ManagedByWindowsInstaller" Type="integer" Value="1"/u);
	assert.match(output, /Root="HKLM"/u);
	assert.throws(() => prepareMsiProject(input, 'framescaper', 'Framescaper.2026.Nov.11.a'), /product/u);
	assert.throws(() => prepareMsiProject('<invalid/>', 'soundscaper', 'Soundscaper.2026.Nov.11.a'), /project/u);
});

test('each product ships silent per-machine MSI configuration and policy templates', async () => {
	const { execFileSync } = await import('node:child_process');
	for (const product of ['soundscaper', 'framescaper']) {
		const config = JSON.parse(execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./electron-builder.config.cjs')))"],
			{ cwd: new URL('..', import.meta.url), env: { ...process.env, SCAPE_PRODUCT: product, SCAPE_MAC_SIGNING: 'false', SCAPE_WIN_SIGNING: 'none' }, encoding: 'utf8' }));
		assert.ok(config.win.target.includes('msi'));
		assert.equal(config.msi.perMachine, true);
		assert.equal(config.msi.runAfterFinish, false);
		assert.ok(config.msi.upgradeCode);
		assert.equal(config.msiProjectCreated, './scripts/desktop-msi-project.mjs');
		const admx = await readFile(new URL(`../desktop/policies/${product}.admx`, import.meta.url), 'utf8');
		assert.match(admx, /class="Both"/u);
		assert.match(admx, /LaunchPreferences/u);
		assert.match(admx, /ApplicationUpdatesAllowed/u);
	}
});
