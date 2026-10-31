/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { inspectPhotoNativeDependenciesCurrentV1 as inspect } from '../scripts/lib/lightscaper-photo-native-dependencies-current-v1.ts';
import { photoNativePathsCurrentV1 as paths } from '../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';

type LinuxTarget = 'linux-x64' | 'linux-arm64';
const TARGETS: readonly LinuxTarget[] = ['linux-x64', 'linux-arm64'];
const OPTIONS = { skip: process.platform !== 'linux', timeout: 10_000 } as const;
function loader(target: LinuxTarget): string { return target === 'linux-x64' ? 'ld-linux-x86-64.so.2' : 'ld-linux-aarch64.so.1'; }
function artifacts(target: LinuxTarget): readonly string[] { const value = paths(target); return [value.filesystem, value.raw, value.launcher]; }

// Real ELF64 files with an actual PT_DYNAMIC/DT_NEEDED string table are read by
// the maintained physical architecture parser and GNU readelf. No ELF is executed.
function elf(target: LinuxTarget, imports: readonly string[], rpath?: Readonly<{ tag: 15 | 29; path: string }>): Buffer {
	const strings: number[] = [0];
	function string(value: string): number { const offset = strings.length; strings.push(...Buffer.from(value), 0); return offset; }
	const entries: [number, number][] = imports.map(value => [1, string(value)]);
	if (rpath) entries.push([rpath.tag, string(rpath.path)]);
	entries.push([5, 0x100], [10, strings.length], [0, 0]);
	assert.ok(strings.length <= 0x100 && entries.length * 16 <= 0x200);
	const bytes = Buffer.alloc(0x580), names = Buffer.from('\0.dynstr\0.dynamic\0.shstrtab\0');
	bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
	bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(target === 'linux-x64' ? 62 : 183, 18); bytes.writeUInt32LE(1, 20);
	bytes.writeBigUInt64LE(64n, 32); bytes.writeBigUInt64LE(0x480n, 40); bytes.writeUInt16LE(64, 52);
	bytes.writeUInt16LE(56, 54); bytes.writeUInt16LE(2, 56); bytes.writeUInt16LE(64, 58);
	bytes.writeUInt16LE(4, 60); bytes.writeUInt16LE(3, 62);
	function program(index: number, type: number, offset: number, size: number, alignment: number): void {
		const at = 64 + index * 56; bytes.writeUInt32LE(type, at); bytes.writeUInt32LE(6, at + 4);
		for (const field of [8, 16, 24]) bytes.writeBigUInt64LE(BigInt(offset), at + field);
		for (const field of [32, 40]) bytes.writeBigUInt64LE(BigInt(size), at + field);
		bytes.writeBigUInt64LE(BigInt(alignment), at + 48);
	}
	program(0, 1, 0, bytes.length, 0x1000); program(1, 2, 0x200, entries.length * 16, 8);
	bytes.set(strings, 0x100); bytes.set(names, 0x400);
	for (const [index, [tag, value]] of entries.entries()) {
		bytes.writeBigInt64LE(BigInt(tag), 0x200 + index * 16); bytes.writeBigUInt64LE(BigInt(value), 0x208 + index * 16);
	}
	function section(index: number, name: number, type: number, offset: number, size: number, alignment: number, link = 0, entrySize = 0): void {
		const at = 0x480 + index * 64; bytes.writeUInt32LE(name, at); bytes.writeUInt32LE(type, at + 4);
		bytes.writeBigUInt64LE(index === 3 ? 0n : 2n, at + 8); bytes.writeBigUInt64LE(index === 3 ? 0n : BigInt(offset), at + 16);
		bytes.writeBigUInt64LE(BigInt(offset), at + 24); bytes.writeBigUInt64LE(BigInt(size), at + 32);
		bytes.writeUInt32LE(link, at + 40); bytes.writeBigUInt64LE(BigInt(alignment), at + 48); bytes.writeBigUInt64LE(BigInt(entrySize), at + 56);
	}
	section(1, 1, 3, 0x100, strings.length, 1); section(2, 9, 6, 0x200, entries.length * 16, 8, 1, 16);
	section(3, 18, 3, 0x400, names.length, 1); return bytes;
}
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-photo-elf-imports-')));
	try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function writeArtifacts(root: string, target: LinuxTarget, bytes: Buffer, only?: string): Promise<void> {
	for (const artifact of artifacts(target)) {
		const path = join(root, artifact); await mkdir(dirname(path), { recursive: true });
		await writeFile(path, only === undefined || artifact === only ? bytes : elf(target, ['libc.so.6']), { mode: 0o600 });
	}
}
for (const target of TARGETS) {
	void test(`Photo ${target} physical ELF dependency inspection admits only its own exact loader and core substrate`, OPTIONS, async () => fixture(async root => {
		const imports = ['libc.so.6', 'libstdc++.so.6', loader(target)]; await writeArtifacts(root, target, elf(target, imports));
		const result = await inspect(root, target); assert.equal(result.length, 3);
		for (const [index, row] of result.entries()) {
			assert.equal(row.path, artifacts(target)[index]); assert.deepEqual(row.imports, [...imports].sort()); assert.deepEqual(row.rpaths, []);
			assert.deepEqual(row.architecture, { schemaVersion: 1, target, format: 'elf64-le', architecture: target.slice(6), machine: target === 'linux-x64' ? 'EM_X86_64' : 'EM_AARCH64' });
		}
	}));
	void test(`Photo ${target} physical ELF rejects wrong-CPU, path-bearing and unknown imports with exact artifact diagnostics`, OPTIONS, async () => fixture(async root => {
		const other = target === 'linux-x64' ? 'linux-arm64' : 'linux-x64';
		for (const artifact of artifacts(target)) for (const imported of [loader(other), `/lib/${loader(target)}`, `runtime/${loader(target)}`, loader(target).toUpperCase(), 'libatomic.so.1', 'libforeign-photo.so.1']) {
			await writeArtifacts(root, target, elf(target, [imported]), artifact);
			await assert.rejects(inspect(root, target), (error: unknown) => {
				assert.ok(error instanceof Error); assert.ok(error.message.includes(target)); assert.ok(error.message.includes(artifact)); assert.ok(error.message.includes(imported)); return true;
			});
		}
	}));
	void test(`Photo ${target} physical ELF still rejects every RPATH and RUNPATH`, OPTIONS, async () => fixture(async root => {
		for (const tag of [15, 29] as const) {
			await writeArtifacts(root, target, elf(target, ['libc.so.6'], { tag, path: '$ORIGIN/runtime' }));
			await assert.rejects(inspect(root, target), /ambient RPATH/u);
		}
	}));
	void test(`Photo ${target} physical architecture admission rejects the other CPU before dependency credit`, OPTIONS, async () => fixture(async root => {
		await writeArtifacts(root, target, elf(target === 'linux-x64' ? 'linux-arm64' : 'linux-x64', ['libc.so.6']));
		await assert.rejects(inspect(root, target), /not target-native/u);
	}));
}
