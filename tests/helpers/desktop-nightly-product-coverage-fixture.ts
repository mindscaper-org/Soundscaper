/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPackage } from '@electron/asar';

import { DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS } from '../../desktop/renderer-smoke-execution.js';

export const REVISION = '0123456789abcdef0123456789abcdef01234567';
const DYNAMIC_EXCLUSIONS = Object.values(DESKTOP_RENDERER_DYNAMIC_EXCLUSIONS)
	.filter(({ products }) => products.includes('soundscaper'))
	.map(({ marker, pathPrefix }, index) => (
		`export const dynamic_recipe_${index} = ${JSON.stringify(`${marker}\n${pathPrefix}`)};`
	)).join('\n');
export const RENDERER_WASM = 'renderer/assets/sqlite3-fixture.wasm';
export const RUNTIME_WASM = 'runtime/model/engine.wasm';
export const WASM = '\u0000asm\u0001\u0000\u0000\u0000';
export const STARTUP_JSON_DOCUMENT = '<main></main><script type="application/json" data-editor-startup-assets>{"assets":[]}</script>\n';

interface CoverageFixtureOptions {
	readonly packagedApplicationExtras?: ReadonlyMap<string, string>;
	readonly packagedResourceExtras?: ReadonlyMap<string, string>;
	readonly packagedResourcesPath?: string;
	readonly productId?: 'soundscaper' | 'framescaper';
	readonly rendererDocument?: string;
}

export async function createCoverageFixture(workspace: string, options: CoverageFixtureOptions = {}) {
	const buildRoot = join(workspace, '.desktop-build');
	const productId = options.productId ?? 'soundscaper';
	const productOutput = join(workspace, 'release', productId);
	const files = new Map([
		['app/desktop/main.mjs', `export const main = true;\n${DYNAMIC_EXCLUSIONS}\n`],
		['app/desktop/preload.cjs', 'module.exports = true;\n'],
		['app/desktop/window.html', '<script src="preload.cjs"></script>\n'],
		['app/desktop/ignored.json', '{}\n'],
		['renderer/assets/editor-abc.js', 'globalThis.editor = true;\n'],
		['renderer/desktop-renderer-smoke.js', 'export const smoke = true;\n'],
		[RENDERER_WASM, WASM],
		['renderer/index.html', options.rendererDocument ?? '<main></main>\n'],
		['renderer-source-maps/desktop-renderer-smoke.js.map', JSON.stringify({ version: 3, sources: [] })],
		['renderer-source-maps/editor-abc.js.map', JSON.stringify({ version: 3, sources: [] })],
		[RUNTIME_WASM, WASM],
	]);
	const distribution = assistanceRuntimeDistribution();
	const distributionBytes = Buffer.from(`${JSON.stringify(distribution, null, 2)}\n`);
	files.set('app/config/assistance-runtime-distribution.json', distributionBytes.toString('utf8'));
	for (const [name, contents] of files) await write(join(buildRoot, name), contents);
	await write(join(buildRoot, 'stage-manifest.json'), `${JSON.stringify({
		schemaVersion: 1,
		productId,
		sourceRevision: REVISION,
		target: { platform: 'linux', arch: 'x64' },
		assistanceRuntimeDistribution: {
			targetId: distribution.targetId,
			manifest: {
				path: 'config/assistance-runtime-distribution.json',
				byteLength: distributionBytes.byteLength,
				sha256: createHash('sha256').update(distributionBytes).digest('hex'),
			},
			signingFiles: [],
			bundles: distribution.bundles.map(({ familyId, archive }) => ({
				familyId, sha256: archive.sha256, byteLength: archive.byteLength,
			})),
		},
	}, null, 2)}\n`);
	const resources = join(productOutput, options.packagedResourcesPath ?? 'linux-unpacked/resources');
	for (const [name, contents] of files) {
		if (name.startsWith('renderer/') || name.startsWith('runtime/')) {
			await write(join(resources, name), contents);
		}
	}
	for (const [name, contents] of options.packagedResourceExtras ?? []) {
		await write(join(resources, name), contents);
	}
	const packagedApplicationRoot = join(workspace, 'packaged-app');
	for (const [name, contents] of files) {
		if (name.startsWith('app/')) await write(join(packagedApplicationRoot, name.slice(4)), contents);
	}
	for (const [name, contents] of options.packagedApplicationExtras ?? []) {
		await write(join(packagedApplicationRoot, name), contents);
	}
	await createPackage(packagedApplicationRoot, join(resources, 'app.asar'));
	return { buildRoot, files, productOutput };
}

async function write(path: string, contents: string) {
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, contents);
}

function assistanceRuntimeDistribution() {
	const targetId = 'linux-x64';
	const families = [
		['sherpa-onnx-node', '1.13.5', 'sherpa-onnx'],
		['onnxruntime-node', '1.29.0', 'onnxruntime-node'],
		['whisper-cpp', 'v1.9.3', 'whisper-cpp'],
		['llama-cpp', 'b10509', 'llama-cpp'],
		['kokoro-g2p', '0.9.4', 'kokoro-g2p'],
	] as const;
	return {
		schemaVersion: 1,
		targetId,
		bundles: families.map(([familyId, runtimeVersion, prefix]) => {
			const runtimePrefix = `assistance/${prefix}/${runtimeVersion}`;
			const archiveSha256 = createHash('sha256').update(familyId).digest('hex');
			return {
				familyId, runtimeVersion, runtimePrefix,
				installPath: familyId === 'sherpa-onnx-node'
					? runtimePrefix : `${runtimePrefix}/${targetId}`,
				archive: {
					url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/${runtimeVersion}/${targetId}/${archiveSha256}.tar.gz`,
					byteLength: 128, sha256: archiveSha256,
				},
				files: [{ path: 'bin/runtime', byteLength: 1, sha256: archiveSha256, executable: true }],
			};
		}),
	};
}
