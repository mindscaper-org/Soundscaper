/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact MessagePort ingress for one bounded already-evaluated RGBA frame. */

import {
	FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES,
	type FramescaperExternalDisplayFrame,
	type FramescaperExternalDisplayFrameMetadata,
	type FramescaperExternalDisplayPixelPort,
} from './external-display-controller.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneReceiver,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';

export const FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL =
	'framescaper:v1:native-services:display:frame-port';

const FRAME_TIMEOUT_MS = 15_000;
const FRAME_KEYS = Object.freeze([
	'sequence', 'evaluationFingerprint', 'width', 'height', 'dynamicRange', 'rgbaSha256',
]);
const SHA256 = /^[a-f0-9]{64}$/u;

export interface FramescaperExternalDisplayFrameMessagePort extends FramescaperExternalDisplayPixelPort {
	postMessage(message: unknown): void;
	on(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	off?(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	removeListener?(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	start?(): void;
}

interface FramePortEvent {
	readonly ports: readonly FramescaperExternalDisplayFrameMessagePort[];
}

type FramePortListener = (event: unknown, value?: unknown) => void;

export interface FramescaperExternalDisplayFramePortOptions {
	readonly on: (channel: string, listener: FramePortListener) => void;
	readonly removeListener: (channel: string, listener: FramePortListener) => void;
	readonly authorizeOwner: (event: unknown) => boolean;
	readonly controller: FramescaperExternalDisplayControllerPort;
}

interface FramescaperExternalDisplayControllerPort {
	externalDisplays(): Readonly<{ readonly activeDisplayId: string | null }>;
	externalDisplaySessionIdentity(): object | null;
	presentExternalDisplay(
		frame: FramescaperExternalDisplayFrame | FramescaperExternalDisplayFrameMetadata,
		pixels?: FramescaperExternalDisplayPixelPort,
	): unknown;
}

export interface FramescaperExternalDisplayFramePortRegistration {
	readonly dispose: () => void;
}

export function registerFramescaperExternalDisplayFramePort(
	options: FramescaperExternalDisplayFramePortOptions,
): FramescaperExternalDisplayFramePortRegistration {
	if (typeof options.on !== 'function' || typeof options.removeListener !== 'function'
		|| typeof options.authorizeOwner !== 'function') {
		throw new TypeError('External-display frame transport requires exact IPC ownership seams.');
	}
	let active: AbortController | null = null;
	let disposed = false;
	const listener: FramePortListener = (event, value) => {
		const ports = eventPorts(event);
		if (ports === null) return;
		const [port, pixels] = ports;
		if (disposed || !options.authorizeOwner(event)) {
			port.close();
			pixels?.close();
			return;
		}
		if (active !== null) {
			pixels?.close();
			reportFailure(port, value, pixels !== undefined, new Error(
				'External-display frame backpressure permits exactly one in-flight transfer.',
			));
			return;
		}
		const abort = new AbortController();
		active = abort;
		void acceptFrame(options.controller, ports, value, abort.signal)
			.catch((error: unknown) => {
				pixels?.close();
				reportFailure(port, value, pixels !== undefined, error);
			})
			.finally(() => { if (active === abort) active = null; });
	};
	options.on(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL, listener);
	return Object.freeze({
		dispose: () => {
			if (disposed) return;
			disposed = true;
			options.removeListener(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL, listener);
			active?.abort();
			active = null;
		},
	});
}

async function acceptFrame(
	controller: FramescaperExternalDisplayControllerPort,
	[port, pixels]: FramePorts,
	value: unknown,
	signal: AbortSignal,
): Promise<void> {
	const request = requestRecord(value, pixels !== undefined);
	if (controller.externalDisplays().activeDisplayId === null) {
		throw new Error('No external-display session is active.');
	}
	const session = controller.externalDisplaySessionIdentity();
	if (session === null) throw new Error('No external-display session is active.');
	let frame: FramescaperExternalDisplayFrame | FramescaperExternalDisplayFrameMetadata = request.frame;
	if (request.binding !== null) {
		const rgba = await receiveFrameBytes(request.binding, port, signal);
		if (controller.externalDisplaySessionIdentity() !== session) {
			throw new Error('The external-display session changed while its frame was transferred.');
		}
		frame = Object.freeze({ ...frame, rgba });
	}
	const projection = await controller.presentExternalDisplay(frame, pixels);
	signal.throwIfAborted();
	if (controller.externalDisplaySessionIdentity() !== session) {
		throw new Error('The external-display session changed before its frame was presented.');
	}
	port.postMessage(Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'result',
		streamId: request.streamId,
		projection,
	}));
}

function requestRecord(value: unknown, direct: boolean): Readonly<{
	frame: FramescaperExternalDisplayFrameMetadata;
	binding: HelperDataPlaneBinding | null;
	streamId: string;
}> {
	const request = closedRecord(value, direct ? ['frame'] : ['frame', 'binding'], 'external-display frame-port request');
	const frame = frameMetadata(request.frame);
	if (direct) return { frame, binding: null, streamId: frame.rgbaSha256.slice(0, 40) };
	const binding = validateHelperDataPlaneBinding(request.binding);
	const byteLength = frame.width * frame.height * 4;
	if (binding.direction !== 'host-to-helper'
		|| binding.byteLength !== byteLength || binding.sha256 !== frame.rgbaSha256
		|| binding.maximumChunkBytes > HELPER_DATA_CHUNK_MAXIMUM_BYTES
		|| binding.maximumInFlightChunks !== 1) {
		throw new TypeError('External-display frame bytes do not match their exact data-plane binding.');
	}
	return { frame, binding, streamId: binding.streamId };
}

function frameMetadata(value: unknown): FramescaperExternalDisplayFrameMetadata {
	const frame = closedRecord(value, FRAME_KEYS, 'external-display frame metadata');
	if (!Number.isSafeInteger(frame.sequence) || Number(frame.sequence) < 0
		|| !SHA256.test(String(frame.evaluationFingerprint)) || !SHA256.test(String(frame.rgbaSha256))
		|| (frame.dynamicRange !== 'sdr' && frame.dynamicRange !== 'hdr')) {
		throw new TypeError('External-display frame metadata is invalid.');
	}
	const width = dimension(frame.width);
	const height = dimension(frame.height);
	const byteLength = width * height * 4;
	if (!Number.isSafeInteger(byteLength) || byteLength > FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES) {
		throw new RangeError('External-display frame geometry exceeds its byte ceiling.');
	}
	return Object.freeze({
		sequence: Number(frame.sequence),
		evaluationFingerprint: String(frame.evaluationFingerprint),
		width,
		height,
		dynamicRange: frame.dynamicRange,
		rgbaSha256: String(frame.rgbaSha256),
	});
}

function receiveFrameBytes(
	binding: HelperDataPlaneBinding,
	port: FramescaperExternalDisplayFrameMessagePort,
	signal: AbortSignal,
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const receiver = new HelperDataPlaneReceiver(binding);
		const rgba = new Uint8Array(binding.byteLength);
		let settled = false;
		const timeout = setTimeout(() => finish(new Error('External-display frame transfer timed out.')), FRAME_TIMEOUT_MS);
		const onAbort = (): void => finish(new Error('External-display frame transfer was cancelled.'));
		const onClose = (): void => finish(new Error('External-display frame transfer port was lost.'));
		const onMessage = (event: unknown): void => {
			try {
				const message = validateHelperDataPlaneMessage(messageData(event));
				if (message.type === 'chunk') {
					const acknowledgement = receiver.acceptChunk(message);
					rgba.set(message.bytes, message.offset);
					port.postMessage(acknowledgement);
					return;
				}
				if (message.type === 'cancel') {
					receiver.acceptCancel(message);
					finish(new Error('External-display frame transfer was cancelled by the renderer.'));
					return;
				}
				if (message.type !== 'complete') {
					throw new TypeError('External-display frame ingress accepts only chunks and completion.');
				}
				receiver.acceptComplete(message);
				finish(null);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const finish = (error: Error | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			removePortListener(port, 'message', onMessage);
			removePortListener(port, 'close', onClose);
			if (error) reject(error);
			else resolve(rgba);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		port.on('message', onMessage);
		port.on('close', onClose);
		port.start?.();
	});
}

function reportFailure(
	port: FramescaperExternalDisplayFrameMessagePort,
	value: unknown,
	direct: boolean,
	error: unknown,
): void {
	let streamId = '0'.repeat(40);
	try { streamId = requestRecord(value, direct).streamId; } catch { /* closed failure identity */ }
	try {
		port.postMessage(Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'failure',
			streamId,
			message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
		}));
	} finally {
		port.close();
	}
}

