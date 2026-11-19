/* SPDX-License-Identifier: AGPL-3.0-only */
import { aiDenoiseRequest, type AiDenoiseRequest } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';
import type { SherpaExecutionProvider } from './assistance-sherpa-acceleration.ts';
import { isAssistanceGpuValidationEnabled } from './assistance-gpu-validation.ts';

export interface AiDenoisePort { postMessage(value: unknown): void; close(): void; }
interface Child {
	readonly pid?: number;
	postMessage(value: unknown, ports?: AiDenoisePort[]): void;
	on(event: 'message', listener: (value: unknown) => void): unknown;
	on(event: 'exit', listener: () => void): unknown;
	kill(): unknown;
}
interface Owner {
	once(event: 'destroyed', listener: () => void): unknown;
	removeListener(event: 'destroyed', listener: () => void): unknown;
	isDestroyed(): boolean;
}
export interface AiDenoiseSessionOptions {
	prepare(): Promise<{ readonly executionProviders?: readonly SherpaExecutionProvider[]; readonly [key: string]: unknown }>;
	spawn(): Child;
	sampleRss(pid: number): number | null;
	onError(error: unknown): void;
}
/** Main keeps the PCM port until warmup succeeds, so failed GPUs retire before CPU retry. */
export class AiDenoiseSessions {
	private readonly sessions = new Map<string, { close(): void }>();
	private disposed = false;
	constructor(private readonly options: AiDenoiseSessionOptions) {}
	async open(value: unknown, port: AiDenoisePort, owner: Owner): Promise<void> {
		let request: AiDenoiseRequest;
		try {
			request = aiDenoiseRequest(value);
			if (this.disposed || owner.isDestroyed() || this.sessions.size >= 4 || this.sessions.has(request.sessionId)) throw new Error('Invalid denoising capacity or identity.');
		} catch (error) { this.fail(port, error); return; }
		let child: Child | undefined, timer: ReturnType<typeof setInterval> | undefined;
		let closed = false, attached = false, lastHeartbeat = Date.now();
		const close = (): void => {
			if (closed) return;
			closed = true;
			if (timer) clearInterval(timer);
			owner.removeListener('destroyed', close);
			this.sessions.delete(request.sessionId);
			child?.kill();
			if (!attached) port.close();
		};
		this.sessions.set(request.sessionId, { close }); owner.once('destroyed', close);
		try {
			const grant = await this.options.prepare();
			if (closed || this.disposed || owner.isDestroyed()) { close(); return; }
			const supplied = grant.executionProviders ?? ['cpu'];
			if (!supplied.includes('cpu') || supplied.some(p => !['coreml', 'webgpu', 'cpu'].includes(p))
				|| new Set(supplied).size !== supplied.length) throw new Error('Invalid authenticated denoising providers.');
			const providers = (isAssistanceGpuValidationEnabled() ? supplied.filter(p => p === 'webgpu')
				: [...supplied.filter(p => p !== 'cpu'), 'cpu']) as SherpaExecutionProvider[];
			if (!providers.length) throw new Error('GPU validation requires an authenticated WebGPU denoising provider.');
			let providerIndex = 0;
			const start = (): void => {
				if (closed) return;
				const previous = child;
				child = undefined; previous?.kill();
				const attempt = this.options.spawn(); child = attempt; lastHeartbeat = Date.now();
				const retry = (error: unknown, recoverable: boolean): void => {
					if (closed || child !== attempt) return;
					if (!attached && recoverable && providerIndex + 1 < providers.length) {
						this.report(error); providerIndex++;
						try { start(); } catch (failure) { this.fail(port, failure); close(); }
					} else { this.fail(port, error, !attached); close(); }
				};
				attempt.on('exit', () => { if (child === attempt && !closed) retry(new Error('The AI denoising helper exited.'), !attached); });
				attempt.on('message', value => {
					if (closed || child !== attempt) return;
					if (value === 'heartbeat') { lastHeartbeat = Date.now(); return; }
					if (value === 'closed') { close(); return; }
					const message = value as { type?: unknown; message?: unknown; recoverable?: unknown } | null;
					if (message?.type === 'ready' && !attached) {
						try { attempt.postMessage({ type: 'attach' }, [port]); attached = true; lastHeartbeat = Date.now(); }
						catch (error) { this.fail(port, error); close(); }
					} else if (message?.type === 'error') retry(new Error(typeof message.message === 'string' ? message.message.slice(0, 2048) : 'AI denoising failed.'), message.recoverable === true);
					else retry(new Error('Malformed AI denoising helper status.'), false);
				});
				attempt.postMessage({ type: 'prepare', request, grant, provider: providers[providerIndex] });
			};
			start();
			timer = setInterval(() => {
				try {
					const rss = child?.pid ? this.options.sampleRss(child.pid) : null;
					if (Date.now() - lastHeartbeat > (attached ? 2000 : 30_000) || rss !== null && rss > 1024 ** 3 || owner.isDestroyed()) close();
				} catch (error) { this.report(error); close(); }
			}, 250);
			timer.unref?.();
		} catch (error) { this.fail(port, error, !attached); close(); }
	}
	dispose(): void { if (this.disposed) return; this.disposed = true; for (const entry of this.sessions.values()) entry.close(); }
	private report(error: unknown): void { try { this.options.onError(error); } catch { /* Diagnostics do not own the lease. */ } }
	private fail(port: AiDenoisePort, error: unknown, ownsPort = true): void {
		this.report(error);
		if (!ownsPort) return;
		try { port.postMessage({ type: 'error', message: 'AI denoising is unavailable. Install DPDFNet2 in Model Manager, or use Enhance Dialogue for offline processing.' }); }
		catch { /* Renderer gone. */ } finally { port.close(); }
	}
}
