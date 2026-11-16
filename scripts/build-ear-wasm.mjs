#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'src/common/editor/ear');
const manifest = JSON.parse(await readFile(resolve(directory, 'source-manifest.json'), 'utf8'));
const sourceRoot = resolve(root, '.native-build/ear/sources');
await mkdir(sourceRoot, { recursive: true });
for (const input of [...manifest.sourceFiles, ...manifest.licenseFiles]) {
	verify(await readFile(resolve(directory, input.path)), input);
}
for (const archive of manifest.archives) {
	const path = resolve(sourceRoot, archive.archive);
	let bytes;
	try { bytes = await readFile(path); verify(bytes, archive); }
	catch {
		process.stdout.write(`Downloading ${archive.name}\n`);
		const response = await fetch(archive.url, { signal: AbortSignal.timeout(300_000) });
		if (!response.ok) throw new Error(`Download failed: ${archive.url} (${response.status}).`);
		bytes = Buffer.from(await response.arrayBuffer()); verify(bytes, archive);
		await writeFile(path, bytes);
	}
	const destination = resolve(sourceRoot, archive.name);
	await mkdir(destination, { recursive: true });
	run('tar', ['-xf', path, '--strip-components=1', '-C', destination]);
}
// Submodule revisions and their complete archive bytes are pinned independently.
for (const name of ['eigen', 'xsimd']) {
	const destination = resolve(sourceRoot, 'libear/submodules', name);
	await mkdir(destination, { recursive: true });
	run('tar', ['-xf', resolve(sourceRoot, `${name}.tar.gz`), '--strip-components=1', '-C', destination]);
}
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? resolve(directory, manifest.wasm.path) : resolve(root, process.argv[outputIndex + 1]);
run('docker', ['run', '--rm', '--memory=6g', '--cpus=2',
	'-v', `${resolve(sourceRoot, 'libear')}:/source:ro`, '-v', `${root}:/work`, '-w', '/work',
	'-e', 'SOURCE_DATE_EPOCH=1700000000', '-e', 'TZ=UTC', '-e', 'LC_ALL=C', manifest.toolchain.dockerImage,
	'bash', '-c', 'emcmake cmake -S src/common/editor/ear/native -B .native-build/ear/rebuild -DEAR_SOURCE=/source -DBoost_INCLUDE_DIR=/work/.native-build/ear/sources/boost -DCMAKE_BUILD_TYPE=Release && cmake --build .native-build/ear/rebuild --parallel 2',
]);
const artifact = await readFile(resolve(root, '.native-build/ear/rebuild/ear-wasm.wasm'));
verify(artifact, manifest.wasm);
await writeFile(output, artifact);
process.stdout.write(`Reproduced EBU EAR (${artifact.length} bytes, SHA-256 ${manifest.wasm.sha256}).\n`);

function verify(bytes, input) {
	if (bytes.length !== input.byteLength || createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
		throw new Error(`Pinned EBU EAR input mismatch: ${input.path ?? input.name}.`);
	}
}
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
