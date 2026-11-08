/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const PREFIX = 'libraw/0.22.2/';
const MAX_FILE_BYTES = 2 * 1024 ** 2;
const MAX_CLOSURE_BYTES = 16 * 1024 ** 2;

export interface DesktopLightscaperRawFileCurrentV1 {
	readonly source: string;
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}
export interface DesktopLightscaperRawReceiptCurrentV1 {
	readonly schemaVersion: 1;
	readonly kind: 'lightscaper-desktop-pinned-libraw-wasm-v1';
	readonly totalByteLength: number;
	readonly files: readonly Readonly<{ path: string; byteLength: number; sha256: string }>[];
}

/** Reviewed bytes already tracked in the repository. Source-tree paths preserve
 * the original notice links and both complete source release closures. */
export const DESKTOP_LIGHTSCAPER_RAW_FILES_CURRENT_V1: readonly DesktopLightscaperRawFileCurrentV1[] = Object.freeze([
	{ source: 'runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz',
		path: 'libraw/0.22.2/LibRaw-0.22.2.tar.gz', byteLength: 1682962,
		sha256: 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa' },
	{ source: 'runtime-assets/libraw/0.22.2/corresponding-source.tar.gz',
		path: 'libraw/0.22.2/corresponding-source.tar.gz', byteLength: 1736708,
		sha256: 'c5fa0c9743b2699f8893cdc1597dfa27966bed5b56baabac2b7464c4f827e1c9' },
	{ source: 'runtime-assets/libraw/0.22.2/corresponding-source.tar.gz.sha256',
		path: 'libraw/0.22.2/corresponding-source.tar.gz.sha256', byteLength: 94,
		sha256: 'c2b84d204590777bbac26decd56d9981cbad5d88bc89764053c21244912ea4c7' },
	{ source: 'runtime-assets/libraw/0.22.2/libraw.wasm',
		path: 'libraw/0.22.2/libraw.wasm', byteLength: 876336,
		sha256: '7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29' },
	{ source: 'runtime-assets/libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz',
		path: 'libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz', byteLength: 1737942,
		sha256: '1b7eadb655f594ef91ac98e8379808bac9897d34f2ca4e626ea8938a83430fa5' },
	{ source: 'runtime-assets/libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz.sha256',
		path: 'libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz.sha256', byteLength: 94,
		sha256: '44b15c11fea9faa197c9fc602cd507cbf1b13c7132e2420eac5180c721310e04' },
	{ source: 'runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm',
		path: 'libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', byteLength: 871145,
		sha256: 'ee86c46d33cfb424cdc8468255ec349a823cc2221f5a0e5a54cc8571808b09b7' },
	{ source: 'LICENSE',
		path: 'libraw/0.22.2/source/LICENSE', byteLength: 34523,
		sha256: '8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef' },
	{ source: 'config/lightscaper-libraw-recovery-runtime-manifest.json',
		path: 'libraw/0.22.2/source/config/lightscaper-libraw-recovery-runtime-manifest.json', byteLength: 4091,
		sha256: 'fa7e71218e2d6729bcd4252cb962e4d99db2c32cb8670937cda341dfe232a7b7' },
	{ source: 'config/lightscaper-libraw-runtime-manifest.json',
		path: 'libraw/0.22.2/source/config/lightscaper-libraw-runtime-manifest.json', byteLength: 3446,
		sha256: '4aa8c5377f3b6774cce23f9961c864fae798723a6c09a18dd17aa2f581fb27da' },
	{ source: 'docs/architecture/lightscaper-raw-decoder.md',
		path: 'libraw/0.22.2/source/docs/architecture/lightscaper-raw-decoder.md', byteLength: 11644,
		sha256: '211aa3b01330b5f5ae0b65f23f4c0bee0b3e76b9027f27b793c15a7269c97c94' },
	{ source: 'docs/architecture/lightscaper-raw-recovery.md',
		path: 'libraw/0.22.2/source/docs/architecture/lightscaper-raw-recovery.md', byteLength: 8429,
		sha256: 'a4b4f18bfe702694ada14d5b1069dafb2d115ff538e1bad7a73686394bdbda69' },
	{ source: 'runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz',
		path: 'libraw/0.22.2/source/runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz', byteLength: 1682962,
		sha256: 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa' },
	{ source: 'scripts/audit-lightscaper-libraw-recovery-wasm.mjs',
		path: 'libraw/0.22.2/source/scripts/audit-lightscaper-libraw-recovery-wasm.mjs', byteLength: 8725,
		sha256: '4c0aea0702cef3db755f12545259972ab437af22038b1c95be5b199ebf38b5ee' },
	{ source: 'scripts/audit-lightscaper-libraw-wasm.mjs',
		path: 'libraw/0.22.2/source/scripts/audit-lightscaper-libraw-wasm.mjs', byteLength: 8882,
		sha256: '3603272393ccf3c9f65a201a6f58c2de329e97ed2d8fcdfcfd2b7889b26a18e1' },
	{ source: 'scripts/build-lightscaper-libraw-recovery-wasm.mjs',
		path: 'libraw/0.22.2/source/scripts/build-lightscaper-libraw-recovery-wasm.mjs', byteLength: 10540,
		sha256: 'aff71d163531d45c9b28ede49e45d04972db46a5d62408c410850462a7e85dc2' },
	{ source: 'scripts/build-lightscaper-libraw-wasm.mjs',
		path: 'libraw/0.22.2/source/scripts/build-lightscaper-libraw-wasm.mjs', byteLength: 10328,
		sha256: '5b76bdd3ca78386a86f3fc90868b31007eb9a23067d8748cc8d76905ac1793a3' },
	{ source: 'scripts/lib/lightscaper-libraw-recovery-profile.mjs',
		path: 'libraw/0.22.2/source/scripts/lib/lightscaper-libraw-recovery-profile.mjs', byteLength: 3150,
		sha256: 'd3fa979035bfac3ef5753712d19b25a18c1edfb1df71100659dfbbd194c473ef' },
	{ source: 'scripts/lib/wasm-binary-inspection.mjs',
		path: 'libraw/0.22.2/source/scripts/lib/wasm-binary-inspection.mjs', byteLength: 3243,
		sha256: 'a2f029c0f780720d8a7b1b60d702eaed0e813dba07ea6618d17cd530f9d6aa90' },
	{ source: 'scripts/package-lightscaper-libraw-recovery-source.mjs',
		path: 'libraw/0.22.2/source/scripts/package-lightscaper-libraw-recovery-source.mjs', byteLength: 3344,
		sha256: 'd3fbf96c2ff80c77385c004282ca93b2dca74c462ca173b55688643552f2badf' },
	{ source: 'scripts/package-lightscaper-libraw-source.mjs',
		path: 'libraw/0.22.2/source/scripts/package-lightscaper-libraw-source.mjs', byteLength: 3186,
		sha256: '7972adbc49f64df84766ea58d735046ee6f4c1e5e912dc30a32bda2508ae38c1' },
	{ source: 'src/common/editor/raw/NOTICE.md',
		path: 'libraw/0.22.2/source/src/common/editor/raw/NOTICE.md', byteLength: 1922,
		sha256: '87f9943ac79c6b0548f2b0c7a83cba7efbfb3cb80f4fd6350bfb7cf9d459162e' },
	{ source: 'src/common/editor/raw/RECOVERY-NOTICE.md',
		path: 'libraw/0.22.2/source/src/common/editor/raw/RECOVERY-NOTICE.md', byteLength: 2325,
		sha256: '87cd31afb737cecd89b96c486a94026554550e41deefbec2e23ca684f6a3339b' },
	{ source: 'src/common/editor/raw/licenses/COMPILER_RT.txt',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/COMPILER_RT.txt', byteLength: 16708,
		sha256: '1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d' },
	{ source: 'src/common/editor/raw/licenses/COPYRIGHT',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/COPYRIGHT', byteLength: 1153,
		sha256: '574c88f5dd59414cfc896293a63defbc2d525a418ed413d7ab7dcc43cf79c509' },
	{ source: 'src/common/editor/raw/licenses/EMSCRIPTEN.txt',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/EMSCRIPTEN.txt', byteLength: 5093,
		sha256: '620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86' },
	{ source: 'src/common/editor/raw/licenses/LIBCXX.txt',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/LIBCXX.txt', byteLength: 16703,
		sha256: '539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b' },
	{ source: 'src/common/editor/raw/licenses/LIBCXXABI.txt',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/LIBCXXABI.txt', byteLength: 16706,
		sha256: 'e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c' },
	{ source: 'src/common/editor/raw/licenses/LICENSE.CDDL',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/LICENSE.CDDL', byteLength: 16906,
		sha256: '0e3098d2d54a12434715f6679ea408d57da5e8d613c385c58ecc6fe5d30cc81f' },
	{ source: 'src/common/editor/raw/licenses/LICENSE.LGPL',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/LICENSE.LGPL', byteLength: 24389,
		sha256: 'eea173a556abac0370461e57e12aab266894ea6be3874c2be05fd87871f75449' },
	{ source: 'src/common/editor/raw/licenses/MUSL.txt',
		path: 'libraw/0.22.2/source/src/common/editor/raw/licenses/MUSL.txt', byteLength: 6204,
		sha256: 'f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af' },
	{ source: 'src/common/editor/raw/native/libraw_recovery_wasm.cpp',
		path: 'libraw/0.22.2/source/src/common/editor/raw/native/libraw_recovery_wasm.cpp', byteLength: 12888,
		sha256: 'f69de3c0f110f018d847113e8437948c0433d41d21840e1d92a26206491752e4' },
	{ source: 'src/common/editor/raw/native/libraw_wasm.cpp',
		path: 'libraw/0.22.2/source/src/common/editor/raw/native/libraw_wasm.cpp', byteLength: 9509,
		sha256: '98ea306941ddc214548eed1e300c3f4cf1b717e0e29a1e85ec7d4a3b5924eede' },
].map(file => Object.freeze(file)));

interface ManifestPin { readonly path: string; readonly sha256: string; readonly byteLength?: number }
interface RawManifest {
	readonly runtime: ManifestPin;
	readonly upstream: Readonly<{ sourceArchive: ManifestPin }>;
	readonly bridge: ManifestPin;
	readonly buildRecipe: ManifestPin;
	readonly licenseFiles: readonly ManifestPin[];
}

/** Authenticate the complete source closure before making any output writes.
 * This stages existing WASM; it never builds an assistance or RAW runtime. */
export async function stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot, runtimeRoot }: Readonly<{
	repositoryRoot: string; runtimeRoot: string;
}>): Promise<DesktopLightscaperRawReceiptCurrentV1> {
	const repository = absoluteRoot(repositoryRoot), output = absoluteRoot(runtimeRoot);
	const sourceRoot = await realpath(repository);
	const captured = new Map<string, Buffer>();
	for (const file of inventory()) {
		if (!captured.has(file.source)) captured.set(file.source, await readPinnedFile(sourceRoot, file.source, file));
	}
	validateManifestClosure(captured);
	await mkdir(output, { recursive: true });
	const outputMetadata = await lstat(output);
	if (!outputMetadata.isDirectory() || outputMetadata.isSymbolicLink()) throw new Error('RAW runtime root must be a real directory.');
	const outputRoot = await realpath(output), parent = join(outputRoot, 'libraw');
	await mkdir(parent, { recursive: true });
	const parentMetadata = await lstat(parent);
	if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) throw new Error('RAW runtime parent must be a real directory.');
	assertContained(outputRoot, await realpath(parent));
	const destination = join(parent, '0.22.2');
	if (await exists(destination)) throw new Error('Lightscaper RAW runtime destination already exists.');
	let temporary: string | undefined = await mkdtemp(join(parent, '.lightscaper-raw-'));
	try {
		for (const file of inventory()) {
			const target = join(temporary, withinClosure(file.path));
			await mkdir(dirname(target), { recursive: true });
			const bytes = captured.get(file.source);
			if (!bytes) throw new Error('Reviewed RAW source capture is incomplete.');
			await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
		}
		const receipt = await verifyClosure(temporary);
		await rename(temporary, destination); temporary = undefined;
		return receipt;
	} finally {
		if (temporary) await rm(temporary, { recursive: true, force: true });
	}
}

