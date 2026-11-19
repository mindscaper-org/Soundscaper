#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readStrictDefinedMemoryLimits } from './lib/wasm-binary-inspection.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'src/common/editor/ear');
const manifest = JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8'));
for (const entry of [...manifest.sourceFiles, ...manifest.licenseFiles, manifest.wasm]) {
	const bytes = await readFile(resolve(directory, entry.path));
	if (bytes.length !== entry.byteLength || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
		throw new Error(`EBU EAR integrity mismatch: ${entry.path}.`);
	}
}
const bytes = await readFile(resolve(directory, manifest.wasm.path));
const module = new WebAssembly.Module(bytes);
const actualImports = WebAssembly.Module.imports(module).map(({ module, name, kind }) => `${module}.${name}:${kind}`).sort();
if (JSON.stringify(actualImports) !== JSON.stringify([...manifest.wasm.imports].sort())) {
	throw new Error('EBU EAR contains an unreviewed host import.');
}
const actualExports = WebAssembly.Module.exports(module).map(({ name }) => name).sort();
if (JSON.stringify(actualExports) !== JSON.stringify([...manifest.wasm.exports].sort())) {
	throw new Error('EBU EAR exports do not match the reviewed ABI.');
}
const memories = readStrictDefinedMemoryLimits(bytes);
if (memories.length !== 1 || memories[0].shared || memories[0].memory64
	|| memories[0].minimumPages * 65_536 !== manifest.wasm.initialMemoryBytes
	|| memories[0].maximumPages * 65_536 !== manifest.wasm.maximumMemoryBytes
	|| manifest.wasm.maximumMemoryBytes !== 32 * 1024 ** 2) {
	throw new Error('EBU EAR must have exactly 32 MiB of fixed, non-shared memory.');
}
process.stdout.write(`Audited EBU libear ${manifest.version}: source, notices, artifact, ABI, imports and fixed memory.\n`);
