/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runLightscaperDesktopManagedSmokeCurrentV1 } from '../scripts/lightscaper-desktop-managed-smoke-current-v1.ts';

test('Lightscaper managed qualification rejects incomplete, duplicate and relative authorities before launch', async () => {
	for (const args of [[], ['--unknown'], ['--executable', 'relative'], ['--allow-no-sandbox', '--allow-no-sandbox'],
		['--executable', '/fixture/app', '--executable', '/fixture/other']]) {
		await assert.rejects(runLightscaperDesktopManagedSmokeCurrentV1(args));
	}
});

test('registered association refuses incompatible launch authority before filesystem access or callbacks', async () => {
	const missing = join(tmpdir(), 'lightscaper-unavailable-association-input');
	const base = ['--executable', missing, '--runtime-root', missing, '--output-root', missing,
		...(process.platform === 'win32' ? ['--windows-job-helper', missing, '--windows-job-helper-sha256', 'b'.repeat(64)] : [])];
	let called = false;
	const callback = async () => { called = true; return {}; };
	const port = { sourceRevision: 'a'.repeat(40), profilePath: missing, register: callback, open: callback, close: callback };
	for (const [args, candidate] of [
		[[...base, '--backend', 'native'], port],
		[[...base, '--backend', 'native', '--scenario', 'linked'], port],
		[[...base, '--allow-no-sandbox'], port],
		[base, { ...port, sourceRevision: 'unbound-source' }],
	] as const) await assert.rejects(runLightscaperDesktopManagedSmokeCurrentV1(args, candidate), /Registered OS association/u);
	assert.equal(called, false);
});
