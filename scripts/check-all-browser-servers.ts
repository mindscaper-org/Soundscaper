/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { ordinaryBrowserProductSitePlan } from './lib/browser-product-site-plan.mjs';
import { progressRecord } from './lib/check-all-output.ts';

const root = resolve(import.meta.dirname, '..');
const { sites } = ordinaryBrowserProductSitePlan();
const children: ChildProcess[] = [];
let failure: Error | undefined;

// Own the shared pair explicitly; never attach tests to an unrelated preview.
for (const site of sites) {
	const port = Number(new URL(site.origin).port);
	await new Promise<void>((resolvePort, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(port, '127.0.0.1', () => { probe.close(error => error ? reject(error) : resolvePort()); });
	});
	const child = spawn(process.execPath, [
		resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', site.outputDirectory,
		'--host', '127.0.0.1', '--port', String(port), '--strictPort', '--logLevel', 'error',
	], { cwd: root, stdio: 'inherit' });
	children.push(child);
	child.once('error', error => { failure = error; });
	child.once('exit', (code, signal) => { failure = new Error(`${site.productId} preview stopped (${signal ?? code}).`); });
}

const deadline = Date.now() + 120_000;
let ready = false;
while (!ready && !failure && Date.now() < deadline) {
	const responses = await Promise.all(sites.map(async (site: { origin: string }) => {
		try {
			const response = await fetch(`${site.origin}/en/`, { signal: AbortSignal.timeout(1_000) });
			await response.body?.cancel();
			return response.ok;
		} catch { return false; }
	}));
	ready = responses.every(Boolean);
	if (!ready) await setTimeout(100);
}
if (!ready || failure) throw failure ?? new Error('Browser preview servers did not become ready within 120 seconds.');
process.stdout.write(progressRecord({ type: 'start', id: 'servers-ready', label: 'Both product previews are ready' }));
// Child handles keep this supervisor alive. A server exit fails its scope;
// the coordinator then cancels dependent work and kills the whole scope.
for (const child of children) child.once('exit', () => {
	process.stderr.write(`${failure?.message ?? 'Browser preview stopped.'}\n`);
	process.exit(1);
});
