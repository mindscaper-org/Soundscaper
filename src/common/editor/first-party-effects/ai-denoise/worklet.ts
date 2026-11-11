/* SPDX-License-Identifier: AGPL-3.0-only */
import { AiDenoiseStream } from './stream.ts';
import { aiDenoiseRackGeometry } from './contract.ts';

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(options?: AudioWorkletNodeOptions); }
declare function registerProcessor(name: string, processor: typeof AiDenoiseWorklet): void;

class AiDenoiseWorklet extends AudioWorkletProcessor {
	private peer: MessagePort | null = null;
	private stream: AiDenoiseStream | null = null;
	private closed = false;
	constructor(options: AudioWorkletNodeOptions = {}) {
		super(options);
		const channels = Number((options.processorOptions as { channelCount?: unknown })?.channelCount);
		aiDenoiseRackGeometry(sampleRate, channels);
		this.port.onmessage = (event: MessageEvent): void => {
			if (event.data?.type === 'dispose') { this.dispose(); return; }
			if (event.data?.type !== 'attach' || this.peer || this.closed || event.ports.length !== 1) return;
			this.peer = event.ports[0]!;
			// Electron utility ports support cloned PCM, not transferred ArrayBuffers.
			this.stream = new AiDenoiseStream(channels, block => this.peer!.postMessage(block), sampleRate);
			this.peer.onmessage = ({ data }: MessageEvent): void => {
				try {
					if (data?.type === 'error') throw new Error('The AI denoising helper stopped.');
					this.stream!.receive(data);
				} catch (error) { this.fail(error); }
			};
			this.peer.onmessageerror = (): void => this.fail(new Error('The AI denoising PCM connection failed.'));
			this.peer.start();
			this.port.postMessage({ type: 'attached' });
		};
	}
	private dispose(): void {
		if (this.closed) return;
		this.closed = true;
		try { this.peer?.postMessage({ type: 'close' }); } finally { this.peer?.close(); this.peer = null; }
	}
	private fail(error: unknown): void {
		this.dispose();
		this.port.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'AI denoising failed.' });
	}
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0] ?? [];
		try { if (!this.closed && this.stream && output.length) this.stream.process(inputs[0] ?? [], output); }
		catch (error) { this.fail(error); }
		if (this.closed || !this.stream) for (const plane of output) plane.fill(0);
		return !this.closed;
	}
}
registerProcessor('kw-ai-denoise', AiDenoiseWorklet);
