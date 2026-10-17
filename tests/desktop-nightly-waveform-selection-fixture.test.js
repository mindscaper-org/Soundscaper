/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { resolveNightlyTestRuntimePackages } from '../scripts/lib/desktop-nightly-tests-staging.mjs';

const REPOSITORY_ROOT = join(import.meta.dirname, '..');
const HARNESS = 'tests/browser/helpers/waveform-selection-harness.js';

test('the packaged waveform selection fixture bundles without application UI packages', async (context) => {
	const staged = await mkdtemp(join(tmpdir(), 'soundscaper-waveform-selection-fixture-'));
	context.after(() => rm(staged, { recursive: true, force: true }));
	// The nightly payload has the source tree and vendored painter inputs; its Node
	// dependency set deliberately excludes React and the application design system.
	for (const input of ['src', 'vendor/audacity-design-system/tokens',
		'vendor/audacity-design-system/components/src/utils/roseus-colormap.ts', HARNESS]) {
		const destination = join(staged, input);
		await mkdir(dirname(destination), { recursive: true });
		await cp(join(REPOSITORY_ROOT, input), destination, { recursive: true });
	}
	for (const { name, root } of await resolveNightlyTestRuntimePackages(REPOSITORY_ROOT)) {
		const destination = join(staged, 'node_modules', name);
		await mkdir(dirname(destination), { recursive: true });
		await symlink(root, destination, process.platform === 'win32' ? 'junction' : 'dir');
	}
	const result = await build({
		absWorkingDir: staged,
		preserveSymlinks: true,
		entryPoints: [HARNESS],
		bundle: true, write: false, format: 'iife', globalName: 'waveformCanvas', target: 'es2022',
		external: ['./pffft.js'], loader: { '.css': 'empty' }, logLevel: 'silent',
	});
	assert.match(result.outputFiles[0].text, /drawAudacityClipCanvas/u);
});
