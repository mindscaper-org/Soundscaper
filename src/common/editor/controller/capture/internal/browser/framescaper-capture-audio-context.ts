/* SPDX-License-Identifier: AGPL-3.0-only */

interface CaptureAudioContextLifecycle {
	readonly state?: string;
	resume?(): PromiseLike<void> | void;
	addEventListener?(type: 'statechange', listener: () => void): void;
	removeEventListener?(type: 'statechange', listener: () => void): void;
}

export interface FramescaperOwnedCaptureAudioContext extends CaptureAudioContextLifecycle {
	readonly sampleRate: number;
	setSinkId?(sinkId: string): PromiseLike<void> | void;
	resume(): PromiseLike<void> | void;
	close(): PromiseLike<void> | void;
}

export type FramescaperCaptureAudioContextFactory = (sampleRate: number) => FramescaperOwnedCaptureAudioContext;

interface CaptureOutputContext extends CaptureAudioContextLifecycle {
	readonly sampleRate: number;
	readonly sinkId?: unknown;
	addEventListener?(type: 'sinkchange' | 'statechange', listener: () => void): void;
	removeEventListener?(type: 'sinkchange' | 'statechange', listener: () => void): void;
}

/** A worklet must write PCM on the selected track's actual sample grid. */
export async function acquireFramescaperCaptureAudioContext(
	shared: CaptureOutputContext,
	sampleRate: number,
	createContext: FramescaperCaptureAudioContextFactory = createRuntimeContext,
	options: Readonly<{ monitoring?: boolean; onWarning?: (error: unknown) => void }> = {},
): Promise<Readonly<{
	context: Readonly<{ sampleRate: number }> & CaptureAudioContextLifecycle;
	monitorDestination?: AudioNode;
	dispose(): Promise<void>;
}>> {
	if (shared.sampleRate === sampleRate) return { context: shared, dispose: async () => undefined };
	const context = createContext(sampleRate);
	let disposed = false;
	let releaseOutput = () => {};
	const dispose = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		releaseOutput();
		await context.close();
	};
	try {
		if (context.sampleRate !== sampleRate) {
			throw new Error('Capture AudioWorklet context must retain the source track sample rate.');
		}
		const output = options.monitoring !== false && shared.addEventListener && shared.removeEventListener
			? createMonitorOutput(context) : null;
		const routing = followCaptureOutput(shared, context, output, options.onWarning);
		releaseOutput = routing.dispose;
		await routing.settle();
		await context.resume();
		await routing.settle();
		routing.activate();
		return { context, ...(output ? { monitorDestination: output.node } : {}), dispose };
	} catch (error) {
		await dispose();
		throw error;
	}
}

/** Only successful shared sink changes are broadcast; input PCM keeps its own source clock. */
function followCaptureOutput(
	shared: CaptureOutputContext,
	context: FramescaperOwnedCaptureAudioContext,
	output: ReturnType<typeof createMonitorOutput> | null,
	onWarning: ((error: unknown) => void) | undefined,
) {
	let retired = false;
	let active = false;
	let revision = 0;
	let applied = '';
	let pending = Promise.resolve();
	const changed = () => {
		const request = ++revision;
		output?.setGain(0);
		pending = pending.catch(() => {}).then(async () => {
			if (retired || request !== revision) return;
			const target = captureSink(shared.sinkId);
			if (target === null) return; // AudioSinkInfo(type=none) deliberately has no hardware output.
			if (target !== applied) {
				if (!context.setSinkId) throw new Error('Capture monitoring cannot retain the selected output device.');
				await context.setSinkId(target);
				applied = target;
			}
			if (!retired && request === revision) output?.setGain(1);
		}).catch((error: unknown) => {
			if (retired || request !== revision) return;
			if (!active) throw error;
			try { onWarning?.(error); } catch { /* A monitor warning cannot interrupt recorded PCM. */ }
		});
		void pending.catch(() => {});
	};
	if (output) shared.addEventListener?.('sinkchange', changed);
	changed();
	return {
		async settle() {
			let current: Promise<void>;
			do { current = pending; await current; } while (current !== pending);
		},
		activate() { active = true; },
		dispose() {
			retired = true;
			if (output) shared.removeEventListener?.('sinkchange', changed);
			output?.setGain(0);
			output?.node.disconnect();
		},
	};
}

function captureSink(sinkId: unknown): string | null {
	if (sinkId === undefined || sinkId === 'default') return '';
	if (typeof sinkId === 'string') return sinkId;
	if (sinkId && typeof sinkId === 'object' && 'type' in sinkId && sinkId.type === 'none') return null;
	throw new TypeError('Capture monitoring output device is invalid.');
}

function createMonitorOutput(value: unknown) {
	if (!value || typeof value !== 'object' || !('currentTime' in value) || typeof value.currentTime !== 'number'
		|| !('createGain' in value) || typeof value.createGain !== 'function'
		|| !('destination' in value) || !value.destination || typeof value.destination !== 'object') {
		throw new TypeError('Capture monitoring requires its own audio context.');
	}
	const context = value as { readonly currentTime: number; readonly destination: AudioNode; createGain(): GainNode };
	const node = context.createGain();
	const setGain = (gain: number) => { node.gain.setValueAtTime(gain, context.currentTime); };
	setGain(0);
	node.connect(context.destination);
	return { node, setGain };
}

function createRuntimeContext(sampleRate: number): FramescaperOwnedCaptureAudioContext {
	if (typeof globalThis.AudioContext !== 'function') {
		throw new Error('Capture AudioWorklet context must retain the source track sample rate.');
	}
	return new globalThis.AudioContext({ sampleRate });
}
