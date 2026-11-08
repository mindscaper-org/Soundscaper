/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, readdir, stat, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from '@playwright/test';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';
import { launchMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-launch.ts';
import { selectMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-process.ts';
import { motionQualificationTarget, requireMotionQualificationHost } from './motionscaper-qualification-platform.ts';
import { createMotionQualificationNative, type MotionQualificationCustody, type MotionNativeLaunch, type MotionQualificationProcess } from './motionscaper-qualification-native.ts';
import { motionQualificationApplicationExitAccepted, motionQualificationChooserRequest, motionQualificationProcessIdentity, verifyMotionQualificationOwner, type MotionQualificationChooserKind, type MotionQualificationOwner } from './motionscaper-qualification-policy.ts';
import { runMotionQualificationCommand } from './motionscaper-qualification-command.ts';
import { MotionQualificationApplicationOutput } from './motionscaper-qualification-output.ts';
import { prepareMotionQualificationLocale } from './motionscaper-qualification-locale.ts';
export { runMotionQualificationCommand } from './motionscaper-qualification-command.ts';

const key = (value: MotionQualificationOwner) => `${value.pid}:${value.birth}`;
const errorCode = (error: unknown) => error && typeof error === 'object' ? Reflect.get(error, 'code') : null;
async function until<T>(operation: () => Promise<T | null>, milliseconds: number): Promise<T> {
	const deadline = performance.now() + milliseconds;
	for (;;) { const value = await operation(); if (value !== null) return value; if (performance.now() >= deadline) throw new Error('Owned qualification deadline exceeded.'); await delay(50); }
}

/** The shared UI drivers use normal menus plus this external, process-bound native chooser. */
export async function launchMotionQualificationApplication(options: Readonly<{
	executable: string; cwd: string; directory: string; args?: readonly string[]; flags?: readonly string[];
	env?: NodeJS.ProcessEnv; timeoutMs?: number; workflow?: 'authored' | 'scene' | 'launch' | 'successor';
}>) {
	const target = motionQualificationTarget(); requireMotionQualificationHost(target);
	await prepareMotionQualificationLocale(options.directory);
	const root = options.cwd, native = await createMotionQualificationNative(root, options.directory); native.requireInteractive();
	let chooserIndex = 0;
	const choose = async (owner: MotionQualificationOwner, custody: MotionQualificationCustody, kind: MotionQualificationChooserKind, path: string) => {
		const current = await native.inspect(owner.pid); if (!current) throw new Error('Native chooser owner retired.'); verifyMotionQualificationOwner(owner, current);
		const grant = motionQualificationChooserRequest(owner, kind, path, options.directory);
		if (process.platform === 'linux') {
			const ownerPath = join(options.directory, `chooser-owner-${owner.pid}.json`);
			const record = `${JSON.stringify({ owner: { pid: owner.pid, startTicks: owner.birth }, display: process.env.DISPLAY })}\n`;
			try { await writeFile(ownerPath, record, { flag: 'wx', mode: 0o600 }); }
			catch (error) { if (errorCode(error) !== 'EEXIST' || await readFile(ownerPath, 'utf8') !== record) throw error; }
			const result = await motionSustainedCommand({ command: '/usr/bin/python3', args: ['-B', '-E', '-s', join(root, 'scripts/lib/motionscaper-qualification-chooser-x11.py'),
				options.directory, grant.linuxMode, kind.endsWith('open') || kind === 'authored-save' ? 'saved.mscape' : 'output.mov', ownerPath],
				cwd: root, directory: options.directory, id: `chooser-${++chooserIndex}`, timeoutMs: 25000 });
			if (!/MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u.test(result.stdout)) throw new Error('Native chooser did not complete.');
			return { nativeAutomation: 'owned private X11 dialog PID/birth', action: grant.action, receipt: result.receipt };
		}
		const value: unknown = process.platform === 'win32' ? await native.windows({ schemaVersion: 1, action: 'choose', choose: grant, custody })
			: JSON.parse((await runMotionQualificationCommand({ command: '/usr/bin/osascript', args: ['-l', 'JavaScript', join(root, 'scripts/lib/motionscaper-qualification-chooser-darwin.js'),
				await native.request({ schemaVersion: 1, action: 'choose', choose: grant, processObserver: native.darwin })], cwd: root, directory: options.directory, id: `chooser-${++chooserIndex}`, timeoutMs: 30000 })).stdout) as unknown;
		if (!value || typeof value !== 'object') throw new Error('Invalid native chooser receipt.');
		const result = value as { selected?: unknown; dialogClosed?: unknown; owner?: MotionQualificationOwner; kind?: unknown; path?: unknown; action?: unknown };
		if (result.selected !== true || result.dialogClosed !== true || result.kind !== kind || result.path !== path || result.action !== grant.action || !result.owner) throw new Error('Native chooser action was not admitted.');
		verifyMotionQualificationOwner(owner, result.owner); return value;
	};
	const watchCount = async (owner: MotionQualificationOwner, directory: string): Promise<number | null> => {
		if (process.platform !== 'linux') return null;
		const current = await native.inspect(owner.pid); if (!current) throw new Error('Native watch owner retired.'); verifyMotionQualificationOwner(owner, current);
		const inode = (await stat(directory)).ino.toString(16), descriptors = `/proc/${owner.pid}/fdinfo`, names = await readdir(descriptors);
		if (names.length > 4096) throw new Error('Native watch descriptor bound exceeded.');
		const records = await Promise.all(names.map(async name => { try { return await readFile(join(descriptors, name), 'utf8'); } catch (error) { if (errorCode(error) === 'ENOENT') return ''; throw error; } }));
		return records.flatMap(record => record.split('\n')).filter(line => /^inotify /u.test(line) && line.includes(`ino:${inode} `)).length;
	};
	if (process.platform === 'linux' && options.workflow === 'authored') {
		// Keep the already-qualified Linux authored sampler/CDP/custody and cleanup path intact.
		const application = await launchMotionSustainedApplication({ executable: options.executable, cwd: root, directory: options.directory, native: true });
		const owner: MotionQualificationOwner = { platform: 'linux', pid: application.owner.pid, parent: application.owner.parentPid, birth: application.owner.startTicks, executable: await realpath(options.executable) };
		const custody = { directory: options.directory, id: 'application', controlId: key(owner) };
		return { ...application, owner, target, rememberProcesses: async () => { await application.sampleProcesses(); },
			chooseFile: (request: Readonly<{ kind: MotionQualificationChooserKind; path: string }>) => choose(owner, custody, request.kind, request.path),
			watchCount: (directory: string) => watchCount(owner, directory),
			watchObservation: 'Linux inotify descriptor count and actual saved-revision behavior' as const };
	}
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SCAPE_PRODUCT: 'motionscaper', ...options.env };
	for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_V8_COVERAGE', 'SCAPE_BROWSER_COVERAGE']) delete env[name];
	const args = [...(options.flags ?? ['--disable-gpu']), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
		`--user-data-dir=${join(options.directory, 'profile')}`, ...(options.args ?? [])];
	let launch: MotionNativeLaunch | undefined, browser: Browser | undefined, output = '', outputFailed = false, stopped = false, owner: MotionQualificationOwner | undefined;
	const applicationOutput = new MotionQualificationApplicationOutput();
	let custody: MotionQualificationCustody | undefined, controller: MotionQualificationOwner | undefined;
	let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
	let poll: ReturnType<typeof setInterval> | undefined, inFlight: Promise<void> | null = null, cleanupPromise: Promise<void> | undefined;
	const retained = new Map<string, MotionQualificationProcess>(), failures: string[] = [], signals: unknown[] = [];
	const permittedExitCodes = new Set([0]);
	const rememberProcesses = async () => {
		if (!owner || !custody) throw new Error('Application birth has not been admitted.');
		const snapshot = await native.snapshot();
		const identities = snapshot.processes.map(motionQualificationProcessIdentity);
		const known = [...retained.values()].map(motionQualificationProcessIdentity);
		const session = snapshot.processes.filter(value => custody!.session !== undefined && value.session === custody!.session);
		const selected = selectMotionOwnedProcesses(identities, motionQualificationProcessIdentity(owner),
			[...known, ...session.map(motionQualificationProcessIdentity)]);
		for (const identity of selected) {
			const found = snapshot.processes.find(value => value.pid === identity.pid && value.birth === identity.startTicks);
			if (found) retained.set(key(found), found);
		}
		if (retained.size > 256) throw new Error('Owned process history exceeded its qualification bound.');
	};
	const cleanup = () => {
		cleanupPromise ??= (async () => {
			stopped = true; if (poll) clearInterval(poll); if (timer) clearTimeout(timer); await inFlight;
			try { await rememberProcesses(); } catch (error) { failures.push(String(error)); }
			if (browser) {
				let closeTimer: ReturnType<typeof setTimeout> | undefined;
				try { await Promise.race([browser.close(), new Promise<never>((_done, reject) => { closeTimer = setTimeout(() => reject(new Error('CDP close exceeded its cleanup bound.')), 3000); })]); }
				catch (error) { failures.push(String(error)); }
				finally { if (closeTimer) clearTimeout(closeTimer); }
			}
			if (owner && custody) {
				try { if (await native.inspect(owner.pid)) { await native.signal(owner, custody, 'TERM'); if (process.platform !== 'win32') permittedExitCodes.add(143); signals.push({ owner, signal: 'TERM' }); } } catch (error) { failures.push(String(error)); }
				const started = performance.now(); let sentKill = false;
				try {
					await until(async () => {
						const live = [];
						for (const value of retained.values()) {
							const current = await native.inspect(value.pid);
							if (current && current.birth === value.birth && (!controller || key(value) !== key(controller))) live.push(value);
						}
						if (!live.length) return true;
						if (!sentKill && performance.now() - started > 2000) {
							sentKill = true;
							if (process.platform === 'win32') { launch!.child.stdin.end(); failures.push('Native Windows app survived graceful closure; owned Job EOF cleanup requested.'); }
							else for (const value of live) { await native.signal(value, custody!, 'KILL'); if (key(value) === key(owner!)) permittedExitCodes.add(137); signals.push({ owner: value, signal: 'KILL' }); }
						}
						return null;
					}, 10000);
				} catch (error) { failures.push(String(error)); }
			} else if (launch) {
				launch.child.stdin.destroy(); // Native controllers own EOF cleanup even when admission failed.
				if (process.platform === 'linux' && launch.child.exitCode === null && launch.child.signalCode === null) launch.child.kill('SIGKILL'); // Direct, unreaped ChildProcess authority.
			}
			let terminal: Awaited<NonNullable<typeof closed>> | null = null;
			if (closed) {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				try { terminal = await Promise.race([closed, new Promise<null>(done => { timeout = setTimeout(() => done(null), 15000); })]); }
				finally { if (timeout) clearTimeout(timeout); }
				if (!terminal) failures.push('Native application controller physical closure is unknown.');
				else if (!motionQualificationApplicationExitAccepted(terminal, permittedExitCodes)) failures.push('Owned application/controller exited unexpectedly.');
			}
			let nativeClosure: unknown = null;
			if (launch?.closureFile) {
				try {
					nativeClosure = JSON.parse(await readFile(launch.closureFile, 'utf8')) as unknown;
					if (!motionQualificationApplicationExitAccepted(terminal, permittedExitCodes, nativeClosure)) failures.push('Native job/session did not prove a successful intentional physical closure.');
				} catch (error) { failures.push(String(error)); }
			}
			await writeFile(join(options.directory, 'application.log'), output, { flag: 'wx' });
			await writeFile(join(options.directory, 'application-closure.json'), `${JSON.stringify({ owner, controller, custody, terminal, nativeClosure,
				retained: [...retained.values()], failures, signals, physicalClosure: failures.length === 0,
				scope: 'Only the launched native job/session and sampled PID/birth descendants; no exhaustive short-lived birth or foreign-process claim.' }, null, 2)}\n`, { flag: 'wx' });
			if (failures.length) throw new AggregateError(failures.map(value => new Error(value)), 'Owned application cleanup failed; runtime paths are retained.');
		})();
		return cleanupPromise;
	};
	try {
		launch = await native.start({ executable: options.executable, args, cwd: root, id: 'application', timeoutMs: options.timeoutMs ?? 180000, maximumOutputBytes: 1048576, env });
		const child = launch.child;
		let resolveEndpoint!: (value: string) => void, rejectEndpoint!: (error: unknown) => void;
		const endpoint = new Promise<string>((done, reject) => { resolveEndpoint = done; rejectEndpoint = reject; });
		void endpoint.catch(() => { /* Admission may still be pending; the awaited endpoint retains this failure. */ });
		const collect = (bytes: Buffer) => {
			try { output = applicationOutput.append(bytes); }
			catch (error) {
				if (!outputFailed) {
					outputFailed = true; failures.push(String(error)); rejectEndpoint(error);
					child.stdin.destroy(); // Native controllers clean their retained job/session on caller EOF.
					// Linux retains the actual child and sampled births; cleanup closes that custody too.
					void cleanup().catch(() => { /* The retained cleanup promise rejects every subsequent cleanup request. */ });
				}
				return;
			}
			const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/u.exec(output);
			if (match) resolveEndpoint(match[1]!);
		};
		child.stdout.on('data', collect); child.stderr.on('data', collect); child.stdin.on('error', () => { /* Native receipt/close checks retain failure. */ });
		closed = launch.closed;
		child.once('error', error => { rejectEndpoint(error); });
		void closed.then(() => { rejectEndpoint(new Error('Owned application closed before endpoint.')); });
		timer = setTimeout(() => { rejectEndpoint(new Error('Owned application startup deadline exceeded.')); child.stdin.destroy(); }, 30000);
		({ owner, custody, controller } = await launch.admitted); retained.set(key(owner), owner); if (controller) retained.set(key(controller), controller);
		const url = await endpoint; clearTimeout(timer);
		browser = await chromium.connectOverCDP(url); const context = browser.contexts()[0]; if (!context) throw new Error('Owned application browser context unavailable.');
		const page = context.pages()[0] ?? await context.waitForEvent('page');
		poll = setInterval(() => {
			if (stopped || inFlight) return;
			inFlight = rememberProcesses().catch((error: unknown) => { failures.push(String(error)); }).finally(() => { inFlight = null; });
		}, process.platform === 'win32' ? 1000 : 100);
		await rememberProcesses();
		return { owner, target, page, browser, context, rememberProcesses, cleanup,
			chooseFile: (request: Readonly<{ kind: MotionQualificationChooserKind; path: string }>) => choose(owner!, custody!, request.kind, request.path),
			watchCount: (directory: string) => watchCount(owner!, directory),
			watchObservation: process.platform === 'linux' ? 'Linux inotify descriptor count and actual saved-revision behavior' : 'Actual atomic Save/update, Disconnect/offline retention, and complete owned native job/session cleanup' };
	} catch (error) { try { await cleanup(); } catch (closeError) { throw new AggregateError([error, closeError], 'Application startup and owned cleanup failed.', { cause: closeError }); } throw error; }
}
