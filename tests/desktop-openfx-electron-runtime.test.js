/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('Electron main keeps verification in main while the actual OpenFX native child owns isolation', async () => {
	const source = await readFile(join(ROOT, 'desktop/framescaper-openfx-electron-runtime.mjs'), 'utf8');
	assert.match(source, /startFramescaperOpenFxRuntime/iu);
	assert.match(source, /externalRuntimeRoot.*resourcesPath.*runtime.*\.\..*runtime/su,
		'the packaged and prepared-development hosts must both resolve from external runtime resources');
	assert.doesNotMatch(source, /utilityProcess|openfx-helper-process|child_process|shell:\s*true/iu);
	const runtime = await readFile(join(ROOT, 'desktop/framescaper-openfx-runtime.ts'), 'utf8');
	assert.match(runtime, /createIsolatedOpenFxNativeChildAuthority\(selected\)/u);
	assert.match(runtime, /createOpenFxMainHelperChannel/u);
	assert.doesNotMatch(runtime, /spawnHelper|productionLauncher/u);
	const isolated = await readFile(join(ROOT, 'desktop/openfx-isolated-native-child.ts'), 'utf8');
	assert.match(isolated, /createNativeChildIsolationLauncher/u);
	assert.match(isolated, /isEnforcedNativeChildLaunch/u);
});

test('the retired utility-process entry is absent from source and desktop staging', async () => {
	const retired = 'desktop/openfx-helper-process.js';
	await assert.rejects(access(join(ROOT, retired)), { code: 'ENOENT' });
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes(retired), false);
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/openfx-isolated-native-child.js'));
});
