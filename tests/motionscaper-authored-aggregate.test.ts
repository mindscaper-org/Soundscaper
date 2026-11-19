/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { requireMotionAuthoredAggregateTarget, runMotionAuthoredAggregate } from '../scripts/lib/motionscaper-authored-aggregate.ts';

test('Motion authored aggregate admits both declared Linux architectures and every own native target', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64', 'mac-arm64']) {
		assert.doesNotThrow(() => requireMotionAuthoredAggregateTarget(target));
	}
	for (const target of ['darwin-x64', 'mac-x64', 'win32-x64', 'unknown']) {
		assert.throws(() => requireMotionAuthoredAggregateTarget(target), /(?:unqualified|unsupported|target)/iu);
	}
});

test('Motion aggregate authored phase owns short private runtime paths and the unchanged standalone command', async () => {
	const output = await mkdtemp(join(tmpdir(), 'motion-aggregate-test-'));
	const inherited = { DISPLAY: ':777', TMPDIR: '/inherited/tmp', XDG_RUNTIME_DIR: '/inherited/xdg' };
	let runtime = '';
	try {
		const result = await runMotionAuthoredAggregate('/checkout', output, inherited, async options => {
			assert.equal(options.command, process.execPath); assert.equal(options.cwd, '/checkout');
			assert.deepEqual(options.args, ['/checkout/scripts/motionscaper-authored-native-smoke.mjs', `--output=${output}/authored`]);
			assert.equal(options.timeoutMs, 210000); assert.equal(options.directory, join(output, 'authored-command'));
			assert.equal(options.env?.MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY, ':777');
			assert.equal(options.env?.DISPLAY, ':777');
			for (const key of ['TMPDIR', 'XDG_RUNTIME_DIR']) {
				const path: string | undefined = options.env?.[key]; assert.ok(path && path.length <= 80); assert.equal((await stat(path)).mode & 0o777, 0o700);
			}
			runtime = options.env!.TMPDIR!.slice(0, -4);
			assert.deepEqual((await readdir(runtime)).sort(), ['tmp', 'xdg']);
			await assert.rejects(access(join(output, 'authored')), { code: 'ENOENT' }, 'Standalone must create its own exclusive destination.');
			return { stdout: 'qualified', stderr: '', receipt: { path: '/receipt', byteLength: 1, sha256: 'a'.repeat(64), maximumReadBytes: 1 } };
		});
		assert.equal(result.stdout, 'qualified'); await assert.rejects(access(runtime), { code: 'ENOENT' });
		assert.deepEqual(inherited, { DISPLAY: ':777', TMPDIR: '/inherited/tmp', XDG_RUNTIME_DIR: '/inherited/xdg' });
	} finally { await rm(output, { recursive: true, force: true }); if (runtime) await rm(runtime, { recursive: true, force: true }); }
});

test('Motion aggregate authored failure retains owned runtime evidence and the original command failure', async () => {
	const output = await mkdtemp(join(tmpdir(), 'motion-aggregate-failure-')); const error = new Error('Owned child failed'); let runtime = '';
	try {
		await assert.rejects(runMotionAuthoredAggregate('/checkout', output, { DISPLAY: ':778' }, async options => {
			runtime = options.env!.TMPDIR!.slice(0, -4); throw error;
		}), value => value === error);
		assert.equal((await stat(runtime)).mode & 0o777, 0o700);
		const record = JSON.parse(await readFile(join(output, 'authored-command/runtime.json'), 'utf8')) as { directory: string; failurePolicy: string };
		assert.equal(record.directory, runtime); assert.match(record.failurePolicy, /retained/u);
	} finally { await rm(output, { recursive: true, force: true }); if (runtime) await rm(runtime, { recursive: true, force: true }); }
});

test('Motion aggregate authored phase refuses an absent owned X11 display before creating output', async () => {
	const output = await mkdtemp(join(tmpdir(), 'motion-aggregate-display-'));
	try {
		await assert.rejects(runMotionAuthoredAggregate('/checkout', output, {}), /X11 display/u);
		assert.deepEqual(await readdir(output), []);
	} finally { await rm(output, { recursive: true, force: true }); }
});

for (const target of ['win-arm64', 'mac-arm64'] as const) test(`Motion aggregate ${target} keeps native host environment and the full authored command`, async () => {
	const output = await mkdtemp(join(tmpdir(), 'motion-aggregate-native-'));
	const inherited = { TEMP: '/native/temp', TMPDIR: '/native/tmp', XDG_RUNTIME_DIR: '/untouched' };
	try {
		const result = await runMotionAuthoredAggregate('/checkout', output, inherited, async options => {
			assert.deepEqual(options.env, inherited); assert.equal(options.timeoutMs, 210000);
			assert.equal(options.id, 'authored'); assert.equal(options.directory, join(output, 'authored-command'));
			assert.deepEqual(options.args, ['/checkout/scripts/motionscaper-authored-native-smoke.mjs', `--output=${output}/authored`]);
			return { stdout: 'native authored', stderr: '', receipt: { path: '/receipt', byteLength: 1, sha256: 'a'.repeat(64), maximumReadBytes: 1 } };
		}, { target });
		assert.equal(result.stdout, 'native authored');
	} finally { await rm(output, { recursive: true, force: true }); }
});
