/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'config/midi-synth-runtime.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
for (const [name, version] of [['libadlmidi-js', manifest.engines.libadlmidi.wrapperVersion], ['js-synthesizer', manifest.engines.fluidsynth.wrapperVersion]]) {
	assert.equal(lock.packages[`node_modules/${name}`].version, version, `${name} locked source identity`);
}
for (const artifact of [...manifest.artifacts, ...manifest.licenseFiles]) {
	const bytes = await readFile(resolve(root, artifact.path));
	assert.equal(bytes.length, artifact.byteLength, artifact.path);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.path);
}
const module = await readFile(resolve(root, 'node_modules/js-synthesizer/externals/libfluidsynth-2.4.6.js'), 'utf8');
const embedded = module.match(/"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/u);
assert.ok(embedded, 'FluidSynth single-file WASM payload');
const wasm = Buffer.from(embedded[1], 'base64');
assert.equal(wasm.length, manifest.fluidSynthWasm.byteLength);
assert.equal(createHash('sha256').update(wasm).digest('hex'), manifest.fluidSynthWasm.sha256);
assert.equal(manifest.engines.libadlmidi.embeddedBanks, false);
assert.equal(manifest.engines.fluidsynth.libsndfile, false);
assert.ok(manifest.artifacts.every(artifact => !/with-libsndfile|libadlmidi\.(?:full|light)\./u.test(artifact.path)));
for (const source of manifest.sourceInputs) {
	assert.match(source.url, /^https:\/\/codeload\.github\.com\/[\w-]+\/[\w-]+\/tar\.gz\/[a-f0-9]{40}$/u);
	assert.match(source.sha256, /^[a-f0-9]{64}$/u);
	assert.ok(source.byteLength > 0);
}
process.stdout.write('Verified pinned MIDI WASM runtimes, license texts, slim bank policy and corresponding-source identities.\n');
