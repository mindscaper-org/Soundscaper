/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop smoke admission rejects the retired cross-family handoff modes', async () => {
	for (const mode of ['project-library-handoff-v1', 'project-library-source-bearing-handoff-v1']) {
		assert.throws(() => parseDesktopSmokeConfiguration([
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${mode}`,
			'--soundscaper-smoke-plan=e30',
		]), /unsupported desktop smoke mode/iu);
	}

	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-handoff/u);
	assert.doesNotMatch(workflow, /npm run desktop:smoke:project-library-source-bearing-handoff/u);
	assert.doesNotMatch(workflow, /release\/desktop-handoff\/framescaper/u);
});
