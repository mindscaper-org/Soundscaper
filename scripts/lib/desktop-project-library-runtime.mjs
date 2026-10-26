/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from './desktop-project-library-expected-runtime-files.mjs';
import { DESKTOP_RUNTIME_BUNDLED_LEAF_FILES } from './desktop-5b-transitive-runtime-files.mjs';
import { stageDesktopBundledAudioRuntime } from './desktop-bundled-audio-runtime.mjs';
import { assertNoTypeScriptImportSpecifiers, assertStagedDesktopImportsResolve } from './desktop-staged-import-hygiene.mjs';
import { stageBundledAudioCodecRuntimeManifest } from './desktop-bundled-audio-codec-runtime-closure.mjs';
import {
	assertDesktopProductPackageIsolation,
	desktopProductRuntimePackageImports,
	desktopProductSourceIncluded,
} from './desktop-product-package-files.mjs';
import {
	collectApplicationDesktopRuntimeReferences, bundleDesktopMainPreload, retainDesktopRuntimeClosureAfterBundling,
	collectDesktopProductRuntimeClosure,
	desktopProductRuntimeTransform,
	stageSoundscaperDesktopEntrySources,
} from './desktop-product-runtime-staging.mjs';
const FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE = 'framescaper-capture-sandbox-preload.cjs';
const FRAMESCAPER_WEB_VCR_PRELOAD_BUNDLE = 'framescaper-web-vcr-sandbox-preload.cjs';
const SOUNDSCAPER_PRELOAD_BUNDLE = 'soundscaper-project-library-sandbox-preload.cjs';
const DESKTOP_ONLY_EXCLUDED_SOURCES = Object.freeze(new Set(['bundled-audio-codec-runtime-manifest.json', 'ffmpeg-corresponding-source.json']));
// Staged sources ship no TypeScript loader. Package aliases resolve to source
// TypeScript in the repository and compiled runtime members in the application.
export const DESKTOP_RUNTIME_PACKAGE_IMPORTS = Object.freeze({
	'#desktop-runtime/ffmpeg-video-source-characteristics':
		'./desktop/project-library-runtime/src/common/editor/ffmpeg-video-source-characteristics.js',
	'#desktop-runtime/ffmpeg-video-timing-probe':
		'./desktop/project-library-runtime/src/common/editor/ffmpeg-video-timing-probe.js',
	'#desktop-runtime/helper-contract':
		'./desktop/project-library-runtime/desktop/helper-contract.js',
	'#desktop-runtime/video-source-characteristics':
		'./desktop/project-library-runtime/src/common/editor/video-source-characteristics.js',
	'#desktop-runtime/video-timing-asset':
		'./desktop/project-library-runtime/src/common/editor/video-timing-asset.js',
});

export { DESKTOP_EXPECTED_RUNTIME_FILES };

export async function compileDesktopProjectLibraryRuntime({ repositoryRoot, outputRoot }) {
	const root = resolveRequiredPath(repositoryRoot, 'repository root');
	const output = resolveRequiredPath(outputRoot, 'desktop runtime output');
	if (output === root) throw new TypeError('Desktop runtime output cannot overwrite the repository root');
	await mkdir(output, { recursive: true });
	await run(process.execPath, [
		resolve(root, 'node_modules/typescript/bin/tsc'),
		'--project', resolve(root, 'tsconfig.desktop-runtime.json'),
		'--outDir', output,
	], root);
	await bundleRuntimeHashModules(root, output);
	await stageDesktopBundledAudioRuntime({ repositoryRoot: root, outputRoot: output });
	const files = await listRuntimeFiles(output);
	assertExpectedRuntime(files);
	for (const name of files.filter((file) => /\.[cm]?js$/u.test(file))) {
		assertNoTypeScriptImportSpecifiers(`Desktop runtime ${name}`, await readFile(join(output, name), 'utf8'));
	}
	return Object.freeze({ files: Object.freeze(files) });
}

async function bundleRuntimeHashModules(root, output) {
	for (const name of DESKTOP_RUNTIME_BUNDLED_LEAF_FILES) {
		const outputPath = join(output, name);
		const result = await build({
			entryPoints: [outputPath],
			bundle: true,
			platform: 'node', conditions: name === 'desktop/mcp-service.js' ? ['workerd'] : undefined, define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false' },
			format: 'esm',
			target: 'node26',
			write: false,
			nodePaths: [join(root, 'node_modules')],
			logLevel: 'silent',
		});
		if (result.outputFiles?.length !== 1) {
			throw new Error(`Desktop runtime hash bundling produced an unexpected output set for ${name}`);
		}
		await writeFile(outputPath, result.outputFiles[0].contents);
	}
}

