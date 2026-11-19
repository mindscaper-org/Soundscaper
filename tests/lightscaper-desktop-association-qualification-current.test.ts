/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readLightscaperAssociationQualificationOptionsCurrentV1 as options } from '../scripts/lightscaper-desktop-association-qualification-current-v1.ts';
import { createLightscaperAssociationInstallerCurrentV1 as installer, readLightscaperAssociationRegistrySnapshotCurrentV1 as registry } from '../scripts/lib/lightscaper-desktop-association-install-current-v1.ts';

const ROOT = process.cwd(), REVISION = 'a'.repeat(40), SHA = 'b'.repeat(64);
const argv = ['--target', 'linux-x64', '--source-revision', REVISION, '--npm-cli', join(ROOT, 'npm-cli.js'),
	'--work-root', join(ROOT, 'owned-work'), '--evidence-root', join(ROOT, 'owned-evidence'), '--association-helper', join(ROOT, 'native-helper'), '--association-helper-sha256', SHA];
void test('registered installer command has a closed exact-source target/native-helper contract and no no-sandbox or archive argv escape', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		const request = [...argv]; request[1] = target; const value = options(request);
		assert.equal(value.target.target, target); assert.equal(value.sourceRevision, REVISION); assert.equal(value.helperSha256, SHA);
	}
	for (const changed of [argv.slice(2), [...argv, '--target', 'linux-x64'], [...argv, '--allow-no-sandbox'],
		[...argv, join(ROOT, 'injected.liscape')], argv.map(value => value === 'linux-x64' ? 'linux-ia32' : value),
		argv.map(value => value === REVISION ? 'HEAD' : value), argv.map(value => value === SHA ? 'b'.repeat(63) : value),
		argv.map(value => value === join(ROOT, 'owned-work') ? '../foreign' : value)]) assert.throws(() => options(changed));
});
void test('registry absence is explicit native Registry64 evidence over nine exact keys, not an exit-code inference', () => {
	const paths = ['.liscape', '.sscape', '.fscape', '.scape'].flatMap(suffix => [`Software\\Classes\\${suffix}`,
		`Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${suffix}\\UserChoice`]); paths.push('Software\\Classes\\Lightscaper Catalog');
	const original = { schemaVersion: 1, hive: 'HKEY_CURRENT_USER', view: 'Registry64', keys: paths.map(path => ({ path, state: 'absent', tree: null })) };
	assert.deepEqual(registry(original), original);
	for (const changed of [{ ...original, view: 'Registry32' }, { ...original, hive: 'HKEY_LOCAL_MACHINE' },
		{ ...original, arbitrary: true }, { ...original, keys: original.keys.slice(1) },
		{ ...original, keys: original.keys.map((row, index) => index ? row : { ...row, state: 'unknown' }) },
		{ ...original, keys: original.keys.map((row, index) => index ? row : { ...row, tree: {} }) },
		{ ...original, keys: original.keys.map((row, index) => index ? row : { ...row, path: 'Software\\Classes\\foreign' }) },
	]) assert.throws(() => registry(changed));
});

void test('installer refuses a local host before reading artifacts or starting any installer process', async () => {
	const names = ['GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT'] as const;
	const before = names.map(name => [name, process.env[name]] as const);
	let launched = false;
	try {
		process.env.GITHUB_ACTIONS = 'false'; process.env.RUNNER_ENVIRONMENT = 'local';
		await assert.rejects(installer({ target: options(argv).target, artifactPath: join(ROOT, 'absent-installer.deb'),
			workRoot: join(ROOT, 'absent-installer-work'), processOwner: { readersRetired: true,
				async run() { launched = true; throw new Error('Local installer launch must remain unreachable.'); } },
		}), /explicitly ephemeral GitHub-hosted/u);
		assert.equal(launched, false);
	} finally {
		for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
	}
});

void test('NSIS refuses ambiguous destination tails before artifact access or installer execution', async () => {
	const before = ['GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT'].map(name => [name, process.env[name]] as const);
	const request = [...argv]; request[1] = 'win-x64';
	let launched = false;
	try {
		process.env.GITHUB_ACTIONS = 'true'; process.env.RUNNER_ENVIRONMENT = 'github-hosted';
		for (const name of ['with spaces', 'with\ttab', 'with"quote']) {
			await assert.rejects(installer({ target: options(request).target, artifactPath: join(ROOT, 'absent-installer.exe'),
				workRoot: join(ROOT, name), processOwner: { readersRetired: true,
					async run() { launched = true; throw new Error('Ambiguous NSIS launch must remain unreachable.'); } },
			}), /NSIS destination must not contain whitespace or quotes/u);
		}
		assert.equal(launched, false);
	} finally {
		for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
	}
});
