/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

interface BrowserWavFixture {
	readonly name: string;
	readonly buffer: Uint8Array;
}

/** Build the original publisher inputs in the Node worker; every recipient remains a real browser workflow. */
export async function framescaperCompatibilityPublisher(programme: BrowserWavFixture, fallback?: BrowserWavFixture) {
	// Keep the large controller graph on the ordinary Node test bootstrap instead of
	// recompiling it through Playwright's worker transform. Recipient code runs unchanged.
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-compatibility-publisher-'));
	try {
		const inputs = [{ fixture: programme, frequency: 330, amplitudes: [.35, .35] },
			...(fallback ? [{ fixture: fallback, frequency: 275, amplitudes: [.1, .7] }] : [])];
		const rows = [];
		for (const [index, input] of inputs.entries()) {
			const path = join(directory, `${index}.wav`); await writeFile(path, input.fixture.buffer);
			rows.push({ path, name: input.fixture.name, frequency: input.frequency, amplitudes: input.amplitudes });
		}
		const manifest = join(directory, 'inputs.json'); await writeFile(manifest, JSON.stringify(rows));
		const { stdout } = await promisify(execFile)(process.execPath, ['--max-old-space-size=2048', '--import', 'tsx',
			'--import', fileURLToPath(new URL('../../../scripts/node-style-asset-loader.mjs', import.meta.url)),
			fileURLToPath(new URL('../../helpers/framescaper-compatibility-publisher-runner.ts', import.meta.url)), manifest],
		{ cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
		const separator = stdout.indexOf(10); assert.ok(separator > 0);
		const originalId: unknown = JSON.parse(stdout.subarray(0, separator).toString('utf8')); assert.ok(typeof originalId === 'string' && originalId);
		return { originalId, exported: stdout.subarray(separator + 1) };
	} finally { await rm(directory, { recursive: true, force: true }); }
}
