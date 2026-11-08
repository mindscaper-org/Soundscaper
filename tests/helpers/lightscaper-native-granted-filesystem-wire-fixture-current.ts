/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';

type Reply = Readonly<{ opcode: number; id: number; body: Buffer }>;
export function grantedFsTargetCurrentV1(): number {
	if (process.platform === 'linux') return process.arch === 'arm64' ? 2 : 1;
	if (process.platform === 'darwin' && process.arch === 'arm64') return 3;
	if (process.platform === 'win32') return process.arch === 'arm64' ? 5 : 4;
	throw new Error('The native FS role supports only its five maintained targets.');
}
export function grantedFsInitCurrentV1(target = grantedFsTargetCurrentV1()): Buffer {
	return Buffer.concat([randomBytes(32), Buffer.from([target])]);
}
export function grantedFsErrorCurrentV1(reply: Reply): void {
	assert.equal(reply.opcode, 255); assert.ok(reply.body.byteLength >= 10 && reply.body.byteLength <= 1034);
	assert.ok(reply.body.readUInt16BE(0) > 0); assert.equal(reply.body[7]! & 254, 0);
	const count = reply.body.readUInt16BE(8); assert.equal(reply.body.byteLength, 10 + count); assert.ok(count <= 1024);
	for (const value of reply.body.subarray(10)) assert.ok(value >= 32 && value <= 126);
}
export async function grantedFilesystemWireFixtureCurrentV1(context: TestContext,
	run: (peer: ReturnType<typeof peerFor>) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-granted-fs-wire-'));
	try { await withActualPeer(context, run, directory); }
	finally { await rm(directory, { recursive: true, force: true }); }
}
async function withActualPeer(context: TestContext, run: (peer: ReturnType<typeof peerFor>) => Promise<void>, directory: string): Promise<void> {
	const binary = process.env.SCAPE_GRANTED_FILESYSTEM_TEST_BINARY ?? join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
	if (!process.env.SCAPE_GRANTED_FILESYSTEM_TEST_BINARY) assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)),
		kind: 'lightscaper-granted-filesystem', outputPath: binary }), 'Prepare the actual shared filesystem role artifact.');
	assert.ok(isAbsolute(binary)); assert.ok((await lstat(binary)).isFile());
	const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
	let closed = false, output = Buffer.alloc(0), stderrBytes = 0;
	const pending: Array<Readonly<{ resolve(reply: Reply): void; reject(reason: unknown): void }>> = [];
	const jobs = new Set<Promise<unknown>>();
	const joined = new Promise<void>(resolve => { child.once('close', () => {
		closed = true; for (const waiter of pending.splice(0)) waiter.reject(new Error('The actual native FS peer exited.')); resolve();
	}); });
	const kill = (): void => { if (!closed) child.kill('SIGKILL'); };
	child.on('error', () => { /* Actual close remains the only child-retirement receipt. */ });
	child.stdin.on('error', () => { /* The actual write callback and child close own rejection. */ });
	child.stderr.on('data', (bytes: Buffer) => { stderrBytes += bytes.byteLength; if (stderrBytes > 8192) kill(); });
	child.stdout.on('data', (bytes: Buffer) => {
		try {
			output = Buffer.concat([output, bytes]);
			if (output.byteLength > 2 * 1048576) { kill(); return; }
			while (output.length >= 16) {
				assert.equal(output.subarray(0, 4).toString(), 'SGR1'); assert.equal(output[4], 1); assert.equal(output.readUInt16BE(6), 0);
				const length = output.readUInt32BE(12); assert.ok(length <= 1048576); if (output.length < 16 + length) break;
				const waiter = pending.shift(); assert.ok(waiter, 'The real peer must never send an unsolicited reply.');
				waiter.resolve(Object.freeze({ opcode: output[5]!, id: output.readUInt32BE(8), body: Buffer.from(output.subarray(16, 16 + length)) }));
				output = output.subarray(16 + length);
			}
		} catch (error) { for (const waiter of pending.splice(0)) waiter.reject(error); kill(); }
	});
	context.signal.addEventListener('abort', kill, { once: true }); const timer = setTimeout(kill, 14000);
	const peer = peerFor(child, pending, jobs, () => closed, joined);
	try { if (context.signal.aborted) kill(); await run(peer); }
	finally { kill(); await joined; await Promise.allSettled([...jobs]); clearTimeout(timer); context.signal.removeEventListener('abort', kill); }
}
function peerFor(child: ReturnType<typeof spawn>, pending: Array<Readonly<{ resolve(reply: Reply): void; reject(reason: unknown): void }>>,
	jobs: Set<Promise<unknown>>, closed: () => boolean, joined: Promise<void>) {
	let sequence = 0;
	return Object.freeze({ joined, async request(opcode: number, body: Buffer = Buffer.alloc(0), id?: number, declaredLength?: number): Promise<Reply> {
		if (closed()) throw new Error('Actual native FS peer is already retired.');
		const requestId = id ?? ++sequence, frame = Buffer.alloc(16 + body.byteLength);
		frame.write('SGR1'); frame[4] = 1; frame[5] = opcode; frame.writeUInt32BE(requestId, 8);
		frame.writeUInt32BE(declaredLength ?? body.byteLength, 12); body.copy(frame, 16);
		const reply = new Promise<Reply>((resolve, reject) => { pending.push({ resolve, reject }); });
		const write = new Promise<void>((resolve, reject) => { child.stdin!.write(frame, error => { if (error) reject(error); else resolve(); }); });
		const work = Promise.all([reply, write]).then(([value]) => value); jobs.add(work);
		void work.then(() => { jobs.delete(work); }, () => { jobs.delete(work); });
		const value = await work; assert.equal(value.id, requestId); return value;
	} });
}
