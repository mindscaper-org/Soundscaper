/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWriteStream, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { resolve } from 'node:path';

import { createCheckAllPlan } from './lib/check-all-plan.ts';
import { CheckAllDisplay, createCheckOutputReader } from './lib/check-all-output.ts';
import { startLimitedProcess } from './lib/check-all-process.ts';
import { runCheckTasks, type CheckTask } from './lib/check-all-scheduler.ts';

const root = resolve(import.meta.dirname, '..');
const { scripts } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Use npm run check-all to supply the configured npm CLI.');
const tasks = createCheckAllPlan(root, npmCli, scripts);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
	for (const task of tasks) process.stdout.write(`${task.id}${task.dependsOn.length ? ` (after ${task.dependsOn.join(', ')})` : ''}\n`);
} else if (args.length) throw new Error('Usage: npm run check-all [-- --list]');
else await checkAll();

async function checkAll(): Promise<void> {
	const lock = resolve(root, '.wrangler/check-all.lock');
	mkdirSync(resolve(root, '.wrangler'), { recursive: true });
	try { closeSync(openSync(lock, 'wx')); }
	catch { throw new Error(`Another check-all run owns ${lock}. If it was forcibly killed, remove that stale lock before retrying.`); }
	writeFileSync(lock, `${process.pid}\n`);
	const controller = new AbortController();
	const processes = new Set<ReturnType<typeof startLimitedProcess>>();
	const display = new CheckAllDisplay(process.stdout, tasks.length);
	let servers: Promise<void> | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	const logs = resolve(root, 'test-results/check-all/logs');
	let exitCode = 0;
	const cancel = (code: number): void => {
		exitCode = code;
		controller.abort();
		for (const child of processes) void child.stop().catch(error => display.failure('cleanup', String(error)));
	};
	const abort = (): void => cancel(130);
	process.on('SIGINT', abort);
	process.on('SIGTERM', abort);
	try {
		rmSync(resolve(root, 'coverage/check-all'), { recursive: true, force: true });
		rmSync(logs, { recursive: true, force: true });
		mkdirSync(logs, { recursive: true });
		let diagnostic = '';
		const probe = startLimitedProcess(root, 'probe', ['-e', ''], { onOutput: chunk => { diagnostic = (diagnostic + chunk).slice(-8_192); } });
		processes.add(probe);
		try {
			if (await probe.completed !== 0) throw new Error(`Cannot enforce the 8 GiB shard limit. A systemd user session and cgroup v2 memory controller are required.\n${diagnostic}`);
		} finally { await probe.stop(); processes.delete(probe); }
		process.stdout.write(`check-all: 4 slots, 8 GiB per shard, shared previews capped at 8 GiB. Logs: ${logs}\n`);
		timer = setInterval(() => display.render(), process.stdout.isTTY ? 200 : 5_000);
		const states = await runCheckTasks(tasks, async task => {
			if (task.browser) {
				servers ??= startServers();
				await servers;
			}
			if (controller.signal.aborted) return 1;
			return execute(task);
		}, {
			signal: controller.signal, onChange: states => display.states(states),
			onError: (task, error) => display.failure(task.id, String(error)),
		});
		display.finish();
		const failed = [...states].filter(([, state]) => state === 'failed' || state === 'blocked').map(([id, state]) => `${id} (${state})`);
		if (failed.length) {
			process.stdout.write(`${failed.join(', ')}\nSee ${logs}\n`);
			exitCode ||= 1;
		} else process.stdout.write('All checks passed.\n');
	} catch (error) {
		if (!controller.signal.aborted) throw error;
		exitCode ||= 130;
	} finally {
		if (timer) clearInterval(timer);
		controller.abort();
		try { await Promise.all([...processes].map(child => child.stop())); }
		finally {
			process.off('SIGINT', abort);
			process.off('SIGTERM', abort);
			rmSync(lock, { force: true });
		}
	}
	process.exitCode = exitCode;

	async function execute(task: CheckTask): Promise<number> {
		const file = resolve(logs, `${task.id.replaceAll('/', '-')}.log`);
		const log = createWriteStream(file);
		let tail = '';
		let reported = false;
		const output = (chunk: Buffer, stderr: boolean): void => {
			tail = (tail + chunk.toString()).slice(-16_384);
			(stderr ? errReader : reader).write(chunk);
		};
		const reader = createCheckOutputReader(event => {
			if (event.type === 'end' && event.failure) reported = true;
			display.event(task.id, event);
		}, line => {
			if (/\b(?:error|failed|fatal)\b|^not ok/iu.test(line)) display.diagnostic(task.id, line.trimEnd());
		});
		const errReader = createCheckOutputReader(event => display.event(task.id, event), line => {
			if (line.trim()) display.diagnostic(task.id, line.trimEnd());
		});
		const child = startLimitedProcess(root, task.id, task.args, { env: { ...process.env, ...task.env }, log, onOutput: output });
		processes.add(child);
		log.once('error', error => { display.failure(task.id, String(error)); cancel(1); });
		try {
			const code = await child.completed;
			reader.finish();
			errReader.finish();
			if (code !== 0) display.failure(task.id, `exit ${code}; log: ${file}${reported ? '' : `\n${tail}`}`);
			return code;
		} finally {
			await child.stop();
			processes.delete(child);
			log.end();
			await finished(log);
		}
	}

	async function startServers(): Promise<void> {
		await new Promise<void>((resolveReady, rejectReady) => {
			let ready = false;
			const reader = createCheckOutputReader(event => {
				if (event.type === 'start' && event.id === 'servers-ready') { ready = true; resolveReady(); }
			}, line => { if (line.trim()) display.diagnostic('previews', line.trimEnd()); });
			const child = startLimitedProcess(root, 'browser-previews', [resolve(root, 'scripts/check-all-browser-servers.ts')], {
				onOutput: chunk => reader.write(chunk),
			});
			processes.add(child);
			void child.completed.then(code => {
				reader.finish();
				rejectReady(new Error(`Browser previews exited (${code}).`));
				if (ready && !controller.signal.aborted) { display.failure('previews', `Preview servers exited (${code}).`); cancel(1); }
			}, rejectReady);
		});
	}
}
