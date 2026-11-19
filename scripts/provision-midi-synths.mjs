/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { downloadCiBytes } from './lib/ci-download-retry.mjs';

const root = resolve(import.meta.dirname, '..'), flags = new Set(process.argv.slice(2));
if (!flags.size || [...flags].some(flag => !['--sources', '--native', '--install-user'].includes(flag))) throw new Error('Usage: node scripts/provision-midi-synths.mjs --sources | --native [--install-user]');
if (flags.has('--install-user') && !flags.has('--native')) throw new Error('--install-user requires --native.');
const manifest = JSON.parse(await readFile(join(root, 'config/midi-synth-runtime.json'), 'utf8'));
const cache = join(root, '.desktop-build/midi-instruments');
if (flags.has('--sources')) for (const source of manifest.sourceInputs) await acquire(source, join(root, '.desktop-build/midi-sources'));
if (flags.has('--native')) {
	if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('The reproducible experiment recipe targets Linux x64; other desktop targets use their native user-installed VST3 builds.');
	const [surge, dexed] = manifest.nativeLinuxExperiments;
	const surgeArchive = await acquire(surge, cache), dexedArchive = await acquire(dexed, cache);
	await mkdir(join(cache, 'surge'), { recursive: true });
	await mkdir(join(cache, 'dexed-source'), { recursive: true });
	run('dpkg-deb', ['-x', surgeArchive, join(cache, 'surge')]);
	run('tar', ['-xzf', dexedArchive, '-C', join(cache, 'dexed-source'), '--strip-components=1', '--no-same-owner', '--no-same-permissions']);
	// Upstream hard-codes copying into ~/.vst3 after every build. Keep the build
	// isolated, then honor --install-user with the non-overwriting copy below.
	const dexedCmake = join(cache, 'dexed-source/source/CMakeLists.txt');
	const original = await readFile(dexedCmake, 'utf8');
	if (!original.includes('COPY_PLUGIN_AFTER_BUILD TRUE')) throw new Error('The pinned Dexed installation patch no longer applies.');
	await writeFile(dexedCmake, original.replace('COPY_PLUGIN_AFTER_BUILD TRUE', 'COPY_PLUGIN_AFTER_BUILD FALSE'));
	run('cmake', ['-S', join(cache, 'dexed-source'), '-B', join(cache, 'dexed-build'), '-DCMAKE_BUILD_TYPE=Release', '-DJUCE_COPY_PLUGIN_AFTER_BUILD=FALSE']);
	run('cmake', ['--build', join(cache, 'dexed-build'), '--target', 'Dexed_VST3', '--parallel', '2']);
	const surgePlugin = join(cache, 'surge/usr/lib/vst3/Surge XT.vst3');
	const dexedPlugin = join(cache, 'dexed-build/source/Dexed_artefacts/Release/VST3/Dexed.vst3');
	if (flags.has('--install-user')) {
		await installAbsent(surgePlugin, join(homedir(), '.vst3/Surge XT.vst3'));
		await installAbsent(dexedPlugin, join(homedir(), '.vst3/Dexed.vst3'));
		await installAbsent(join(cache, 'surge/usr/share/surge-xt'), join(homedir(), '.local/share/surge-xt'));
	}
	process.stdout.write(`Surge XT: ${surgePlugin}\nDexed: ${dexedPlugin}\nUse the existing Plugin Manager to scan, allow and assign the selected instrument.\n`);
}
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
async function acquire(entry, directory) {
	await mkdir(directory, { recursive: true });
	const path = join(directory, entry.fileName);
	let bytes;
	try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (!bytes) bytes = await downloadCiBytes(entry.url, { maximumBytes: entry.byteLength, timeoutMs: 600_000 });
	if (bytes.length !== entry.byteLength || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Pinned source/runtime authentication failed: ${entry.fileName}`);
	await writeFile(path, bytes);
	return path;
}
async function installAbsent(source, destination) {
	try { await lstat(destination); process.stdout.write(`Retaining existing installation: ${destination}\n`); return; }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	await mkdir(resolve(destination, '..'), { recursive: true });
	await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
}
