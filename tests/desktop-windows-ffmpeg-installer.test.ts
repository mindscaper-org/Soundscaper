/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const executeFile = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const includePath = join(root, 'desktop/installer/windows-ffmpeg.nsh');
const scriptPath = join(root, 'desktop/installer/windows-ffmpeg-install.ps1');
const checkbox = 'Add FFmpeg-support for proprietary file formats (M4A, MP4, MOV and more)';

test('Windows offers FFmpeg unchecked and gates its installation on that selection', async () => {
	const include = await readFile(includePath, 'utf8');
	assert.ok(include.includes(checkbox));
	assert.match(include, /NSD_SetState\} \$ffmpegCheckbox \$ffmpegSelected/u);
	assert.match(include, /StrCpy \$ffmpegSelected \$\{BST_UNCHECKED\}/u);
	assert.match(include, /\$ffmpegSelected == \$\{BST_CHECKED\}/u);
	assert.match(include, /IfNot\} \$\{Silent\}/u);
	assert.match(include, /StdUtils\.ExecShellAsUser/u);
	assert.match(include, /WaitForMultipleObjects/u);
	assert.match(include, /CloseHandle/u);
	assert.match(include, /FFmpeg installation failed/u);
});

test('Windows bootstraps WinGet for the user and installs the architecture-specific FFmpeg pair', async () => {
	const script = await readFile(scriptPath, 'utf8');
	assert.match(script, /Install-Module -Name Microsoft\.WinGet\.Client -Scope CurrentUser/u);
	assert.match(script, /Repair-WinGetPackageManager -Latest/u);
	assert.doesNotMatch(script, /Repair-WinGetPackageManager[^\n]*-AllUsers/u);
	assert.ok(script.includes('BtbN.FFmpeg.GPL.8.1'));
	assert.match(script, /'--architecture', \$TargetArchitecture/u);
	assert.match(script, /'--scope', 'user'/u);
	assert.match(script, /'--accept-package-agreements'/u);
	assert.match(script, /'--accept-source-agreements'/u);
	assert.match(script, /ffmpeg-installer-consent/u);
	assert.match(script, /\$LASTEXITCODE -ne 0/u);
	assert.match(script, /\$completion\.Set\(\)/u);
});

test('PowerShell exercises existing, missing and failed package-manager and FFmpeg installations', async (context) => {
	const powershell = process.env.SCAPE_TEST_PWSH
		?? (process.platform === 'win32' ? 'powershell.exe' : null);
	if (powershell === null) {
		context.skip('Set SCAPE_TEST_PWSH to run the bootstrap scenarios with PowerShell.');
		return;
	}
	const result = await executeFile(powershell, [
		'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
		join(root, 'tests/helpers/windows-ffmpeg-installer-fixture.ps1'), scriptPath,
	]);
	assert.match(result.stdout, /Windows FFmpeg bootstrap scenarios passed/u);
});

test('NSIS compiles the FFmpeg page, bootstrap launch and completion wait', async (context) => {
	const require = createRequire(import.meta.url);
	const toolset = require('app-builder-lib/out/toolsets/windows.js') as {
		getMakeNsisPath: () => Promise<{ path: string; env?: NodeJS.ProcessEnv }>;
		getNsisPluginsPath: () => Promise<string>;
	};
	if (process.env.SCAPE_TEST_NSIS !== '1') {
		context.skip('Set SCAPE_TEST_NSIS=1 to compile with electron-builder’s pinned NSIS toolset.');
		return;
	}
	const [compiler, plugins] = await Promise.all([
		toolset.getMakeNsisPath(), toolset.getNsisPluginsPath(),
	]);
	const temporary = await mkdtemp(join(tmpdir(), 'scape-ffmpeg-nsis-'));
	try {
		const fixture = join(temporary, 'installer.nsi');
		await writeFile(fixture, [
			'Unicode true',
			`!addplugindir /x86-unicode "${join(plugins, 'x86-unicode')}"`,
			`!addincludedir "${join(root, 'node_modules/app-builder-lib/templates/nsis/include')}"`,
			'!include StdUtils.nsh',
			'!define PRODUCT_NAME "Soundscaper"',
			'!define APP_ID "org.soundscaper.desktop"',
			'!define APP_ARM64 "fixture"',
			'!define isUpdated `"" == "updated"`',
			`!include "${includePath}"`,
			'Name "FFmpeg installer fixture"',
			`OutFile "${join(temporary, 'installer.exe')}"`,
			'RequestExecutionLevel admin',
			'!insertmacro customPageAfterChangeDir',
			'!insertmacro MUI_PAGE_INSTFILES',
			'!insertmacro MUI_LANGUAGE "English"',
			'Function .onInit',
			'!insertmacro customInit',
			'FunctionEnd',
			'Section',
			'!insertmacro customInstall',
			'SectionEnd',
		].join('\n'));
		await executeFile(compiler.path, ['-WX', fixture], {
			cwd: dirname(fixture), env: { ...process.env, ...compiler.env },
		});
		await access(join(temporary, 'installer.exe'));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
