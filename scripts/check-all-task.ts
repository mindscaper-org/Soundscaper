/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Refuse an unbounded run even if systemd accepted but ignored a controller.
const [memoryArgument, ...args] = process.argv.slice(2);
const memoryBytes = Number(memoryArgument);
const cgroup = /^0::(.+)$/mu.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
if (!cgroup || !Number.isSafeInteger(memoryBytes) || memoryBytes <= 0) throw new Error('Cannot verify the check-all memory cgroup.');
const directory = resolve('/sys/fs/cgroup', `.${cgroup}`);
if (readFileSync(resolve(directory, 'memory.max'), 'utf8').trim() !== String(memoryBytes)
	|| readFileSync(resolve(directory, 'memory.swap.max'), 'utf8').trim() !== '0') {
	throw new Error('check-all requires an enforced memory cap with swap disabled.');
}
if (args.length === 0) throw new Error('Missing check-all task command.');
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.once('error', error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
child.once('exit', (code, signal) => {
	const events = readFileSync(resolve(directory, 'memory.events'), 'utf8');
	const oomKills = Number(/^oom_kill (\d+)$/mu.exec(events)?.[1] ?? 0);
	if (oomKills > 0) {
		process.stderr.write(`Shard exceeded its ${memoryBytes / 1024 ** 3} GiB memory limit.\n`);
		process.exitCode = 137;
	} else process.exitCode = code ?? (signal === 'SIGKILL' ? 137 : 1);
});
