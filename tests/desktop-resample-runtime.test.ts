/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-expected-runtime-files.mjs';

interface StagedResampler {
	push(channels: readonly Float32Array[]): readonly Float32Array[];
	finish(): readonly Float32Array[];
}

test('the desktop resampler stages and executes its complete emitted helper closure', async () => {
	const root = resolve(import.meta.dirname, '..');
	const directory = await mkdtemp(join(tmpdir(), 'scape-resample-runtime-'));
	const queued = ['src/common/editor/resample.js'];
	try {
		await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
		for (let index = 0; index < queued.length; index += 1) {
			const member = queued[index]!;
			assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), `${member} must be in the closed desktop runtime`);
			const path = resolve(root, member.endsWith('/resample.js') ? member : member.replace(/\.js$/u, '.ts'));
			const source = await readFile(path, 'utf8');
			const output = ts.transpileModule(source, {
				fileName: path,
				compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024,
					allowJs: true, rewriteRelativeImportExtensions: true },
			}).outputText;
			assert.doesNotMatch(output, /from ['"].*\.ts['"]/u);
			for (const reference of ts.preProcessFile(output, true, true).importedFiles) {
				assert.match(reference.fileName, /^\.\/[\w-]+\.js$/u);
				const dependency = `src/common/editor/${reference.fileName.slice(2)}`;
				if (!queued.includes(dependency)) queued.push(dependency);
			}
			await writeFile(join(directory, basename(member)), output);
		}
		const runtime = await import(pathToFileURL(join(directory, 'resample.js')).href) as {
			createStreamingWindowedSincResampler(inputRate: number, outputRate: number, channels: number): StagedResampler;
		};
		const sampler = runtime.createStreamingWindowedSincResampler(48_000, 96_000, 2);
		const input = [new Float32Array(128).fill(0.25), new Float32Array(128).fill(-0.5)];
		const parts = [sampler.push(input), sampler.push(input), sampler.finish()];
		for (let channel = 0; channel < 2; channel += 1) {
			const values = parts.flatMap(part => [...part[channel]!]);
			assert.equal(values.length, 512);
			assert.ok(values.every(value => value === (channel === 0 ? 0.25 : -0.5)));
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});
