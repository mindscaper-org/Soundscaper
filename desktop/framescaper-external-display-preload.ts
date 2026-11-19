/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperExternalDisplayFrame,
	FramescaperExternalDisplayFrameMetadata,
} from './external-display-controller.ts';

type OfferFrame = (
	request: Readonly<{ frame: FramescaperExternalDisplayFrameMetadata }>,
	ports: [MessagePort, MessagePort],
) => void;

let frameInFlight = false;

/** Transfer the preload's private RGBA snapshot directly to the display sink. */
export function presentFramescaperExternalDisplayFrame(
	{ rgba, ...frame }: FramescaperExternalDisplayFrame,
	offer: OfferFrame,
): Promise<unknown> {
	if (frameInFlight) return Promise.reject(new Error('External-display frame backpressure permits one transfer'));
	const control = new MessageChannel();
	const data = new MessageChannel();
	const port = control.port2;
	const streamId = frame.rgbaSha256.slice(0, 40);
	const pixels = rgba.buffer instanceof ArrayBuffer && rgba.byteLength === rgba.buffer.byteLength
		? new Uint8Array(rgba.buffer) : new Uint8Array(rgba);
	frameInFlight = true;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error: unknown, result?: unknown): void => {
			if (settled) return;
			settled = true;
			frameInFlight = false;
			clearTimeout(timeout);
			port.onmessage = null;
			port.onmessageerror = null;
			port.removeEventListener('close', onClose);
			port.close();
			data.port2.close();
			if (error === null) resolve(result);
			else reject(error);
		};
		const onClose = (): void => finish(new Error('External-display frame MessagePort was closed'));
		const timeout = setTimeout(() => finish(new Error('External-display frame transfer timed out')), 15_000);
		port.onmessage = ({ data: message }: MessageEvent<unknown>) => {
			try { finish(null, frameResult(message, streamId)); }
			catch (error) { finish(error); }
		};
		port.onmessageerror = () => finish(new Error('External-display frame MessagePort failed'));
		port.addEventListener('close', onClose);
		try {
			offer({ frame }, [control.port1, data.port1]);
			data.port2.postMessage(pixels, [pixels.buffer]);
		} catch (error) {
			finish(error);
		}
	});
}

function frameResult(value: unknown, streamId: string): unknown {
	if (value && typeof value === 'object' && Reflect.ownKeys(value).length === 4) {
		const packet = value as Record<string, unknown>;
		if (packet.dataPlaneVersion === 1 && packet.streamId === streamId) {
			if (packet.type === 'result' && Object.hasOwn(packet, 'projection')) return packet.projection;
			if (packet.type === 'failure' && typeof packet.message === 'string'
				&& packet.message.length > 0 && packet.message.length <= 512) throw new Error(packet.message);
		}
	}
	throw new TypeError('Invalid external-display frame result');
}
