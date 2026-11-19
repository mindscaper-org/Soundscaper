/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	DESKTOP_EXPECTED_RUNTIME_FILES,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

test('desktop compiler inventory declares each runtime member exactly once', () => {
	assert.equal(new Set(DESKTOP_EXPECTED_RUNTIME_FILES).size, DESKTOP_EXPECTED_RUNTIME_FILES.length);
});

async function runtimeInventory(context: TestContext, files: readonly string[]) {
	const root = await mkdtemp(join(tmpdir(), 'desktop-closed-inventory-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const desktopSourceRoot = join(root, 'source');
	const applicationDesktopRoot = join(root, 'application');
	const runtimeRoot = join(root, 'runtime');
	await mkdir(desktopSourceRoot, { recursive: true });
	for (const member of files) {
		const path = join(runtimeRoot, member);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, '');
	}
	return { desktopSourceRoot, applicationDesktopRoot, runtimeRoot };
}

for (const helper of [
	'src/common/editor/format-file-failure.js',
	'desktop/desktop-database-contention.js',
]) test(`desktop staging refuses missing ${helper} before copying application sources`, async context => {
	const options = await runtimeInventory(context, DESKTOP_EXPECTED_RUNTIME_FILES.filter(file => file !== helper));
	await assert.rejects(stageDesktopApplicationSources(options),
		{ message: `Desktop runtime output is incomplete or stale; missing: ${helper}; unexpected: (none)` });
	await assert.rejects(access(options.applicationDesktopRoot), { code: 'ENOENT' });
});

test('desktop staging refuses stale undeclared compiler output before copying application sources', async context => {
	const options = await runtimeInventory(context, [
		...DESKTOP_EXPECTED_RUNTIME_FILES,
		'desktop/stale-undeclared-helper.js',
	]);
	await assert.rejects(stageDesktopApplicationSources(options),
		/missing: \(none\); unexpected: desktop\/stale-undeclared-helper\.js/u);
	await assert.rejects(access(options.applicationDesktopRoot), { code: 'ENOENT' });
});