/** Recheck the actual packaged resource subtree, independently of source files
 * and stage receipts. Missing, extra or changed payloads fail closed. */
export async function verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot }: Readonly<{
	runtimeRoot: string;
}>): Promise<DesktopLightscaperRawReceiptCurrentV1> {
	const root = absoluteRoot(runtimeRoot), realRoot = await realpath(root);
	const closure = join(root, 'libraw/0.22.2');
	const metadata = await lstat(closure);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('RAW runtime closure must be a real directory.');
	assertContained(realRoot, await realpath(closure));
	return await verifyClosure(closure);
}

function inventory(): readonly DesktopLightscaperRawFileCurrentV1[] {
	const files = DESKTOP_LIGHTSCAPER_RAW_FILES_CURRENT_V1;
	if (files.length !== 33 || files.reduce((sum, file) => sum + file.byteLength, 0) > MAX_CLOSURE_BYTES
		|| new Set(files.map(file => file.path)).size !== files.length) throw new Error('Reviewed RAW inventory changed.');
	for (const file of files) {
		withinClosure(file.path);
		if (file.source.startsWith('/') || file.source.split('/').some(part => !part || part === '.' || part === '..')
			|| file.source.includes('\\') || !/^[a-f0-9]{64}$/u.test(file.sha256)
			|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAX_FILE_BYTES) {
			throw new Error('Reviewed RAW file descriptor is invalid.');
		}
	}
	return files;
}

