/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createWinePluginLauncher, isWinePluginSupervised } from '../desktop/wine-plugin-launcher.ts';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';

test('the Linux Wine supervisor compiles with strict warnings and refuses invalid resource bounds', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-launcher-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const launcher = join(root, 'launcher');
	const build = spawnSync('cc', ['-std=c17', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		resolve('native/soundscaper-wine-launcher/launcher.c'), '-o', launcher], { encoding: 'utf8' });
	assert.equal(build.status, 0, build.stderr);
	for (const args of [[], ['0', '1', '--', '/bin/true'], ['1000', '1073741825', '--', '/bin/true']]) {
		assert.equal(spawnSync(launcher, args).status, 125);
	}
});

test('Wine process supervision delivers its distinct handshake and closes cleanly', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-supervision-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const launcher = join(root, 'launcher');
	assert.equal(spawnSync('cc', ['-std=c17', resolve('native/soundscaper-wine-launcher/launcher.c'), '-o', launcher]).status, 0);
	const executable = await open('/bin/true', 'r');
	t.after(() => executable.close());
	const result = await new Promise<{ code: number | null; handshake: string; error: string }>((done, reject) => {
		const child = spawn(launcher, ['1000', '1073741824', '--', '/bin/true'], {
			stdio: ['pipe', 'pipe', 'pipe', 'pipe', executable.fd], shell: false,
		});
		let handshake = '', error = '';
		child.stderr!.on('data', (bytes: Buffer) => { error += bytes.toString(); });
		(child.stdio[3] as NodeJS.ReadableStream).on('data', (bytes: Buffer) => { handshake += bytes.toString(); });
		child.once('error', reject);
		child.once('close', (code) => { done({ code, handshake, error }); });
	});
	assert.equal(result.code, 0, result.error);
	assert.equal(result.handshake, 'M5_WINE_PLUGIN_PROCESS_SUPERVISED_V1\n');
});

test('the Wine launcher admits exact artifacts and refuses a Wine executable changed since detection', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-launch-admission-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const launcherPath = join(root, 'soundscaper-wine-launcher');
	assert.equal(spawnSync('cc', ['-std=c17', resolve('native/soundscaper-wine-launcher/launcher.c'), '-o', launcherPath]).status, 0);
	const descriptor = async (path: string) => {
		const handle = await open(path, 'r');
		try { const bytes = await handle.readFile(); return { path, byteLength: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'), identity: nativeChildFileIdentityFromStat(await handle.stat({ bigint: true })) }; }
		finally { await handle.close(); }
	};
	const peer = await descriptor('/bin/true');
	const wine = join(root, 'wine'); await writeFile(wine, 'wine fixture');
	const authority = { state: 'ready' as const, location: wine, version: '11.22.0', sha256: (await descriptor(wine)).sha256 };
	const launcher = createWinePluginLauncher({ peerExecutable: peer, entryExecutable: peer, entryArguments: [],
		artifacts: [await descriptor(launcherPath)], wine: authority, resolveServer: async () => peer, resolveSharedServices: async () => [] });
	const request = { executable: peer, workloadPayload: peer, arguments: [], readOnly: [], readExecute: [], writeOnly: [],
		runtimeClosure: [], resourcePolicy: { maximumJobDurationMs: 1000, maximumRssBytes: 1024 ** 3 },
		framedControl: { protocolFamily: 'M5F' as const, protocolVersion: 2 as const, maximumMessageBytes: 65536, maximumInFlightMessages: 1 } };
	const launched = await launcher.launch(request);
	assert.equal(isWinePluginSupervised(launched.enforcement), true);
	assert.equal(isWinePluginSupervised({ ...launched.enforcement }), false);
	assert.equal((await launched.completion).exitCode, 0);
	await writeFile(wine, 'changed executable');
	await assert.rejects(launcher.launch(request), /Wine executable changed/u);
	await assert.rejects(launcher.launch({ ...request, arguments: ['/another/peer'] }), /exact authenticated/u);
});

test('the Wine supervisor kills daemonized descendants on duration expiry and supervisor death', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-descendants-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const launcher = join(root, 'launcher'), fixture = join(root, 'fixture');
	await writeFile(`${fixture}.c`, '#include <unistd.h>\n#include <sys/prctl.h>\n#include <stdio.h>\nint main(int argc,char **argv){if(argc!=2)return 1;int p[2];if(pipe(p))return 2;int c=fork();if(c<0)return 3;if(!c){close(p[0]);if(setsid()<0)return 4;prctl(PR_SET_NAME,argv[1]);write(p[1],"x",1);for(;;)pause();}close(p[1]);char v;if(read(p[0],&v,1)!=1)return 5;puts("ready");fflush(stdout);for(;;)pause();}\n');
	assert.equal(spawnSync('cc', [resolve('native/soundscaper-wine-launcher/launcher.c'), '-o', launcher]).status, 0);
	assert.equal(spawnSync('cc', [`${fixture}.c`, '-o', fixture]).status, 0);
	for (const stop of ['duration', 'kill'] as const) {
		const tag = `wine-${randomBytes(4).toString('hex')}`;
		const executable = await open(fixture, 'r');
		try {
			const child = spawn(launcher, [stop === 'duration' ? '1000' : '10000', '1073741824', '--', fixture, tag],
				{ stdio: ['pipe', 'pipe', 'pipe', 'pipe', executable.fd], shell: false });
			const completion = new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
			await new Promise<void>((done, reject) => { child.stdout!.once('data', () => { done(); }); child.once('error', reject); });
			let daemon: string | null = null;
			for (const pid of await readdir('/proc')) {
				try { if ((await readFile(`/proc/${pid}/comm`, 'utf8')).trim() === tag) daemon = pid; }
				catch { /* Processes can exit during enumeration. */ }
			}
			assert.ok(daemon, 'the daemonized child must be observable before the supervisor is stopped');
			if (stop === 'kill') child.kill('SIGKILL');
			assert.equal(await completion, stop === 'duration' ? 125 : null);
			const status = await readFile(`/proc/${daemon}/status`, 'utf8').catch(() => 'State:\tZ');
			assert.match(status, /^State:\s+Z/mu, 'a descendant cannot keep running after supervisor termination');
		} finally { await executable.close(); }
	}
});

