/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DESKTOP_LIGHTSCAPER_RAW_FILES_CURRENT_V1,
	stageDesktopLightscaperRawRuntimeCurrentV1,
	verifyDesktopLightscaperRawRuntimeCurrentV1,
} from '../scripts/lib/desktop-lightscaper-raw-runtime-current-v1.ts';

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const PREFIX = 'libraw/0.22.2/';
async function temporary() { return await mkdtemp(join(tmpdir(), 'lightscaper-desktop-raw-')); }
async function copySources(root: string): Promise<void> {
	const copied = new Set<string>();
	for (const file of DESKTOP_LIGHTSCAPER_RAW_FILES_CURRENT_V1) {
		if (copied.has(file.source)) continue;
		copied.add(file.source);
		const destination = join(root, file.source);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(join(REPOSITORY, file.source), destination);
	}
}
async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; } catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
		throw error;
	}
}

test('Lightscaper desktop ships the immutable RAW runtime and complete corresponding source offline', async context => {
	const root = await temporary(); context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const runtimeRoot = join(root, 'runtime');
	const receipt = await stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: REPOSITORY, runtimeRoot });
	assert.equal(receipt.kind, 'lightscaper-desktop-pinned-libraw-wasm-v1');
	assert.equal(receipt.files.length, 33);
	assert.equal(receipt.totalByteLength, 8_832_280);
	assert.equal(Object.isFrozen(receipt.files), true);
	const expected = new Map([
		[`${PREFIX}libraw.wasm`, '7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29'],
		[`${PREFIX}recovery-abi2/libraw-recovery.wasm`, 'ee86c46d33cfb424cdc8468255ec349a823cc2221f5a0e5a54cc8571808b09b7'],
		[`${PREFIX}corresponding-source.tar.gz`, 'c5fa0c9743b2699f8893cdc1597dfa27966bed5b56baabac2b7464c4f827e1c9'],
		[`${PREFIX}recovery-abi2/corresponding-source.tar.gz`, '1b7eadb655f594ef91ac98e8379808bac9897d34f2ca4e626ea8938a83430fa5'],
	]);
	for (const [path, hash] of expected) {
		const actual = createHash('sha256').update(await readFile(join(runtimeRoot, path))).digest('hex');
		assert.equal(actual, hash, path);
	}
	const noticePath = join(runtimeRoot, `${PREFIX}source/src/common/editor/raw/NOTICE.md`);
	assert.match(await readFile(noticePath, 'utf8'), /LGPL-2.1/);
	const guide = resolve(dirname(noticePath), '../../../../docs/architecture/lightscaper-raw-decoder.md');
	assert.match(await readFile(guide, 'utf8'), /Reproduction and source availability/);
	assert.equal(await exists(join(runtimeRoot, `${PREFIX}source/scripts/build-lightscaper-libraw-recovery-wasm.mjs`)), true);
	assert.equal(await exists(join(runtimeRoot, `${PREFIX}source/runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz`)), true);
	assert.deepEqual(await verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot }), receipt);
});

for (const [kind, relative] of [
	['missing ABI1', 'runtime-assets/libraw/0.22.2/libraw.wasm'],
	['changed ABI2', 'runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'],
	['truncated source', 'runtime-assets/libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz'],
	['changed source sidecar', 'runtime-assets/libraw/0.22.2/corresponding-source.tar.gz.sha256'],
	['changed last source license', 'src/common/editor/raw/licenses/MUSL.txt'],
] as const) {
	test(`Lightscaper desktop rejects ${kind} before creating any runtime output`, async context => {
		const root = await temporary(); context.after(async () => { await rm(root, { recursive: true, force: true }); });
		const source = join(root, 'source'), runtimeRoot = join(root, 'runtime');
		await copySources(source);
		const target = join(source, relative);
		if (kind === 'missing ABI1') await rm(target);
		else if (kind === 'changed ABI2') {
			const bytes = await readFile(target); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await writeFile(target, bytes);
		} else await writeFile(target, 'changed');
		await assert.rejects(stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: source, runtimeRoot }));
		assert.equal(await exists(runtimeRoot), false);
	});
}

test('Lightscaper desktop RAW package verification rejects tampering and extra payloads', async context => {
	const root = await temporary(); context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const runtimeRoot = join(root, 'runtime');
	await stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: REPOSITORY, runtimeRoot });
	const extra = join(runtimeRoot, `${PREFIX}unreviewed.wasm`);
	await writeFile(extra, 'extra');
	await assert.rejects(verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot }), /closed inventory/);
	await rm(extra);
	await writeFile(join(runtimeRoot, `${PREFIX}libraw.wasm`), 'changed');
	await assert.rejects(verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot }), /reviewed RAW/);
});

test('Lightscaper desktop RAW staging refuses an existing destination and source symlinks', async context => {
	const root = await temporary(); context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const runtimeRoot = join(root, 'runtime');
	await stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: REPOSITORY, runtimeRoot });
	await assert.rejects(stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: REPOSITORY, runtimeRoot }), /already exists/);
	const source = join(root, 'source'); await copySources(source);
	const path = join(source, 'runtime-assets');
	await rm(path, { recursive: true });
	await symlink(join(REPOSITORY, 'runtime-assets'), path, process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(stageDesktopLightscaperRawRuntimeCurrentV1({ repositoryRoot: source, runtimeRoot: join(root, 'symlink-output') }), /declared root/);
	assert.equal(await exists(join(root, 'symlink-output')), false);
});