function validateManifestClosure(captured: ReadonlyMap<string, Buffer>): void {
	const pins = new Map(inventory().map(file => [file.source, file]));
	for (const manifestPath of ['config/lightscaper-libraw-runtime-manifest.json', 'config/lightscaper-libraw-recovery-runtime-manifest.json']) {
		const bytes = captured.get(manifestPath);
		if (!bytes) throw new Error('Reviewed RAW manifest is missing.');
		// Parsing follows exact length/digest authentication of the committed JSON.
		const manifest = JSON.parse(bytes.toString('utf8')) as RawManifest;
		for (const pin of [manifest.runtime, manifest.upstream.sourceArchive, manifest.bridge, manifest.buildRecipe, ...manifest.licenseFiles]) {
			const file = pins.get(pin.path);
			if (!file || file.sha256 !== pin.sha256 || pin.byteLength !== undefined && file.byteLength !== pin.byteLength) {
				throw new Error('Reviewed RAW manifest disagrees with its staged closure.');
			}
		}
	}
	for (const sourcePath of ['runtime-assets/libraw/0.22.2/corresponding-source.tar.gz',
		'runtime-assets/libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz']) {
		const file = pins.get(sourcePath), sidecar = captured.get(`${sourcePath}.sha256`);
		if (!file || !sidecar || sidecar.toString('utf8') !== `${file.sha256}  corresponding-source.tar.gz\n`) {
			throw new Error('Reviewed RAW corresponding-source sidecar is invalid.');
		}
	}
}

