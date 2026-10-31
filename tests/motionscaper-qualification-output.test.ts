/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { MotionQualificationApplicationOutput } from '../desktop/motionscaper-qualification-output.ts';

test('Output overflow remains fatal after endpoint discovery and retires the retained child', { timeout: 5000 }, async context => {
	// This real child is an output protocol fixture; it does not claim a packaged-app qualification.
	const child = spawn(process.execPath, ['-e', "process.stdout.write('DevTools listening on ws://127.0.0.1:1/devtools/browser/owned\\n'); setInterval(() => process.stdout.write(Buffer.alloc(256, 120)), 10);"], { stdio: ['ignore', 'pipe', 'pipe'] });
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
		child.once('error', reject); child.once('close', (code, signal) => done({ code, signal }));
	});
	context.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
	const output = new MotionQualificationApplicationOutput(1024);
	let endpointObserved = false, failure: unknown;
	const collect = (bytes: Buffer) => {
		try { const text = output.append(bytes); endpointObserved ||= text.includes('DevTools listening on'); }
		catch (error) { failure ??= error; child.kill('SIGKILL'); }
	};
	child.stdout.on('data', collect); child.stderr.on('data', collect);
	const terminal = await closed;
	assert.equal(endpointObserved, true);
	assert.ok(failure instanceof Error); assert.match(failure.message, /output exceeded/u);
	assert.equal(terminal.code, null); assert.equal(terminal.signal, 'SIGKILL');
	assert.throws(() => output.append(Buffer.alloc(0)), error => error === failure, 'Endpoint discovery must not consume the persistent output failure.');
});
