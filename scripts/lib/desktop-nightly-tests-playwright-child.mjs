/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { terminateProcessTree } from '../../desktop/process-tree-termination.ts';
import { createDesktopNightlyTestsItemProgressReader } from './desktop-nightly-tests-progress-reporter.mjs';

const CHILD_TERMINATION_GRACE_MS = 250;

export async function runDesktopNightlyTestsPlaywrightChild(plan, onItems, { signal } = {}) {
	const descriptor = await open(plan.logFile, 'wx');
	const log = descriptor.createWriteStream();
	const reader = onItems ? createDesktopNightlyTestsItemProgressReader(onItems) : null;
	let child;
	let result;
	let failure;
	let failed = false;
	let exitSeen = false;
	let childClosed = false;
	let terminationStarted = false;
	let forceTimer;
	let pauseTimer;
	let pauseRequested = false;
	let termination = Promise.resolve();
	let waitForClose;
	const rememberFailure = (error) => {
		if (failed) return;
		failed = true;
		failure = error;
	};
	const childRunning = () => child && Number.isSafeInteger(child.pid) && child.pid > 0
		&& !exitSeen && !childClosed && child.exitCode === null && child.signalCode === null;
	const kill = (processSignal) => {
		if (signal) {
			termination = termination.then(() => terminateProcessTree(child, processSignal))
				.then(() => undefined).catch(rememberFailure);
		} else {
			try { child.kill(processSignal); } catch { /* Keep the original failure and close waiter. */ }
		}
	};
	const onAbort = () => {
		if (pauseRequested || childClosed) return;
		pauseRequested = true;
		if (child.connected) {
			try { child.send({ type: 'soundscaper-nightly-pause' }, () => undefined); }
			catch { /* Whole-tree escalation below still requires OS closure. */ }
		}
		pauseTimer = setTimeout(() => {
			if (!childClosed) kill('SIGKILL');
		}, 30_000);
		pauseTimer.unref();
	};
	const terminate = () => {
		if (terminationStarted || !childRunning()) return;
		terminationStarted = true;
		kill('SIGTERM');
		forceTimer = setTimeout(() => {
			if (!childRunning()) return;
			kill('SIGKILL');
		}, CHILD_TERMINATION_GRACE_MS);
	};
	const onChildError = (error) => { rememberFailure(error); terminate(); };
	const onExit = () => { exitSeen = true; clearTimeout(forceTimer); };
	const onData = (chunk) => {
		if (failed) return;
		try { reader?.write(chunk); }
		catch (error) { rememberFailure(error); terminate(); }
	};
	const onLogError = (error) => {
		rememberFailure(error);
		if (child) {
			child.stdout.unpipe(log);
			child.stderr.unpipe(log);
			// Drain a broken sink without retaining output or blocking child close.
			child.stdout.resume();
			child.stderr.resume();
		}
		terminate();
	};
	log.on('error', onLogError);
	try {
		child = spawn(plan.command, signal
			? [join(plan.cwd, 'scripts/lib/desktop-nightly-tests-child-bootstrap.mjs'), ...plan.args]
			: plan.args, {
			cwd: plan.cwd,
			detached: Boolean(signal) && process.platform !== 'win32',
			env: { ...plan.env },
			stdio: signal ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		waitForClose = new Promise((resolvePromise) => {
			child.on('error', onChildError);
			child.once('exit', onExit);
			child.once('close', (code, processSignal) => {
				childClosed = true;
				clearTimeout(forceTimer);
				clearTimeout(pauseTimer);
				signal?.removeEventListener('abort', onAbort);
				if (!failed) {
					try { reader?.finish(); } catch (error) { rememberFailure(error); }
				}
				result = { code, signal: processSignal };
				resolvePromise();
			});
		});
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		child.stdout.on('data', onData);
		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) onAbort();
		await waitForClose;
	} catch (error) {
		rememberFailure(error);
		terminate();
		if (waitForClose) await waitForClose;
	}
	await termination;
	try { await closeWritable(log); } catch (error) { rememberFailure(error); }
	finally {
		clearTimeout(forceTimer);
		clearTimeout(pauseTimer);
		signal?.removeEventListener('abort', onAbort);
		child?.off('error', onChildError);
		child?.off('exit', onExit);
		child?.stdout.off('data', onData);
		log.off('error', onLogError);
	}
	if (failed) throw failure;
	return result;
}

function closeWritable(stream) {
	if (stream.closed) return stream.errored ? Promise.reject(stream.errored) : Promise.resolve();
	return new Promise((resolvePromise, reject) => {
		let failure = stream.errored;
		const onError = (error) => { failure ??= error; };
		stream.on('error', onError);
		stream.once('close', () => {
			stream.off('error', onError);
			if (failure) reject(failure);
			else resolvePromise();
		});
		if (!stream.destroyed && !stream.writableEnded) stream.end();
	});
}
