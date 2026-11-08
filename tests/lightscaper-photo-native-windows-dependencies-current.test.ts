/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inspectPhotoNativeDependenciesCurrentV1 as inspect } from '../scripts/lib/lightscaper-photo-native-dependencies-current-v1.ts';
import { photoNativePathsCurrentV1 as paths } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';

type WindowsTarget = 'win-x64' | 'win-arm64';
const TARGETS: readonly WindowsTarget[] = ['win-x64', 'win-arm64'];
function artifacts(target: WindowsTarget): readonly string[] { const value = paths(target); return [value.filesystem, value.raw, value.launcher]; }

// These physical PE32+ import tables pass through the maintained architecture
// and dependency parsers. No fixture binary or external SDK tool is executed.
function pe(target: WindowsTarget, imports: readonly string[]): Buffer {
	const bytes = Buffer.alloc(2048);
	bytes.write('MZ', 0, 'ascii'); bytes.writeUInt32LE(0x80, 0x3c); bytes.write('PE\0\0', 0x80, 'binary');
	bytes.writeUInt16LE(target === 'win-x64' ? 0x8664 : 0xaa64, 0x84);
	bytes.writeUInt16LE(1, 0x86); bytes.writeUInt16LE(0xf0, 0x94); bytes.writeUInt16LE(0x20b, 0x98);
	bytes.writeUInt32LE(0x200, 0x98 + 60); bytes.writeUInt32LE(16, 0x98 + 108);
	bytes.writeUInt32LE(0x1000, 0x98 + 120); bytes.writeUInt32LE((imports.length + 1) * 20, 0x98 + 124);
	const section = 0x98 + 0xf0; bytes.write('.rdata', section, 'ascii');
	bytes.writeUInt32LE(0x600, section + 8); bytes.writeUInt32LE(0x1000, section + 12);
	bytes.writeUInt32LE(0x600, section + 16); bytes.writeUInt32LE(0x200, section + 20);
	let nameRva = 0x1200;
	for (const [index, name] of imports.entries()) {
		bytes.writeUInt32LE(nameRva, 0x200 + index * 20 + 12);
		bytes.write(`${name}\0`, 0x200 + nameRva - 0x1000, 'ascii'); nameRva += Buffer.byteLength(name) + 1;
	}
	return bytes;
}
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-photo-pe-imports-')));
	try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function writeArtifacts(root: string, target: WindowsTarget, bytes: Buffer, only?: string): Promise<void> {
	for (const artifact of artifacts(target)) {
		const path = join(root, artifact); await mkdir(dirname(path), { recursive: true });
		await writeFile(path, only === undefined || artifact === only ? bytes : pe(target, ['KERNEL32.dll']), { mode: 0o600 });
	}
}
for (const target of TARGETS) {
	void test(`Photo ${target} physical PE admits actual Winsock substrate and exact API-set names`, { timeout: 10_000 }, async () => fixture(async root => {
		const imports = ['KERNEL32.DLL', 'Ws2_32.DlL', 'api-ms-win-core-file-l1-2-0.dll'];
		await writeArtifacts(root, target, pe(target, imports)); const result = await inspect(root, target);
		assert.equal(result.length, 3);
		for (const [index, row] of result.entries()) {
			assert.equal(row.path, artifacts(target)[index]); assert.deepEqual(row.imports, [...imports].sort()); assert.deepEqual(row.rpaths, []);
			assert.deepEqual(row.architecture, { schemaVersion: 1, target, format: 'pe32-plus', architecture: target.slice(4),
				machine: target === 'win-x64' ? 'IMAGE_FILE_MACHINE_AMD64' : 'IMAGE_FILE_MACHINE_ARM64' });
		}
	}));
	void test(`Photo ${target} physical PE refuses undeclared DLLs with exact artifact and target diagnostics`, { timeout: 10_000 }, async () => fixture(async root => {
		for (const artifact of artifacts(target)) for (const imported of ['foreign-photo.dll', 'ws2_32x.dll', 'wsock32.dll', 'api-ms-winx-core-file-l1-2-0.dll']) {
			await writeArtifacts(root, target, pe(target, [imported]), artifact);
			await assert.rejects(inspect(root, target), (error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(error.message, `Photo native artifact ${artifact} for ${target} has an undeclared ambient dependency: ${imported}`); return true;
			});
		}
	}));
	void test(`Photo ${target} physical PE still refuses path-bearing and other-OS imports`, { timeout: 10_000 }, async () => fixture(async root => {
		for (const imported of ['folder\\WS2_32.dll', '../WS2_32.dll', 'C:WS2_32.dll', 'libc.so.6', '/usr/lib/libSystem.B.dylib']) {
			await writeArtifacts(root, target, pe(target, [imported])); await assert.rejects(inspect(root, target), /portable DLL basename/u);
		}
	}));
	void test(`Photo ${target} physical PE still rejects wrong CPU and PE32 before dependency credit`, { timeout: 10_000 }, async () => fixture(async root => {
		await writeArtifacts(root, target, pe(target === 'win-x64' ? 'win-arm64' : 'win-x64', ['WS2_32.dll']));
		await assert.rejects(inspect(root, target), /not target-native/u);
		const legacy = pe(target, ['WS2_32.dll']); legacy.writeUInt16LE(0x10b, 0x98); await writeArtifacts(root, target, legacy);
		await assert.rejects(inspect(root, target), /PE32\+/u);
	}));
}
