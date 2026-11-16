/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Writable } from 'node:stream';

interface CommandResult { code: number; output: string }

export interface CheckAllSessionHost {
	platform: NodeJS.Platform;
	uid: number;
	read: (path: string) => Promise<string>;
	run: (args: readonly string[], env: NodeJS.ProcessEnv, privileged: boolean) => Promise<CommandResult>;
}

interface SessionOptions {
	env: NodeJS.ProcessEnv;
	/** Success means the task wrapper verified both memory.max and memory.swap.max. */
	probe: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
	onMessage: (message: string) => void;
	signal?: AbortSignal;
	log?: Writable;
	host?: CheckAllSessionHost;
}

/** Repair only the current user's session; never launch an uncapped check. */
export async function prepareCheckAllSession(options: SessionOptions): Promise<NodeJS.ProcessEnv> {
	const uid = process.getuid?.() ?? -1;
	const host = options.host ?? {
		platform: process.platform, uid,
		read: (path: string) => readFile(path, 'utf8'),
		run: (args: readonly string[], env: NodeJS.ProcessEnv, privileged: boolean) => runSessionSystemctl(args, {
			env, privileged, uid, log: options.log, signal: options.signal,
		}),
	};
	if (host.platform !== 'linux') throw new Error('check-all requires Linux, cgroup v2 and a systemd user session to enforce its memory limits.');
	options.signal?.throwIfAborted();
	let env = { ...options.env };
	let diagnostic = await probe();
	if (diagnostic === undefined) return env;
	const runtime = `/run/user/${host.uid}`;
	const address = `unix:path=${runtime}/bus`;
	if (env.XDG_RUNTIME_DIR !== runtime || env.DBUS_SESSION_BUS_ADDRESS !== address) {
		options.onMessage('Connecting to the current user’s systemd session.');
		env = { ...env, XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: address };
		diagnostic = await probe();
		if (diagnostic === undefined) return env;
	}
	let controllers = '';
	try { controllers = await host.read('/sys/fs/cgroup/cgroup.controllers'); }
	catch { /* A v1-only or unmounted hierarchy cannot be repaired while checks run. */ }
	options.signal?.throwIfAborted();
	if (!controllers.trim().split(/\s+/u).includes('memory')) {
		throw new Error(`Cannot enforce the 8 GiB shard limit: the cgroup v2 memory controller is unavailable. Enable it at boot (or expose it from the container host), then retry.\n${diagnostic}`);
	}
	if ((await host.read('/proc/1/comm')).trim() !== 'systemd') {
		throw new Error('check-all setup requires systemd as PID 1. On WSL, enable [boot] systemd=true in /etc/wsl.conf, run wsl --shutdown from Windows, and reopen the distribution.');
	}
	const unit = `user@${host.uid}.service`;
	const properties = await run(['show', unit, '--property=ActiveState,Delegate,DelegateControllers']);
	const active = /^ActiveState=active$/mu.test(properties);
	const delegated = /^DelegateControllers=(.*)$/mu.exec(properties)?.[1]?.trim().split(/\s+/u).filter(Boolean) ?? [];
	const needsMemory = !/^Delegate=yes$/mu.test(properties) || !delegated.includes('memory');
	if (needsMemory) {
		options.onMessage(`Enabling memory-controller delegation for ${unit} until reboot (sudo may request your password).`);
		await run(['set-property', '--runtime', unit, `Delegate=${[...new Set([...delegated, 'memory'])].join(' ')}`, 'MemoryAccounting=yes'], true);
	}
	if (!active) {
		options.onMessage(`Starting the systemd user manager ${unit} and its runtime directory (sudo may request your password).`);
		await run(['start', unit], true);
	} else if (needsMemory) {
		// Re-read available controllers without stopping existing user services.
		await run(['--user', 'daemon-reexec']);
	}
	if (!active || needsMemory) diagnostic = await probe();
	if (diagnostic !== undefined) throw new Error(`Cannot enforce the 8 GiB shard limit after systemd user-session setup. No checks were started.\n${diagnostic}`);
	return env;

	async function probe(): Promise<string | undefined> {
		options.signal?.throwIfAborted();
		const result = await options.probe(env);
		options.signal?.throwIfAborted();
		return result;
	}

	async function run(args: string[], privileged = false): Promise<string> {
		options.signal?.throwIfAborted();
		const result = await host.run(args, env, privileged);
		options.signal?.throwIfAborted();
		if (result.code !== 0) throw new Error(`check-all session setup failed: systemctl ${args.join(' ')} (exit ${result.code}). Retry from a terminal with sudo access.\n${result.output}`);
		return result.output;
	}
}

/** sudo reads credentials from the terminal; they never pass through the logs. */
export function runSessionSystemctl(args: readonly string[], options: {
	env: NodeJS.ProcessEnv;
	privileged: boolean;
	uid: number;
	interactive?: boolean;
	signal?: AbortSignal;
	log?: Writable;
}): Promise<CommandResult> {
	const elevated = options.privileged && options.uid !== 0;
	const command = elevated ? 'sudo' : 'systemctl';
	const commandArgs = elevated ? [...((options.interactive ?? process.stdin.isTTY) ? [] : ['--non-interactive']), '--', 'systemctl', ...args] : [...args];
	options.log?.write(`$ ${command} ${commandArgs.join(' ')}\n`);
	const timeout = AbortSignal.timeout(120_000);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	return new Promise((resolveCommand, reject) => {
		const child = spawn(command, commandArgs, { env: options.env, stdio: ['inherit', 'pipe', 'pipe'], signal });
		let output = '';
		let error: Error | undefined;
		const capture = (chunk: Buffer): void => {
			output = (output + chunk.toString()).slice(-8_192);
			options.log?.write(chunk);
		};
		child.stdout.on('data', capture);
		child.stderr.on('data', capture);
		child.once('error', cause => { error = cause; });
		child.once('close', code => {
			if (error) reject(error);
			else resolveCommand({ code: code ?? 1, output });
		});
	});
}