async function verifyClosure(root: string): Promise<DesktopLightscaperRawReceiptCurrentV1> {
	const files = inventory(), allowedFiles = new Set(files.map(file => withinClosure(file.path)));
	const allowedDirectories = new Set<string>();
	for (const file of allowedFiles) {
		const parts = file.split('/');
		for (let count = 1; count < parts.length; count++) allowedDirectories.add(parts.slice(0, count).join('/'));
	}
	const observed = new Set<string>();
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name), name = relative(root, path).split(sep).join('/');
			if (entry.isDirectory() && allowedDirectories.has(name)) await visit(path);
			else if (entry.isFile() && allowedFiles.has(name)) observed.add(name);
			else throw new Error('Lightscaper RAW payload leaves its closed inventory.');
		}
	}
	await visit(root);
	if (observed.size !== allowedFiles.size) throw new Error('Lightscaper RAW payload is missing a member of its closed inventory.');
	const captured = new Map<string, Buffer>();
	for (const file of files) captured.set(file.source, await readPinnedFile(root, withinClosure(file.path), file));
	validateManifestClosure(captured);
	return Object.freeze({
		schemaVersion: 1, kind: 'lightscaper-desktop-pinned-libraw-wasm-v1',
		totalByteLength: files.reduce((sum, file) => sum + file.byteLength, 0),
		files: Object.freeze(files.map(file => Object.freeze({ path: file.path, byteLength: file.byteLength, sha256: file.sha256 }))),
	});
}

async function readPinnedFile(root: string, relativePath: string, pin: DesktopLightscaperRawFileCurrentV1): Promise<Buffer> {
	const path = resolve(root, relativePath); assertContained(root, path);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Reviewed RAW payload must be a regular file: ${relativePath}`);
	assertContained(root, await realpath(path));
	if (metadata.size !== pin.byteLength) throw new Error(`Payload differs from reviewed RAW length: ${relativePath}`);
	const handle = await open(path, 'r');
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== pin.byteLength || opened.ino !== metadata.ino || opened.dev !== metadata.dev) {
			throw new Error(`Payload differs from reviewed RAW file: ${relativePath}`);
		}
		const bytes = Buffer.alloc(pin.byteLength); let offset = 0;
		while (offset < bytes.length) {
			const part = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!part.bytesRead) throw new Error(`Payload differs from reviewed RAW length: ${relativePath}`);
			offset += part.bytesRead;
		}
		const extra = Buffer.alloc(1);
		if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0 || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
			throw new Error(`Payload differs from reviewed RAW digest: ${relativePath}`);
		}
		return bytes;
	} finally { await handle.close(); }
}
function withinClosure(path: string): string {
	if (!path.startsWith(PREFIX) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
		throw new Error('Reviewed RAW path leaves its closed inventory.');
	}
	return path.slice(PREFIX.length);
}
function absoluteRoot(value: string): string {
	if (typeof value !== 'string' || !value || value.includes('\0') || !isAbsolute(value)) throw new TypeError('RAW runtime root must be absolute.');
	return resolve(value);
}
function assertContained(root: string, path: string): void {
	if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Reviewed RAW path leaves its declared root.');
}
async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; } catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}
