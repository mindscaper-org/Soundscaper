/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { motionReferenceSourcePaths, readMotionReferenceSources } from '../scripts/lib/motionscaper-reference-sources.ts';

test('audited decoder source authority binds its compiler, CMake project and exact native toolchain', async context => {
	const root = await mkdtemp(join(tmpdir(), 'motion-reference-source-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const paths = motionReferenceSourcePaths('win-arm64', true);
	assert.ok(paths.includes('scripts/lib/motionscaper-reference-native/CMakeLists.txt'));
	assert.ok(paths.includes('native/framescaper-media-host/build/toolchains/win-arm64.cmake'));
	assert.ok(paths.includes('scripts/lib/framescaper-media-host-toolchain.mjs'));
	for (const path of paths) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), `committed ${path}\n`); }
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
	git('init', '--quiet'); git('add', '--', ...paths);
	git('-c', 'user.name=Motion reference test', '-c', 'user.email=reference@example.invalid', 'commit', '--quiet', '-m', 'Reference input fixture');
	const accepted = await readMotionReferenceSources(root, 'win-arm64', true);
	assert.equal(accepted.sourceFiles.length, paths.length);
	assert.match(accepted.sourceRevision, /^[a-f\d]{40}$/u);
	await writeFile(join(root, 'scripts/lib/motionscaper-reference-build.ts'), 'changed compiler adapter\n');
	await assert.rejects(readMotionReferenceSources(root, 'win-arm64', true), /committed|clean/u);
});

test('legacy Linux receipt keeps its existing two-source authority and cannot become non-Linux', () => {
	assert.deepEqual(motionReferenceSourcePaths('linux-x64', false), [
		'scripts/lib/motionscaper-native-reference.cpp', 'desktop/motionscaper-native-reference.ts',
	]);
	for (const target of ['win-x64', 'win-arm64', 'mac-arm64'] as const) {
		assert.throws(() => motionReferenceSourcePaths(target, false), /legacy.*Linux/u);
	}
});
