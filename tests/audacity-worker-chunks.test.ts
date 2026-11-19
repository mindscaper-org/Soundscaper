/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { OutputChunk } from 'rolldown';
import { build } from 'vite';
import { workerChunkGroups } from '../scripts/lib/build-worker-chunks.mjs';

test('Audacity lazy recovery and import chunks cannot execute the worker registration entry again', async (context) => {
	const root = resolve(import.meta.dirname, '..');
	const directory = await mkdtemp(resolve(tmpdir(), 'audacity-worker-chunks-'));
	const input = resolve(directory, 'audacity.mjs');
	const worker = resolve(root, 'src/common/editor/aup4-worker.js');
	const chunks: OutputChunk[] = [];
	try {
		await writeFile(input, `globalThis.audacity = new Worker(new URL(${JSON.stringify(worker)}, import.meta.url), { type: 'module' });`);
		// Exercise the real Vite worker emitter and maintained production graph,
		// including SQLite, lazy recovery and streamed import dependencies.
		await build({
			configFile: false, root, publicDir: false, logLevel: 'silent',
			worker: {
				format: 'es',
				plugins: () => [{ name: 'capture-audacity-worker-chunks', generateBundle(_options, bundle) {
					for (const output of Object.values(bundle)) if (output.type === 'chunk') chunks.push(output);
				} }],
				rolldownOptions: { output: { strictExecutionOrder: true, codeSplitting: { groups: workerChunkGroups, minSize: 20_000 } } },
			},
			build: { write: false, rolldownOptions: { input }, emptyOutDir: false },
		});
		const entry = chunks.find(chunk => chunk.facadeModuleId === worker);
		context.diagnostic(JSON.stringify({ entry: entry?.fileName, chunksOmitted: Math.max(0, chunks.length - 64),
			chunks: chunks.slice(0, 64).map(chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code),
				imports: chunk.imports.slice(0, 32), exports: chunk.exports.slice(0, 32), moduleCount: Object.keys(chunk.modules).length })), owners:
			['aup4-worker.js', 'audacity-project-recovery.ts', 'audacity-project-recovery-audio.ts', 'aup4-worker-import-session.ts', 'aup4-import-sample-reader.ts', 'aup4-import-block-storage.ts'].map(module => {
				const owner = chunks.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith(`/${module}`)));
				return { module, chunk: owner?.fileName, entry: owner?.isEntry, dynamicEntry: owner?.isDynamicEntry };
			}) }));
		assert.ok(entry?.isEntry, 'the production worker must have one executable registration entry');
		assert.equal(chunks.filter(chunk => chunk.facadeModuleId === worker).length, 1);
		const registrations = chunks.filter(chunk => Object.hasOwn(chunk.modules, worker));
		assert.equal(registrations.length, 1, 'the production registration module must be emitted exactly once');
		const registration = registrations[0]!;
		if (registration !== entry) assert.ok(entry.imports.includes(registration.fileName), 'the root facade directly initializes its isolated registration owner');
		for (const module of ['audacity-project-recovery.ts', 'aup4-worker-import-session.ts']) {
			const lazy = chunks.find(chunk => Object.keys(chunk.modules).some(id => id.endsWith(`/${module}`)));
			assert.ok(lazy?.isDynamicEntry, `${module} must remain lazy`);
			assert.notEqual(lazy.fileName, entry.fileName);
		}
		const visited = new Set<string>();
		const visit = (chunk: OutputChunk): void => {
			assert.ok(!registrations.includes(chunk), `${chunk.fileName} contains worker registration side effects and must not be imported by shared lazy dependencies`);
			if (visited.has(chunk.fileName)) return;
			visited.add(chunk.fileName);
			for (const dependency of chunk.imports) {
				const imported = chunks.find(candidate => candidate.fileName === dependency);
				assert.ok(imported, `worker dependency ${dependency} must be emitted`);
				visit(imported);
			}
		};
		for (const chunk of chunks) if (chunk !== entry && chunk !== registration) visit(chunk);
		for (const dependency of registration.imports) {
			const imported = chunks.find(chunk => chunk.fileName === dependency);
			assert.ok(imported, `registration dependency ${dependency} must be emitted`);
			visit(imported);
		}
		assert.deepEqual(entry.exports, [], 'a registration entry must not also own shared library exports');
		for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk.code) <= 500_000, `${chunk.fileName} respects the unchanged production ceiling`);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