test('shared Wine service images survive peer cleanup while other descendants stop', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'wine-shared-services-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const launcher = join(root, 'launcher'), fixture = join(root, 'fixture'), image = join(root, 'service.exe');
	await writeFile(image, Buffer.alloc(4096));
	await writeFile(`${fixture}.c`, '#include <unistd.h>\n#include <sys/mman.h>\n#include <fcntl.h>\n#include <stdio.h>\nint main(int argc,char **argv){if(argc!=2)return 1;int p[2];if(pipe(p))return 2;int c=fork();if(c<0)return 3;if(!c){close(p[0]);if(setsid()<0)return 4;int f=open(argv[1],O_RDONLY);if(f<0||mmap(0,4096,PROT_READ,MAP_PRIVATE,f,0)==MAP_FAILED)return 5;write(p[1],"x",1);for(;;)pause();}close(p[1]);char v;if(read(p[0],&v,1)!=1)return 6;printf("%d\\n",c);fflush(stdout);for(;;)pause();}\n');
	assert.equal(spawnSync('cc', [resolve('native/soundscaper-wine-launcher/launcher.c'), '-o', launcher]).status, 0);
	assert.equal(spawnSync('cc', [`${fixture}.c`, '-o', fixture]).status, 0);
	const executable = await open(fixture, 'r'), server = await open('/bin/true', 'r'), service = await open(image, 'r');
	t.after(async () => { await Promise.all([executable.close(), server.close(), service.close()]); });
	const child = spawn(launcher, ['1000', '1073741824', '--', fixture, image],
		{ stdio: ['pipe', 'pipe', 'pipe', 'pipe', executable.fd, server.fd, service.fd], shell: false });
	const completion = new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done); });
	const daemon = await new Promise<number>((done, reject) => {
		child.stdout!.once('data', (bytes: Buffer) => { done(Number(bytes.toString().trim())); }); child.once('error', reject);
	});
	t.after(() => { try { process.kill(daemon, 'SIGKILL'); } catch { /* Already closed. */ } });
	assert.equal(await completion, 125);
	const status = await readFile(`/proc/${daemon}/status`, 'utf8').catch(() => 'State:\tZ');
	assert.doesNotMatch(status, /^State:\s+Z/mu, 'an exact Wine service image is shared across plugin sessions');
});
