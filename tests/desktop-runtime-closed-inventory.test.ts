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

test('desktop staging refuses a missing transitive parser helper before copying application sources', async context => {
	const helper = 'src/common/editor/format-file-failure.js';
	const options = await runtimeInventory(context, DESKTOP_EXPECTED_RUNTIME_FILES.filter(file => file !== helper));
	await assert.rejects(stageDesktopApplicationSources(options),
		/missing: src\/common\/editor\/format-file-failure\.js; unexpected: \(none\)/u);
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
