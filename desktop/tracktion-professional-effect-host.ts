/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import type { NativeMainMessagePort } from './native-audio-helper-adapter.ts';
import type { NativePluginPersistentSession } from './native-plugin-helper-adapter.ts';
import type { TracktionOfflineEffectInstance } from './tracktion-offline-effects.ts';

type PendingRequest = Readonly<{
	id: string;
	resolve: (reply: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}>;

/** Keep the existing supervised plug-in RPC port in trusted main for a detached Tracktion render. */
export async function openTracktionProfessionalEffect(session: NativePluginPersistentSession): Promise<TracktionOfflineEffectInstance | null> {
	let port: NativeMainMessagePort;
	try { port = claimControlPort(session); }
	catch (error) { await session.close(); throw error; }
	let pending: PendingRequest | undefined;
	let closed = false;
	let sequence = 0;
	let closing: Promise<void> | undefined;
	const listener = (event: unknown) => {
		const value = event && typeof event === 'object' && 'data' in event ? event.data : event;
		const request = pending;
		if (request && value && typeof value === 'object' && 'requestId' in value && request.id === value.requestId) {
			pending = undefined;
			clearTimeout(request.timer);
			request.resolve(value);
			return;
		}
		stop(new Error('The isolated professional effect sent an unexpected response.'));
	};

	function stop(error: Error): void {
		if (closed) return;
		closed = true;
		if (pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			pending = undefined;
		}
		if (port.off) port.off('message', listener);
		else port.onmessage = null;
		port.close();
	}

	function close(): Promise<void> {
		stop(new Error('The isolated professional effect was closed.'));
		closing ??= session.close();
		return closing;
	}

	function request(kind: string, fields: Record<string, unknown> = {}): Promise<unknown> {
		if (closed || pending) return Promise.reject(new Error('The isolated professional effect control is unavailable.'));
		const id = 'tracktion-' + String(++sequence);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => stop(new Error('The isolated professional effect did not respond.')), 5_000);
			timer.unref();
			pending = { id, resolve, reject, timer };
			try { port.postMessage({ protocolVersion: 1, kind, requestId: id, ...fields }); }
			catch (error) { stop(error instanceof Error ? error : new Error('The isolated professional effect disconnected.')); }
		});
	}

	try {
		if (port.on) port.on('message', listener);
		else port.onmessage = listener;
		void session.closed.then(
			() => stop(new Error('The isolated professional effect stopped.')),
			() => stop(new Error('The isolated professional effect failed.')),
		);
		const topology = readClosedDomainRecord(await request('topology'), 'Tracktion effect topology', [
			'protocolVersion', 'kind', 'requestId', 'inputChannels', 'outputChannels',
		]);
		if (topology.protocolVersion !== 1 || topology.kind !== 'topology' || topology.inputChannels !== 2 || topology.outputChannels !== 2) {
			await close();
			return null;
		}
		const latencyFrames = session.reportedLatencyFrames;
		return {
			latencyFrames,
			async process(input, output) {
				const frameCount = input[0].length;
				const sampleBlock = await request('process', { input, output, frameCount });
				const reply = readClosedDomainRecord(sampleBlock, 'Tracktion professional effect result', [
					'protocolVersion', 'kind', 'requestId', 'frameCount', 'input', 'output', 'reportedLatencyFrames',
				]);
				if (reply.protocolVersion !== 1 || reply.kind !== 'processed' || reply.frameCount !== frameCount
					|| reply.reportedLatencyFrames !== latencyFrames || !Array.isArray(reply.output) || reply.output.length !== 2
					|| !reply.output.every((plane) => plane instanceof Float32Array && plane.length === frameCount)) {
					throw new Error('The isolated professional effect changed its latency or returned malformed audio.');
				}
				output[0].set(reply.output[0]);
				output[1].set(reply.output[1]);
			},
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

function claimControlPort(session: NativePluginPersistentSession): NativeMainMessagePort {
	let port: NativeMainMessagePort | undefined;
	session.transferTo({ postMessage(_channel, _message, [control]) { port = control; } });
	if (!port) throw new Error('The isolated professional effect omitted its RPC port.');
	return port;
}