type FramePorts = readonly [FramescaperExternalDisplayFrameMessagePort, FramescaperExternalDisplayFrameMessagePort?];

function eventPorts(event: unknown): FramePorts | null {
	if (!event || typeof event !== 'object') return null;
	const ports = (event as Partial<FramePortEvent>).ports;
	if (!Array.isArray(ports) || (ports.length !== 1 && ports.length !== 2)) return null;
	const [control, pixels]: readonly unknown[] = ports;
	if (!isFramePort(control)) return null;
	if (ports.length === 1) return [control];
	return isFramePort(pixels) ? [control, pixels] : null;
}

function isFramePort(value: unknown): value is FramescaperExternalDisplayFrameMessagePort {
	if (!value || typeof value !== 'object') return false;
	const port = value as Partial<FramescaperExternalDisplayFrameMessagePort>;
	return typeof port.postMessage === 'function' && typeof port.on === 'function' && typeof port.close === 'function';
}

function removePortListener(
	port: FramescaperExternalDisplayFrameMessagePort,
	event: 'message' | 'close',
	listener: (value: unknown) => void,
): void {
	if (port.off) port.off(event, listener);
	else port.removeListener?.(event, listener);
}

function messageData(event: unknown): unknown {
	return event && typeof event === 'object' && Object.hasOwn(event, 'data')
		? (event as Readonly<{ data: unknown }>).data
		: event;
}

function dimension(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 32_768) {
		throw new RangeError('External-display dimensions must be bounded positive integers.');
	}
	return Number(value);
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
