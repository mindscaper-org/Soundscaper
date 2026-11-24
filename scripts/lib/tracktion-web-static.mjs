/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const contentTypes = {
	'.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
};
const editorFiles = ['index.html', 'editor.js', 'editor.css', 'edit-core.js', 'edit-core.worker.js', 'edit-core.wasm', 'tracktion-project-worker.js'];

export async function loadTracktionWebAssets(directory) {
	return new Map(await Promise.all(editorFiles.map(async (name) => [`/${name}`, await loadAsset(directory, name)])));
}

export async function loadAsset(directory, name) {
	return { body: await readFile(join(directory, name)), type: contentTypes[extname(name)] };
}

export function createTracktionWebServer(assets) {
	return createServer((request, response) => {
		const asset = assets.get(request.url);
		response.writeHead(asset ? 200 : 404, {
			'Content-Type': asset?.type ?? 'text/plain',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Resource-Policy': 'same-origin',
		});
		response.end(asset?.body);
	});
}
