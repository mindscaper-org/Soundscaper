/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { terminateProcessTree } from '../../desktop/process-tree-termination.ts';
import { createDesktopNightlyTestsItemProgressReader } from './desktop-nightly-tests-progress-reporter.mjs';

export async function runDesktopNightlyTestsPlaywrightChild(plan, onItems, { signal } = {}) {
	const descriptor = await open(plan.logFile, 'wx');
	const log = descriptor.createWriteStream();
	let termination = Promise.resolve();
	let child;
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
	} catch (error) {
		await closeWritable(log);
		throw error;
	}
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	const reader = onItems ? createDesktopNightlyTestsItemProgressReader(onItems) : null;
	try {
		return await new Promise((resolvePromise, reject) => {
			let observerFailure = null;
			let killTimer = null;
			const onAbort = () => {
				if (child.connected) child.send({ type: 'soundscaper-nightly-pause' }, () => undefined);
				killTimer = setTimeout(() => {
					termination = terminateProcessTree(child, 'SIGKILL').then(() => undefined);
				}, 30_000);
				killTimer.unref();
			};
			const cleanup = () => {
				signal?.removeEventListener('abort', onAbort);
				if (killTimer) clearTimeout(killTimer);
				child.off('error', onChildError);
				child.off('close', onClose);
				child.stdout.off('data', onData);
				log.off('error', onLogError);
			};
			const onChildError = (error) => { cleanup(); reject(error); };
			const onData = (chunk) => {
				if (observerFailure) return;
				try { reader?.write(chunk); }
				catch (error) { observerFailure = error; child.kill(); }
			};
			const onClose = (code, signal) => {
				cleanup();
				if (observerFailure) { reject(observerFailure); return; }
				try { reader?.finish(); resolvePromise({ code, signal }); }
				catch (error) { reject(error); }
			};
			const onLogError = (error) => { child.kill(); onChildError(error); };
			child.once('error', onChildError);
			child.once('close', onClose);
			child.stdout.on('data', onData);
			log.once('error', onLogError);
			signal?.addEventListener('abort', onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});
	} finally {
		await termination;
		await closeWritable(log);
	}
}

function closeWritable(stream) {
	if (stream.closed || stream.destroyed) return Promise.resolve();
	return new Promise((resolvePromise, reject) => {
		stream.once('error', reject);
		stream.end(resolvePromise);
	});
}
