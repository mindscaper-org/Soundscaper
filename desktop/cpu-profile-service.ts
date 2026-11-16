/* SPDX-License-Identifier: AGPL-3.0-only */
import type { WebContents, ProcessMetric } from 'electron';
import { CpuProfileAccumulator } from './cpu-profile-accumulator.ts';
import { CPU_PROFILE_CHANNEL, CPU_PROFILE_CANCEL_CHANNEL, type CpuProfileReading } from '../src/common/editor/cpu-profile-contract.ts';

/** The trusted IPC wrapper admits only the current application main document. */
export function registerCpuProfiler(options: {
	handle(channel: string, listener: (event: unknown) => unknown): void;
	windowFor(): { webContents: WebContents } | null;
	metrics(): ProcessMetric[];
	mainPid: number;
}): void {
	let cancel: (() => void) | null = null;
	let settled = Promise.resolve();
	let retiring = false;
	options.handle(CPU_PROFILE_CANCEL_CHANNEL, async () => { retiring = true; cancel?.(); await settled; });
	options.handle(CPU_PROFILE_CHANNEL, async (): Promise<CpuProfileReading> => {
		if (cancel && retiring) await settled;
		if (cancel) throw new Error('A CPU capture is already running.');
		retiring = false;
		const contents = options.windowFor()?.webContents;
		if (!contents || contents.isDestroyed()) throw new Error('The editor window is unavailable.');
		const debug = contents.debugger;
		if (debug.isAttached() || contents.isDevToolsOpened()) throw new Error('Close Developer Tools before profiling CPU.');
		const pid = contents.getOSProcessId();
		const profile = new CpuProfileAccumulator(pid);
		let failure: unknown = null;
		let wake: () => void = () => {};
		let finish: () => void = () => {};
		let timer: ReturnType<typeof setTimeout> | undefined;
		let tracing = false;
		let attached = false;
		const stop = (): void => { failure ??= new Error('CPU capture was canceled.'); wake(); finish(); };
		const detached = (): void => { attached = false; tracing = false; stop(); };
		const message = (_event: unknown, method: string, params: { value?: unknown[]; dataLossOccurred?: boolean }): void => {
			if (method === 'Tracing.dataCollected' && Array.isArray(params.value)) {
				try { profile.add(params.value); } catch (error) { failure = error; wake(); }
			}
			if (method === 'Tracing.tracingComplete') {
				if (params.dataLossOccurred) failure = new Error('CPU capture overflowed. Reduce the number of effects and try again.');
				finish();
			}
		};
		let release: () => void = () => {};
		settled = new Promise<void>(resolve => { release = resolve; });
		cancel = stop;
		try {
			debug.attach('1.3');
			attached = true;
			debug.on('message', message);
			debug.on('detach', detached);
			contents.on('destroyed', stop);
			contents.on('did-start-navigation', stop);
			await boundedCommand(debug.sendCommand('Tracing.start', { categories: '-*,devtools.timeline', transferMode: 'ReportEvents', options: 'record-until-full' }));
			tracing = true;
			const before = processCpu(options.metrics(), [pid, options.mainPid]);
			const started = performance.now();
			await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, 1000); if (failure) resolve(); });
			clearTimeout(timer);
			const durationMs = performance.now() - started;
			const after = processCpu(options.metrics(), [pid, options.mainPid]);
			const complete = new Promise<void>((resolve) => { finish = resolve; timer = setTimeout(() => {
				failure ??= new Error('CPU capture timed out.'); resolve();
			}, 5000); });
			await boundedCommand(debug.sendCommand('Tracing.end'));
			tracing = false;
			await complete;
			if (failure) throw failure;
			if (contents.getOSProcessId() !== pid) throw new Error('The editor process changed during CPU capture.');
			const { effects } = profile.finish(durationMs * 1000);
			const total = before !== null && after !== null && after >= before ? (after - before) / (durationMs / 1000) * 100 : null;
			const measured = effects.every(effect => effect.cpuPercent !== null);
			return { durationMs, effects, editorCpuPercent: total === null || !measured ? null
				: Math.max(0, total - effects.reduce((sum, effect) => sum + (effect.cpuPercent ?? 0), 0)) };
		} finally {
			clearTimeout(timer);
			try {
				debug.removeListener('message', message);
				debug.removeListener('detach', detached);
				contents.removeListener('destroyed', stop);
				contents.removeListener('did-start-navigation', stop);
				if (tracing && attached && debug.isAttached()) await boundedCommand(debug.sendCommand('Tracing.end')).catch(() => undefined);
				if (attached && debug.isAttached()) debug.detach();
			} finally { cancel = null; release(); }
		}
	});
}

async function boundedCommand<Value>(command: Promise<Value>): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([command, new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error('CPU tracing command timed out.')), 5000);
		})]);
	} finally { clearTimeout(timer); }
}

function processCpu(metrics: readonly ProcessMetric[], pids: readonly number[]): number | null {
	let seconds = 0;
	for (const pid of pids) {
		const value = metrics.find(metric => metric.pid === pid)?.cpu.cumulativeCPUUsage;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
		seconds += value;
	}
	return seconds;
}
