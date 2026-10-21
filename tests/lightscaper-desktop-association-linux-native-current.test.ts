/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchLightscaperManagedSmokeProcessCurrentV1 as launch } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const SOURCE = new URL('../native/lightscaper-desktop-association-current-v1/linux/', import.meta.url);

void test('Linux association helper resolves the real archive default and owns every native launcher child', async () => {
	const source = await readFile(new URL('main.cpp', SOURCE), 'utf8'), processes = await readFile(new URL('process.hpp', SOURCE), 'utf8');
	assert.match(source, /g_file_query_info\(archive, G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE/u);
	assert.match(source, /g_file_query_default_handler\(archive,/u);
	assert.match(source, /g_desktop_app_info_launch_uris_as_manager\(/u);
	assert.match(source, /G_SPAWN_DO_NOT_REAP_CHILD, nullptr, nullptr, launched, &launch/u);
	assert.doesNotMatch(source, /g_desktop_app_info_new(?:_from_filename|_from_keyfile)?\(|g_app_info_set_as_default|g_app_info_launch_default_for_uri/u);
	assert.match(processes, /readlink\(\(root \+ "\/exe"\)/u);
	assert.match(processes, /getpgid\(pid\)/u);
	assert.match(processes, /waitpid\(value\.pid, &value\.status, WNOHANG\)/u);
	assert.match(processes, /g_spawn_close_pid\(value\.pid\)/u);
	assert.doesNotMatch(processes, /waitpid\([^\n]+, 0\)/u);
	const reservation = source.indexOf('output.value = open(output_path.c_str()');
	assert.ok(reservation >= 0 && reservation < source.indexOf('perform(input, report, count, launch);'));
});

void test('target-native Linux helper compiles and refuses malformed or unowned dispatch without an OS opener side effect', {
	skip: process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch), timeout: 180_000,
}, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-linux-association-refusals-')));
	let safeToRemove = false;
	try {
		async function joined(executable: string, args: readonly string[], deadlineMs: number) {
			safeToRemove = false;
			const receipt = await launch(executable, args, { deadlineMs, retirementGraceMs: 1_000 });
			safeToRemove = receipt.readersRetired && receipt.unretiredOwnedGroupId === null;
			assert.equal(receipt.launchError, null, receipt.stderr); assert.equal(receipt.expired, false);
			assert.equal(receipt.signal, null); assert.equal(receipt.readersRetired, true);
			assert.equal(receipt.forcedGroupRetirement, false); assert.deepEqual(receipt.liveReaderIds, []);
			assert.equal(receipt.unretiredOwnedGroupId, null); return receipt;
		}
		const build = join(root, 'build');
		const configured = await joined('cmake', ['-S', fileURLToPath(SOURCE), '-B', build, '-DCMAKE_BUILD_TYPE=Release'], 60_000);
		assert.equal(configured.exitCode, 0, configured.stderr);
		const built = await joined('cmake', ['--build', build, '--target', 'lightscaper-desktop-association-current-v1', '--parallel', '2'], 90_000);
		assert.equal(built.exitCode, 0, built.stderr);
		const helper = join(build, 'lightscaper-desktop-association-current-v1'), executable = join(root, 'lightscaper');
		// This real compiled binary is only an input to refusal cases, never a fake Lightscaper OS positive.
		await copyFile(helper, executable); await chmod(executable, 0o755);
		const archive = join(root, 'owned.liscape'), body = Buffer.from([3, 7, 11]);
		await writeFile(archive, body, { mode: 0o600 });
		const base = { schemaVersion: 1, nonce: 'a'.repeat(32), target: `linux-${process.arch}`,
			sourceRevision: 'b'.repeat(40), operation: 'open', executablePath: executable, archivePath: archive,
			archiveSha256: createHash('sha256').update(body).digest('hex'), primaryPid: process.pid };
		let ordinal = 0;
		async function refused(request: Readonly<Record<string, unknown>>, expected: RegExp, raw?: string): Promise<void> {
			const input = join(root, `request-${++ordinal}.json`), output = join(root, `result-${ordinal}.json`);
			await writeFile(input, raw ?? JSON.stringify(request), { flag: 'wx', mode: 0o600 });
			const receipt = await joined(helper, ['--request', input, '--result', output], 10_000);
			const retired = safeToRemove; safeToRemove = false;
			assert.equal(receipt.exitCode, 1, receipt.stderr);
			const result = record(JSON.parse(await readFile(output, 'utf8')) as unknown);
			assert.equal(result.status, 'failed'); assert.equal(result.secondary, null);
			assert.match(String(record(result.error).message), expected);
			assert.deepEqual(result.counters, { contentTypeQueries: 0, defaultHandlerQueries: 0, launchCalls: 0, pidCallbacks: 0 });
			safeToRemove = retired;
		}
		await refused({ ...base, extra: true }, /closed nine-key/u);
		await refused({ ...base, schemaVersion: true }, /wrong JSON type/u);
		await refused(base, /duplicate JSON object key/u, JSON.stringify(base).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
		await refused({ ...base, archiveSha256: '0'.repeat(64) }, /Archive SHA differs/u);
		await refused(base, /Actual process executable differs/u);
		await refused({ ...base, primaryPid: 0 }, /identity is invalid/u);
		const alias = join(root, 'alias'); await symlink(executable, alias);
		await refused({ ...base, executablePath: alias }, /Symlink or noncanonical/u);
		const other = join(root, 'foreign.sscape'); await writeFile(other, body, { mode: 0o600 });
		await refused({ ...base, archivePath: other }, /owned catalog suffix/u);
		const input = join(root, 'collision-request.json'), output = join(root, 'collision-result.json');
		await writeFile(input, JSON.stringify(base), { mode: 0o600 }); await writeFile(output, 'retained-result', { mode: 0o600 });
		const collision = await joined(helper, ['--request', input, '--result', output], 10_000);
		const retired = safeToRemove; safeToRemove = false;
		assert.equal(collision.exitCode, 2); assert.equal(await readFile(output, 'utf8'), 'retained-result');
		const refusal = record(JSON.parse(collision.stderr) as unknown);
		assert.equal(refusal.schemaVersion, 1); assert.equal(refusal.kind, 'lightscaper-linux-association-no-result-refusal');
		assert.deepEqual(refusal.counters, { contentTypeQueries: 0, defaultHandlerQueries: 0, launchCalls: 0, pidCallbacks: 0 });
		safeToRemove = retired;
	} finally {
		if (safeToRemove) await rm(root, { recursive: true, force: true });
		else context.diagnostic(`Actual native process-group retirement was not proved; owned fixture retained: ${root}`);
	}
});

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
