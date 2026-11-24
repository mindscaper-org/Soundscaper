/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { loadAsset, tracktionEngineFiles } from './tracktion-web-static.mjs';
import { tracktionNotices } from './tracktion-licenses.mjs';

const run = promisify(execFile);
const prefix = '/tracktion/';

/** @param {string} root @returns {import('vite').Plugin} */
export function tracktionWebEngine(root) {
	const directory = resolve(root, '.native-build/tracktion-wasm-core');
	/** @type {ReturnType<typeof prepare> | undefined} */
	let assets;
	const getAssets = () => assets ??= prepare(root, directory);
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

async function prepare(root, directory) {
	const stamp = resolve(directory, 'release.sha256');
	const source = await tracktionEngineInputDigest(root);
	try {
		if ((await readFile(stamp, 'utf8')) === source) return await engineFiles(directory);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	const build = await run(process.execPath, ['scripts/probe-tracktion-wasm.mjs', '--build-browser'], { cwd: root })
		.catch((error) => { throw new Error('Could not build the Soundscaper WASM engine. ' + (error.stderr || error.message), { cause: error }); });
	process.stdout.write(build.stdout);
	const result = await engineFiles(directory);
	if (source !== await tracktionEngineInputDigest(root)) throw new Error('Tracktion sources changed during the WASM build.');
	await writeFile(stamp, source);
	return result;
}

async function engineFiles(directory) {
	return new Map(await Promise.all(tracktionEngineFiles.map(async (name) => [name, await loadAsset(directory, name)])));
}

export async function tracktionEngineInputDigest(root) {
	const files = [
		'config/soundscaper-tracktion-sources.json', 'scripts/probe-tracktion-wasm.mjs',
		'scripts/lib/tracktion-sources.mjs', 'scripts/lib/tracktion-editor-build.mjs', 'scripts/lib/tracktion-wasm-platform.mjs',
		...await sourceFiles(root, 'native/soundscaper-tracktion', /\.(?:cmake|cpp|h|props|sh|ts|txt)$/u),
		...await sourceFiles(root, 'src/soundscaper', /\/tracktion-[^/]+\.ts$/u),
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
