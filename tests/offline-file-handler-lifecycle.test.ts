/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bufferedLaunchedFiles,
	installFileHandlerLaunchConsumer,
	type FileHandlerLaunchParams,
} from '../src/common/offline/file-handler-launch.ts';
import { deferred } from './helpers/async-test-control.ts';

function fileQueue() {
	let consumer: ((params: FileHandlerLaunchParams) => void) | undefined;
	return {
		setConsumer(next: (params: FileHandlerLaunchParams) => void): void { consumer = next; },
		launch(...files: readonly unknown[]): void { consumer?.({ files }); },
	};
}

test('a pending handle cannot publish into a replacement launch installation', async (context) => {
	const queue = fileQueue();
	const first = installFileHandlerLaunchConsumer({ desktop: false, launchQueue: queue });
	context.after(first.release);
	const pending = deferred<File>();
	const started = deferred<void>();
	queue.launch({ getFile: () => { started.resolve(); return pending.promise; } });
	const drained = first.settled();
	await started.promise;
	first.release();
	const replacement = installFileHandlerLaunchConsumer({ desktop: false, launchQueue: queue });
	context.after(replacement.release);
	queue.launch({ getFile: () => new File(['new'], 'new.wav') });
	await replacement.settled();
	pending.resolve(new File(['old'], 'old.wav'));
	await drained;
	assert.deepEqual(bufferedLaunchedFiles().flatMap(({ files }) => files.map(({ name }) => name)), ['new.wav']);
});

test('a rejected launch-queue registration leaves the consumer available to retry', async (context) => {
	const rejected = installFileHandlerLaunchConsumer({
		desktop: false,
		launchQueue: { setConsumer: () => { throw new Error('Launch is unavailable in this document'); } },
		onError: () => undefined,
	});
	context.after(rejected.release);
	assert.equal(rejected.status, 'unsupported');
	const replacement = installFileHandlerLaunchConsumer({ desktop: false, launchQueue: fileQueue() });
	context.after(replacement.release);
	assert.equal(replacement.status, 'consuming');
});

test('a throwing launch error observer cannot drop the rest of a launch or the next launch', async (context) => {
	const queue = fileQueue();
	const delivered: string[] = [];
	const installation = installFileHandlerLaunchConsumer({
		desktop: false,
		launchQueue: queue,
		deliver: ({ files }) => { delivered.push(...files.map(({ name }) => name)); },
		onError: () => { throw new Error('Error view was disposed'); },
	});
	context.after(installation.release);
	queue.launch({ kind: 'directory' }, { getFile: () => new File(['first'], 'first.wav') });
	queue.launch({ getFile: () => new File(['second'], 'second.wav') });
	await installation.settled();
	assert.deepEqual(delivered, ['first.wav', 'second.wav']);
});
