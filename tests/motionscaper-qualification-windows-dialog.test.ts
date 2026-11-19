/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createMotionQualificationNative, type MotionNativeLaunch } from '../desktop/motionscaper-qualification-native.ts';
import { motionQualificationChooserRequest } from '../desktop/motionscaper-qualification-policy.ts';

const root = resolve(import.meta.dirname, '..');
const interactive = process.platform === 'win32' && process.env.SCAPE_TEST_OWNED_NATIVE_DIALOG === '1';
const fixture = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Motionscaper owned chooser regression'
$form.Width = 480
$form.Height = 240
$form.StartPosition = 'CenterScreen'
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Open Motionscaper project'
$dialog.Filter = 'Motionscaper project|*.mscape'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
$script:selectionFailure = $null
$form.add_Shown({
 try {
  [Console]::Out.WriteLine('OWNED_FILE_DIALOG_READY')
  if ($dialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Owned dialog selection was cancelled.' }
  [Console]::Out.WriteLine('OWNED_FILE_DIALOG_SELECTED '+$dialog.FileName)
 } catch {
  $script:selectionFailure = $_
  $form.Close()
 }
})
try {
 [System.Windows.Forms.Application]::Run($form)
 if ($null -ne $script:selectionFailure) { throw $script:selectionFailure }
} finally {
 $dialog.Dispose()
 $form.Close()
 $form.Dispose()
}
`;

test('A real owned Windows file dialog nested beneath its main window accepts only the granted input',
	{ skip: !interactive, timeout: 90000 }, async context => {
		const directory = await mkdtemp(join(tmpdir(), 'motionscaper-owned-dialog-'));
		const retained: { launch?: MotionNativeLaunch } = {};
		let passed = false;
		context.after(async () => {
			const launch = retained.launch;
			if (launch) { launch.child.stdin.end(); await launch.closed; }
			if (passed) await rm(directory, { recursive: true });
			else context.diagnostic(`Owned dialog failure runtime retained: ${directory}`);
		});
		assert.ok(process.env.SystemRoot, 'A genuine Windows SystemRoot is required.');
		const input = join(directory, 'saved.mscape'), script = join(directory, 'owned-dialog.ps1');
		await writeFile(input, 'Owned native chooser input fixture\n', { flag: 'wx' });
		await writeFile(script, fixture, { flag: 'wx' });
		const native = await createMotionQualificationNative(root, directory); native.requireInteractive();
		const launch = await native.start({ executable: join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
			args: ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script],
			cwd: root, id: 'owned-dialog', timeoutMs: 30000, maximumOutputBytes: 65536, env: process.env });
		retained.launch = launch;
		let stdout = '';
		let readyResolve!: () => void, readyReject!: (error: Error) => void;
		const ready = new Promise<void>((accept, reject) => { readyResolve = accept; readyReject = reject; });
		const timer = setTimeout(() => readyReject(new Error('Owned file-dialog fixture did not become ready.')), 15000);
		launch.child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
			if (stdout.length > 65536) readyReject(new Error('Owned dialog fixture output exceeded its bound.'));
			if (stdout.includes('OWNED_FILE_DIALOG_READY\n') || stdout.includes('OWNED_FILE_DIALOG_READY\r\n')) readyResolve();
		});
		launch.child.stderr.resume(); launch.child.stdin.on('error', () => { /* The retained physical closure is asserted below. */ });
		try {
			const [{ owner, custody }] = await Promise.all([launch.admitted, ready]);
			const choose = motionQualificationChooserRequest(owner, 'scene-open', input, directory);
			const result = await native.windows({ schemaVersion: 1, action: 'choose', choose, custody });
			assert.ok(result && typeof result === 'object');
			const selected = result as { selected?: unknown; dialogClosed?: unknown; path?: unknown; owner?: unknown; kind?: unknown };
			assert.equal(selected.selected, true); assert.equal(selected.dialogClosed, true);
			assert.equal(selected.path, input); assert.equal(selected.kind, 'scene-open'); assert.deepEqual(selected.owner, owner);
			await native.signal(owner, custody, 'TERM');
			assert.deepEqual(await launch.closed, { code: 0, signal: null });
			assert.ok(stdout.includes(`OWNED_FILE_DIALOG_SELECTED ${input}`));
			const closure = JSON.parse(await readFile(join(directory, 'owned-dialog.closure.json'), 'utf8')) as {
				physicalClosed: boolean; failure: unknown; details: { naturalClosure: boolean; accounting: { activeProcesses: number }; survivorsAfterCleanup: unknown[] };
			};
			assert.equal(closure.physicalClosed, true); assert.equal(closure.failure, null);
			assert.equal(closure.details.naturalClosure, true); assert.equal(closure.details.accounting.activeProcesses, 0);
			assert.deepEqual(closure.details.survivorsAfterCleanup, []); passed = true;
		} finally { clearTimeout(timer); }
	});
