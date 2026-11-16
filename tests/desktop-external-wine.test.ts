/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverExternalWine, wineDiscoveryCandidates, parseWineVersion } from '../desktop/external-wine.ts';
import { resolveWineServer, resolveWineSharedServices } from '../desktop/wine-server.ts';

test('Wine discovery searches absolute PATH entries and standard locations without shell expansion', () => {
	const paths = wineDiscoveryCandidates({ PATH: '/custom/bin::relative:/usr/bin', WINELOADER: '/opt/custom/wine' });
	assert.equal(paths[0], '/opt/custom/wine');
	assert.ok(paths.includes('/custom/bin/wine'));
	assert.ok(paths.includes('/opt/wine-staging/bin/wine'));
	assert.ok(paths.every((path) => path.startsWith('/')));
	assert.equal(new Set(paths).size, paths.length);
});

test('Wine versions admit numeric releases and staging builds, but reject arbitrary probe output', () => {
	assert.deepEqual(parseWineVersion('wine-11.22 (Staging)\n'), [11, 22, 0]);
	assert.deepEqual(parseWineVersion('wine-9.0.1'), [9, 0, 1]);
	for (const output of ['wine-11.0-rc1', 'Wine version 11', 'wine-0.1', 'hello\nwine-11.0', 'wine-11.0\nextra']) {
		assert.equal(parseWineVersion(output), null, output);
	}
});

test('automatic Wine selection chooses the newest working candidate and deduplicates canonical paths', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-discovery-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const name of ['old', 'new', 'broken']) {
		await writeFile(join(root, name), `#!/bin/sh\nprintf '%s\\n' '${name === 'old' ? 'wine-9.21' : name === 'new' ? 'wine-11.22 (Staging)' : 'invalid'}'\n`);
		await chmod(join(root, name), 0o700);
	}
	await symlink(join(root, 'new'), join(root, 'alias'));
	const result = await discoverExternalWine({ platform: 'linux', architecture: 'x64',
		candidates: ['old', 'new', 'alias', 'broken'].map((name) => join(root, name)), workingDirectory: root });
	assert.equal(result.state, 'ready');
	assert.equal(result.location, join(root, 'new'));
	assert.equal(result.version, '11.22.0');
	assert.match(result.sha256 ?? '', /^[a-f0-9]{64}$/u);
	const manual = await discoverExternalWine({ platform: 'linux', architecture: 'x64',
		selectedPath: join(root, 'broken'), candidates: [join(root, 'new')], workingDirectory: root });
	assert.equal(manual.state, 'unsupported');
	assert.equal(manual.location, join(root, 'broken'), 'a manual selection never silently changes');
});

test('unsupported targets never probe Wine and missing installations remain unavailable', async () => {
	let probes = 0;
	const runner = { run: async () => { probes++; throw new Error('must not run'); } };
	for (const [platform, architecture] of [['darwin', 'arm64'], ['linux', 'arm64'], ['win32', 'x64']] as const) {
		assert.equal((await discoverExternalWine({ platform, architecture, runner })).state, 'unsupported-target');
	}
	assert.equal(probes, 0);
	assert.equal((await discoverExternalWine({ platform: 'linux', architecture: 'x64', candidates: [] })).state, 'unavailable');
});

test('Wine supervision resolves matching ELF servers and authenticates shared builtin service images', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-closure-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const bin = join(root, 'bin'), builtins = join(root, 'lib/wine/x86_64-windows');
	await mkdir(bin); await mkdir(builtins, { recursive: true });
	await writeFile(join(root, 'version.c'), '#include <stdio.h>\n#include <string.h>\nint main(int argc,char **argv){(void)argc;fprintf(strstr(argv[0],"wineserver")?stderr:stdout,"%s\\n",strstr(argv[0],"wineserver64")?"Wine 8.0":strstr(argv[0],"wineserver")?"Wine 11.22":"wine-11.22");}\n');
	assert.equal(spawnSync('cc', [join(root, 'version.c'), '-o', join(bin, 'wine')]).status, 0);
	for (const name of ['wineserver', 'wineserver64']) await copyFile(join(bin, 'wine'), join(bin, name));
	for (const name of ['wineboot.exe', 'services.exe', 'explorer.exe']) await writeFile(join(builtins, name), `builtin ${name}`);
	const wine = await discoverExternalWine({ candidates: [join(bin, 'wine')] });
	assert.equal(wine.state, 'ready');
	assert.equal((await resolveWineServer(wine)).path, join(bin, 'wineserver'), 'a mismatched server cannot be shared');
	const services = await resolveWineSharedServices(wine);
	assert.deepEqual(services.map(({ path }) => path), ['wineboot.exe', 'services.exe', 'explorer.exe'].map((name) => join(builtins, name)));
	assert.ok(services.every(({ sha256, identity }) => /^[a-f0-9]{64}$/u.test(sha256) && identity.ino !== undefined));
});