export async function stageDesktopApplicationSources({
	desktopSourceRoot,
	applicationDesktopRoot,
	runtimeRoot,
	productId = 'framescaper',
}) {
	const sourceRoot = resolveRequiredPath(desktopSourceRoot, 'desktop source root');
	const applicationRoot = resolveRequiredPath(applicationDesktopRoot, 'application desktop root');
	const compiledRoot = resolveRequiredPath(runtimeRoot, 'compiled desktop runtime root');
	const runtimeFiles = await listRuntimeFiles(compiledRoot);
	assertExpectedRuntime(runtimeFiles);
	await cp(sourceRoot, applicationRoot, {
		recursive: true,
		filter: (source) => {
			const relativePath = source.slice(sourceRoot.length + 1).replaceAll('\\', '/');
			return source === sourceRoot || extname(source) !== '.ts'
				&& !DESKTOP_ONLY_EXCLUDED_SOURCES.has(relativePath)
				&& desktopProductSourceIncluded(productId, relativePath);
		},
	});
	if (productId === 'soundscaper') {
		await stageSoundscaperDesktopEntrySources(sourceRoot, applicationRoot);
	}
	const stagedSourceFiles = await listRuntimeFiles(applicationRoot);
	const runtimeRoots = await collectApplicationDesktopRuntimeReferences({
		applicationRoot,
		applicationFiles: stagedSourceFiles,
		completeFiles: runtimeFiles,
		runtimePackageImports: desktopProductRuntimePackageImports(productId, DESKTOP_RUNTIME_PACKAGE_IMPORTS),
	});
	let packagedRuntimeFiles = await collectDesktopProductRuntimeClosure({
		compiledRoot,
		completeFiles: runtimeFiles,
		rootFiles: runtimeRoots,
		productId,
	});
	for (const name of packagedRuntimeFiles) {
		const output = join(applicationRoot, 'project-library-runtime', name);
		await mkdir(dirname(output), { recursive: true });
		const transform = desktopProductRuntimeTransform(productId, name);
		if (transform) await writeFile(output,
			transform(await readFile(join(compiledRoot, name), 'utf8')), { flag: 'wx' });
		else await cp(join(compiledRoot, name), output, { errorOnExist: true });
	}
	await stageBundledAudioCodecRuntimeManifest({ desktopRoot: applicationRoot });
	await bundleDesktopMainPreload(applicationRoot);
	packagedRuntimeFiles = await retainDesktopRuntimeClosureAfterBundling({ applicationRoot, applicationFiles: stagedSourceFiles, compiledRoot, completeFiles: runtimeFiles, stagedFiles: packagedRuntimeFiles, productId, runtimePackageImports: desktopProductRuntimePackageImports(productId, DESKTOP_RUNTIME_PACKAGE_IMPORTS) });
	await assertStagedDesktopImportsResolve(applicationRoot);
	assertRuntimePackageImportTargets(productId, packagedRuntimeFiles);
	await bundleSandboxPreload({
		entryPoint: join(sourceRoot, 'soundscaper-project-library-sandbox-preload.ts'),
		cryptoShim: join(sourceRoot, 'soundscaper-project-library-sandbox-crypto.ts'),
		outputPath: join(applicationRoot, SOUNDSCAPER_PRELOAD_BUNDLE),
		productName: 'Soundscaper 1.0',
	});
	if (productId === 'framescaper') {
		await bundleSandboxPreload({
			entryPoint: join(sourceRoot, 'framescaper-capture-sandbox-preload.ts'),
			cryptoShim: join(sourceRoot, 'project-library-sandbox-crypto.ts'),
			outputPath: join(applicationRoot, FRAMESCAPER_CAPTURE_PRELOAD_BUNDLE),
			productName: 'Framescaper Capture',
		});
		await bundleSandboxPreload({
			entryPoint: join(sourceRoot, 'framescaper-web-vcr-sandbox-preload.ts'),
			cryptoShim: join(sourceRoot, 'project-library-sandbox-crypto.ts'),
			outputPath: join(applicationRoot, FRAMESCAPER_WEB_VCR_PRELOAD_BUNDLE),
			productName: 'Framescaper Web VCR',
		});
	}
	if (productId === 'soundscaper') {
		const applicationFiles = await listRuntimeFiles(applicationRoot);
		const textFiles = applicationFiles.filter((name) => /\.(?:c?js|mjs)$/u.test(name));
		assertDesktopProductPackageIsolation(productId, applicationFiles,
			new Map(await Promise.all(textFiles.map(async (name) => [
				name, await readFile(join(applicationRoot, name), 'utf8'),
			]))));
	}
	return Object.freeze({ files: packagedRuntimeFiles });
}
function assertRuntimePackageImportTargets(productId, packagedFiles) {
	const runtimePrefix = './desktop/project-library-runtime/';
	const imports = desktopProductRuntimePackageImports(productId, DESKTOP_RUNTIME_PACKAGE_IMPORTS);
	for (const [alias, target] of Object.entries(imports)) {
		if (!target.startsWith(runtimePrefix)
			|| !packagedFiles.includes(target.slice(runtimePrefix.length))) {
			throw new Error(`Desktop package import ${alias} does not resolve to a shipped runtime member`);
		}
	}
}

async function bundleSandboxPreload({ entryPoint, cryptoShim, outputPath, productName }) {
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node26',
		external: ['electron'],
		alias: { 'node:crypto': cryptoShim },
		logLevel: 'silent',
	});
	const source = await readFile(outputPath, 'utf8');
	const required = [...source.matchAll(/require\(["']([^"']+)["']\)/gu)].map((match) => match[1]);
	if (required.length !== 1 || required[0] !== 'electron') {
		throw new Error(`${productName} sandbox preload retained unsupported modules: ${required.join(', ')}`);
	}
}

async function listRuntimeFiles(root, relativeRoot = '') {
	const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...await listRuntimeFiles(root, relativePath));
		else if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}

function assertExpectedRuntime(files) {
	if (files.length !== DESKTOP_EXPECTED_RUNTIME_FILES.length
		|| files.some((name, index) => name !== DESKTOP_EXPECTED_RUNTIME_FILES[index])) {
		const expected = new Set(DESKTOP_EXPECTED_RUNTIME_FILES);
		const actual = new Set(files);
		const missing = DESKTOP_EXPECTED_RUNTIME_FILES.filter((name) => !actual.has(name));
		const unexpected = files.filter((name) => !expected.has(name));
		throw new Error(
			`Desktop runtime output is incomplete or stale; missing: ${missing.join(', ') || '(none)'}; unexpected: ${unexpected.join(', ') || '(none)'}`,
		);
	}
}
function resolveRequiredPath(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Desktop runtime ${label} is required`);
	return resolve(value);
}

function run(command, args, cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`Desktop runtime compiler exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}`));
		});
	});
}
