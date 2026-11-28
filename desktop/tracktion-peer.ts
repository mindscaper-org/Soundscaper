/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

import { bindNativeChildProcess } from './native-child-framed-control.ts';
import { createTracktionOfflineRender, type TracktionOfflineEffectRender } from './tracktion-offline-effects.ts';
import {
	inspectTracktionReply, TRACKTION_CONTROL_BYTES, tracktionCommandTimeout, TracktionRejectedCommand,
	type TracktionCommand, type TracktionReply,
} from './tracktion-peer-contract.ts';

export type TracktionLaunch = Readonly<{
	executable: string;
	projectDirectory: string;
	stateDirectory: string;
	exchangeDirectory: string;
	clipboardDirectory?: string;
}> & (Readonly<{ mode: 'create'; sampleRate: number }> | Readonly<{ mode: 'open' }>);

const SHUTDOWN_TIMEOUT_MS = 3_000;

/** Launch input belongs to the trusted host process, outside the renderer bridge. */
export function launchTracktionPeer(options: TracktionLaunch, createEffectRender: () => TracktionOfflineEffectRender = createTracktionOfflineRender) {
	const executable = checkedPath(options.executable);
	const rate = options.mode === 'create' ? options.sampleRate : 0;
	if (options.mode === 'create' && (!Number.isInteger(rate) || rate < 8000 || rate > 192_000)) {
		throw new TypeError('Invalid Tracktion sample rate.');
	}
	const child = spawn(executable, [
		options.mode, checkedPath(options.projectDirectory), checkedPath(options.stateDirectory),
		checkedPath(options.exchangeDirectory), String(rate),
		...(options.clipboardDirectory === undefined ? [] : [checkedPath(options.clipboardDirectory)]),
	], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

	const { control, completion } = bindNativeChildProcess(child, {
		protocolFamily: 'SCT', protocolVersion: 1, maximumMessageBytes: TRACKTION_CONTROL_BYTES, maximumInFlightMessages: 1,
	});
	if (control === null) {
		child.kill();
		void completion.catch(() => undefined);
		throw new Error('Tracktion peer control is unavailable.');
	}

	let closed = false;
	let inFlight = false;
	let closing: Promise<void> | undefined;
	const framed = control;
	const terminated = completion.then(() => { closed = true; }, () => { closed = true; });

	async function request<Command extends TracktionCommand>(command: Command): Promise<TracktionReply<Command>> {
		if (closed) throw new Error('The Tracktion peer is closed.');
		if (inFlight) throw new Error('The Tracktion peer already has a command in flight.');
		const bytes = new TextEncoder().encode(JSON.stringify(command));
		if (bytes.byteLength === 0 || bytes.byteLength > TRACKTION_CONTROL_BYTES) {
			throw new RangeError('The Tracktion command exceeds the control message limit.');
		}

		inFlight = true;
		let effectRender: TracktionOfflineEffectRender | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			effectRender = command.kind === 'render' ? createEffectRender() : undefined;
			const deadline = new Promise<never>((_, reject) => {
				timer = setTimeout(() => { reject(new Error('The Tracktion command timed out.')); }, tracktionCommandTimeout(command));
				timer.unref();
			});
			const exchange = async () => {
				await framed.send(bytes);
				for (;;) {
					const frame = await framed.receive();
					const reply: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
					if (!effectRender || !reply || typeof reply !== 'object' || !('kind' in reply) || reply.kind !== 'offlineEffect') {
						return inspectTracktionReply(reply, command);
					}
					const response = await effectRender.respond(reply);
					await framed.send(new TextEncoder().encode(JSON.stringify(response)));
				}
			};
			return await Promise.race([exchange(), deadline]);
		} catch (error) {
			if (!(error instanceof TracktionRejectedCommand)) {
				closed = true;
				child.kill('SIGKILL');
			}
			throw error;
		} finally {
			clearTimeout(timer);
			try { await effectRender?.dispose(); }
			finally { inFlight = false; }
		}
	}

	function close(): Promise<void> {
		if (closing) return closing;
		closed = true;
		if (inFlight) child.kill('SIGKILL');
		else child.stdin.end();
		const deadline = setTimeout(() => { child.kill('SIGKILL'); }, SHUTDOWN_TIMEOUT_MS);
		deadline.unref();
		closing = terminated.finally(() => { clearTimeout(deadline); });
		return closing;
	}

	return Object.freeze({ request, close, completion: terminated });
}

function checkedPath(value: string): string {
	if (!isAbsolute(value) || value.includes('\0')) throw new TypeError('Tracktion launch paths must be absolute.');
	return value;
}
