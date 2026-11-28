/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildTracktionAudioWorklet, buildTracktionProjectWorker } from './tracktion-editor-build.mjs';
import { loadAsset, tracktionCoreFiles, tracktionEngineFiles, tracktionWorkerFiles } from './tracktion-web-static.mjs';
import { tracktionNotices } from './tracktion-licenses.mjs';

const run = promisify(execFile);
const prefix = '/tracktion/';

/** @param {string} root @returns {import('vite').Plugin} */
export function tracktionWebEngine(root) {
	/** @type {ReturnType<typeof prepare> | undefined} */
	let assets;
	const getAssets = () => assets ??= prepare(root);
	let build = false;
	return {
		name: 'soundscaper-tracktion-web-engine',
		configResolved(config) { build = config.command === 'build'; },
		async configureServer(server) {
			await getAssets();
			server.middlewares.use((request, response, next) => {
				const name = request.url?.split('?', 1)[0]?.slice(prefix.length);
				if (!request.url?.startsWith(prefix) || !name || !tracktionEngineFiles.includes(name)) {
					next();
					return;
				}
				void getAssets().then((files) => {
					const asset = files.get(name);
					response.setHeader('Content-Type', asset?.type ?? 'application/octet-stream');
					response.end(asset?.body);
				}).catch((error) => { next(error); });
			});
		},
		async buildStart() {
			if (!build) return;
			for (const [name, asset] of await getAssets()) {
				this.emitFile({ type: 'asset', fileName: 'tracktion/' + name, source: asset.body });
			}
			for (const [name, contents] of await tracktionNotices(root)) {
				this.emitFile({ type: 'asset', fileName: 'licenses/tracktion/' + name, source: contents });
			}
		},
	};
}

async function prepare(root) {
	const core = await prepareTracktionWasmCore(root);
	const directory = await mkdtemp(resolve(tmpdir(), 'tracktion-web-workers-'));
	try {
		await buildTracktionProjectWorker(directory);
		await buildTracktionAudioWorklet(directory);
		const workers = await readAssets(directory, tracktionWorkerFiles);
		return new Map([...core, ...workers]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function prepareTracktionWasmCore(root) {
	const source = await tracktionEngineInputDigest(root);
	const cache = resolve(root, '.native-build/tracktion-wasm-core');
	const directory = resolve(cache, source);
	try {
		return await readAssets(directory, tracktionCoreFiles);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		await rm(directory, { recursive: true, force: true });
	}
	await mkdir(cache, { recursive: true });
	const staging = await mkdtemp(resolve(cache, '.build-'));
	try {
		const build = await run(process.execPath, ['scripts/probe-tracktion-wasm.mjs', '--build-browser-core', staging], { cwd: root })
			.catch((error) => { throw new Error('Could not build the Soundscaper WASM engine. ' + (error.stderr || error.message), { cause: error }); });
		process.stdout.write(build.stdout);
		if (source !== await tracktionEngineInputDigest(root)) throw new Error('Tracktion native sources changed during the WASM build.');
		const core = await readAssets(staging, tracktionCoreFiles);
		try {
			await rename(staging, directory);
			return core;
		} catch (error) {
			// Another process may have published a complete core for these inputs.
			return await readAssets(directory, tracktionCoreFiles).catch(() => { throw error; });
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function readAssets(directory, names) {
	return new Map(await Promise.all(names.map(async (name) => [name, await loadAsset(directory, name)])));
}

export async function tracktionEngineInputDigest(root) {
	const files = [
		'config/soundscaper-tracktion-sources.json', 'scripts/probe-tracktion-wasm.mjs',
		'scripts/lib/tracktion-sources.mjs', 'scripts/lib/tracktion-wasm-platform.mjs', 'scripts/lib/tracktion-web-static.mjs',
		'scripts/lib/milestone-5-source-archive-extraction.mjs', 'scripts/lib/exclusive-rename.mjs',
		'native/framescaper-media-host/build/source-authentication.mjs',
		...await sourceFiles(root, 'native/soundscaper-tracktion', /\.(?:c|cmake|cpp|h|inc|sh|txt)$/u),
	];
	const digest = createHash('sha256');
	for (const file of files.sort()) {
		const bytes = await readFile(resolve(root, file));
		digest.update(file + '\0' + String(bytes.byteLength) + '\0');
		digest.update(bytes);
	}
	return digest.digest('hex');
}

async function sourceFiles(root, relativePath, include) {
	const entries = await readdir(resolve(root, relativePath), { withFileTypes: true });
	return (await Promise.all(entries.map(async (entry) => {
		const path = relativePath + '/' + entry.name;
		if (entry.isDirectory()) return sourceFiles(root, path, include);
		return entry.isFile() && include.test(path) ? [path] : [];
	}))).flat();
}
