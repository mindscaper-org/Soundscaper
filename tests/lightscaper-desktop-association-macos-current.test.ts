/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchLightscaperManagedSmokeProcessCurrentV1 as launch } from '../scripts/lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';

const SOURCE = new URL('../native/lightscaper-desktop-association-current-v1/mac/mac.mm', import.meta.url);

void test('Mac association qualification uses the native default URL route and an exclusive result before dispatch', async () => {
	const source = await readFile(SOURCE, 'utf8');
	assert.match(source, /URLForApplicationToOpenURL:archive/u);
	assert.match(source, /openURL:file configuration:NSWorkspaceOpenConfiguration\.configuration completionHandler:/u);
	assert.doesNotMatch(source, /withApplicationAtURL:|openApplicationAtURL:|LSSetDefault|setDefaultApplication|\.createsNewApplicationInstance\s*=/u);
	assert.match(source, /app\.processIdentifier == \[request\[@"primaryPid"\] intValue\]/u);
	assert.match(source, /LSRegisterURL\(/u);
	assert.match(source, /"-u"/u);
	assert.match(source, /waitpid\(child, &status, WNOHANG\)/u);
	assert.doesNotMatch(source, /waitpid\(child, &status, 0\)/u);
	assert.match(source, /matches == 0 &&/u);
	const reservation = source.indexOf('resultFd = open(output.fileSystemRepresentation');
	assert.ok(reservation >= 0 && reservation < source.indexOf('perform(request, result, counters);'));
	assert.match(source, /result\[@"mimeType"\] = NSNull\.null/u,
		'electron-builder does not place its Linux-only MIME in the Mac document declaration');
});

void test('target-native Mac helper joins exact refusal cases before any registration or opener side effect', {
	skip: process.platform !== 'darwin' || process.arch !== 'arm64', timeout: 120_000,
}, async context => {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-mac-association-refusals-')));
	let safeToRemove = false;
	try {
		async function joined(executable: string, args: readonly string[], deadlineMs: number) {
			safeToRemove = false;
			const receipt = await launch(executable, args, { deadlineMs, retirementGraceMs: 1_000 });
			assert.equal(receipt.launchError, null, receipt.stderr); assert.equal(receipt.expired, false);
			assert.equal(receipt.signal, null); assert.equal(receipt.readersRetired, true);
			assert.equal(receipt.forcedGroupRetirement, false); assert.deepEqual(receipt.liveReaderIds, []);
			assert.equal(receipt.unretiredOwnedGroupId, null);
			return receipt;
		}
		const helper = join(root, 'lightscaper-association');
		const compilation = await joined('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-Wall', '-Wextra', '-Werror',
			'-arch', 'arm64', '-mmacosx-version-min=13.0', '-framework', 'AppKit', '-framework', 'CoreServices',
			fileURLToPath(SOURCE), '-o', helper], 90_000);
		assert.equal(compilation.exitCode, 0, compilation.stderr);
		safeToRemove = true; // Only the compiler has run; no association helper was invoked.
		const bundle = join(root, 'refusal-only.app'), executable = join(bundle, 'Contents/MacOS/Lightscaper');
		await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
		// This synthetic declaration is used only for pre-operation refusals, never OS-dispatch success.
		await copyFile('/usr/bin/true', executable); await chmod(executable, 0o755);
		const archive = join(root, 'owned.liscape'), body = Buffer.from([3, 7, 11]);
		await writeFile(archive, body, { mode: 0o600 });
		const digest = createHash('sha256').update(body).digest('hex');
		const base = { schemaVersion: 1, nonce: 'a'.repeat(32), target: 'mac-arm64', sourceRevision: 'b'.repeat(40),
			operation: 'register', bundlePath: bundle, executablePath: executable, archivePath: archive,
			archiveSha256: digest, primaryPid: 0 };
		const info = (identifier = 'org.lightscaper.desktop', extensions = ['liscape'], role = 'Editor') =>
			`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string>` +
			'<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>Lightscaper</string>' +
			'<key>CFBundleDocumentTypes</key><array><dict><key>CFBundleTypeExtensions</key><array>' +
			extensions.map(extension => `<string>${extension}</string>`).join('') + '</array><key>CFBundleTypeName</key><string>Lightscaper Catalog</string>' +
			`<key>CFBundleTypeRole</key><string>${role}</string><key>LSHandlerRank</key><string>Default</string></dict></array></dict></plist>`;
		const metadata = join(bundle, 'Contents/Info.plist');
		await writeFile(metadata, info(), { mode: 0o644 });
		let ordinal = 0;
		async function refused(request: Readonly<Record<string, unknown>>, expected: RegExp): Promise<void> {
			const input = join(root, `request-${++ordinal}.json`), output = join(root, `result-${ordinal}.json`);
			await writeFile(input, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
			const child = await joined(helper, ['--request', input, '--result', output], 10_000);
			assert.equal(child.exitCode, 1, child.stderr);
			const result = record(JSON.parse(await readFile(output, 'utf8')) as unknown);
			assert.equal(result.status, 'failed'); assert.equal(result.mimeType, null); assert.equal(result.deliveredPid, null);
			assert.match(String(record(result.error).message), expected);
			assert.deepEqual(result.counters, { registerCalls: 0, resolverQueries: 0, openCalls: 0, completionCalls: 0,
				unregisterToolStarts: 0, unregisterToolExitCode: null, unregisterToolReaped: false, postUnregisterMatches: null });
			safeToRemove = true; // Actual helper joined and every external operation counter is zero.
		}
		await refused({ ...base, extra: true }, /closed record/u);
		await refused({ ...base, schemaVersion: true }, /identity or operation/u);
		await refused({ ...base, archiveSha256: '0'.repeat(64) }, /Archive digest differs/u);
		await writeFile(metadata, info('org.foreign.desktop'));
		await refused(base, /bundle identifier/u);
		await writeFile(metadata, info('org.lightscaper.desktop', ['liscape', 'sscape']));
		await refused(base, /document claims/u);
		await writeFile(metadata, info('org.lightscaper.desktop', ['liscape'], 'Viewer'));
		await refused(base, /document claims/u);
		await writeFile(metadata, info());
		const alias = join(root, 'alias.app'); await symlink(bundle, alias);
		await refused({ ...base, bundlePath: alias }, /Symlink or noncanonical/u);
		const collisionInput = join(root, 'collision-request.json'), collisionOutput = join(root, 'collision-result.json');
		await writeFile(collisionInput, JSON.stringify(base), { mode: 0o600 });
		await writeFile(collisionOutput, 'retained-result', { mode: 0o600 });
		const collision = await joined(helper, ['--request', collisionInput, '--result', collisionOutput], 10_000);
		assert.equal(collision.exitCode, 2);
		assert.equal(await readFile(collisionOutput, 'utf8'), 'retained-result');
		// Collision stderr has no operation receipt: retain this tiny fixture rather than infer zero OS work.
	} finally {
		if (safeToRemove) await rm(root, { recursive: true, force: true });
		else context.diagnostic(`Native retirement or zero-operation cleanup authority was not proved; owned fixture retained: ${root}`);
	}
});

function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
