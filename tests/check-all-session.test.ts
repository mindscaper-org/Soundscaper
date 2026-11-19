/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareCheckAllSession, type CheckAllSessionHost } from '../scripts/lib/check-all-session.ts';

function fixture() {
	const commands: { args: readonly string[]; privileged: boolean; env: NodeJS.ProcessEnv }[] = [];
	const probes: NodeJS.ProcessEnv[] = [];
	const messages: string[] = [];
	const state = { active: false, delegationEnabled: true, delegated: 'cpu pids', probeFailures: 1, commandFailure: '', init: 'systemd', controllers: 'cpu memory pids' };
	const host: CheckAllSessionHost = {
		platform: 'linux', uid: 1000,
		read: path => Promise.resolve(path === '/proc/1/comm' ? state.init : state.controllers),
		run: (args, env, privileged) => {
			commands.push({ args, env, privileged });
			if (state.commandFailure && args.includes(state.commandFailure)) return Promise.resolve({ code: 1, output: 'fixture permission denied' });
			if (args.includes('show')) return Promise.resolve({ code: 0, output: `ActiveState=${state.active ? 'active' : 'inactive'}\nDelegate=${state.delegationEnabled ? 'yes' : 'no'}\nDelegateControllers=${state.delegated}\n` });
			if (args.includes('start')) state.active = true;
			return Promise.resolve({ code: 0, output: '' });
		},
	};
	const probe = (env: NodeJS.ProcessEnv): Promise<string | undefined> => {
		probes.push(env);
		return Promise.resolve(probes.length <= state.probeFailures ? 'fixture memory probe rejected' : undefined);
	};
	const env = { XDG_RUNTIME_DIR: '/run/user/1000', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', PATH: '/fixture/bin' };
	return { commands, probes, messages, state, host, env, options: { host, env, probe, onMessage: (message: string) => { messages.push(message); } } };
}

test('check-all leaves an already enforced session alone', async () => {
	const f = fixture();
	f.state.probeFailures = 0;
	assert.deepEqual(await prepareCheckAllSession(f.options), f.env);
	assert.equal(f.probes.length, 1);
	assert.equal(f.commands.length, 0);
});

test('check-all repairs missing or stale session variables without privileged setup', async () => {
	for (const variables of [{}, { XDG_RUNTIME_DIR: '/run/user/0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/stale/bus' }]) {
		const f = fixture();
		const env = { PATH: '/fixture/bin', ...variables };
		assert.deepEqual(await prepareCheckAllSession({ ...f.options, env }), f.env);
		assert.deepEqual(env, { PATH: '/fixture/bin', ...variables }, 'do not mutate the caller environment');
		assert.equal(f.probes.length, 2);
		assert.equal(f.commands.length, 0);
	}
});

test('check-all delegates memory without losing controllers and starts the missing user manager', async () => {
	const f = fixture();
	assert.deepEqual(await prepareCheckAllSession(f.options), f.env);
	assert.deepEqual(f.commands.map(command => [command.privileged, ...command.args]), [
		[false, 'show', 'user@1000.service', '--property=ActiveState,Delegate,DelegateControllers'],
		[true, 'set-property', '--runtime', 'user@1000.service', 'Delegate=cpu pids memory', 'MemoryAccounting=yes'],
		[true, 'start', 'user@1000.service'],
	]);
	assert.equal(f.probes.length, 2, 'recheck the actual memory cap after setup');
	assert.ok(f.messages.some(message => message.includes('Starting')));
});

test('check-all starts a missing manager without changing existing memory delegation', async () => {
	const f = fixture();
	f.state.delegated = 'cpu memory pids';
	await prepareCheckAllSession(f.options);
	assert.deepEqual(f.commands.filter(command => command.privileged).map(command => command.args), [['start', 'user@1000.service']]);
});

test('check-all enables disabled delegation while preserving its configured controllers without duplicates', async () => {
	const f = fixture();
	f.state.delegationEnabled = false;
	f.state.delegated = 'cpu memory pids';
	await prepareCheckAllSession(f.options);
	assert.deepEqual(f.commands[1]?.args, ['set-property', '--runtime', 'user@1000.service', 'Delegate=cpu memory pids', 'MemoryAccounting=yes']);
});

test('check-all refreshes a running manager after adding memory delegation without restarting user services', async () => {
	const f = fixture();
	f.state.active = true;
	await prepareCheckAllSession(f.options);
	assert.deepEqual(f.commands.at(-1)?.args, ['--user', 'daemon-reexec']);
	assert.equal(f.commands.at(-1)?.privileged, false);
	assert.ok(f.commands.every(command => !command.args.includes('restart') && !command.args.includes('start')));
});

test('check-all preserves a valid custom session environment', async () => {
	const f = fixture();
	f.state.probeFailures = 0;
	const env = { ...f.env, XDG_RUNTIME_DIR: '/custom/runtime', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/custom/bus' };
	assert.deepEqual(await prepareCheckAllSession({ ...f.options, env }), env);
	assert.equal(f.commands.length, 0);
});

test('check-all refuses unavailable kernel support before privileged setup', async () => {
	for (const controllers of ['', 'cpu pids']) {
		const f = fixture();
		f.state.controllers = controllers;
		await assert.rejects(prepareCheckAllSession(f.options), /cgroup v2 memory controller.*boot/iu);
		assert.equal(f.commands.length, 0);
	}
	const f = fixture();
	f.host.read = () => Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
	await assert.rejects(prepareCheckAllSession(f.options), /cgroup v2/iu);
	assert.equal(f.commands.length, 0);
});

test('check-all explains when the init system needs to be enabled and restarted', async () => {
	const f = fixture();
	f.state.init = 'init';
	await assert.rejects(prepareCheckAllSession(f.options), /systemd.*PID 1.*WSL/iu);
	assert.equal(f.commands.length, 0);
});

test('check-all fails setup when privilege escalation fails and does not start a shard', async () => {
	const f = fixture();
	f.state.commandFailure = 'set-property';
	await assert.rejects(prepareCheckAllSession(f.options), /set-property.*fixture permission denied/isu);
	assert.equal(f.probes.length, 1);
	assert.ok(f.commands.every(command => !command.args.includes('start')));
});

test('check-all still refuses an unenforced cap after successful setup', async () => {
	const f = fixture();
	f.state.probeFailures = Infinity;
	await assert.rejects(prepareCheckAllSession(f.options), /Cannot enforce the 8 GiB shard limit.*fixture memory probe rejected/isu);
	assert.equal(f.probes.length, 2);
});

test('check-all does not change a running, delegated manager when the capped probe fails for another reason', async () => {
	const f = fixture();
	f.state.active = true;
	f.state.delegated = 'cpu memory pids';
	f.state.probeFailures = Infinity;
	await assert.rejects(prepareCheckAllSession(f.options), /fixture memory probe rejected/u);
	assert.equal(f.commands.length, 1);
	assert.equal(f.probes.length, 1);
});

test('check-all rejects unsupported platforms and respects cancellation before setup', async () => {
	const f = fixture();
	f.host.platform = 'darwin';
	await assert.rejects(prepareCheckAllSession(f.options), /requires Linux/u);
	assert.equal(f.probes.length, 0);
	f.host.platform = 'linux';
	const controller = new AbortController();
	f.host.run = () => { controller.abort(); return Promise.resolve({ code: 0, output: 'ActiveState=inactive\nDelegateControllers=memory' }); };
	await assert.rejects(prepareCheckAllSession({ ...f.options, signal: controller.signal }), { name: 'AbortError' });
	assert.equal(f.probes.length, 1);
});
