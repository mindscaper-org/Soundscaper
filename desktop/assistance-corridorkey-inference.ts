/* SPDX-License-Identifier: AGPL-3.0-only */

/** Isolated five-graph CorridorKey frame inference; model admission belongs to its caller. */

import {
	decodeCorridorKeyPixelsV1,
	prepareCorridorKeyPixelsV1,
	type CorridorKeyRasterV1,
} from '../src/common/editor/assistance/corridorkey-pixels-v1.ts';
import type {
	AssistanceOnnxInferenceSessionV1,
	AssistanceOnnxRuntimeModuleV1,
	AssistanceOnnxTensorV1,
} from './assistance-onnx-runtime-worker.ts';
import { exactAssistanceFloatTensorV1 } from './assistance-onnx-visual-tensors.ts';
import {
	assistanceOnnxRuntimeValueV1,
	createAssistanceOnnxVisualSessionV1,
	exactAssistanceOnnxOutputsV1,
} from './assistance-onnx-visual-worker-common.ts';

const GRAPH_SIGNATURES = Object.freeze({
	cradio: [['rgb'], ['features']],
	moge: [['rgb'], ['features']],
	rvm: [['rgb', 'state'], ['features', 'state_out']],
	stage1: [['rgb', 'hint', 'moge', 'cradio', 'rvm', 'quality'], ['baton', 'aux']],
	stage2: [['rgb', 'baton'], ['logits']],
} as const);
type GraphRole = keyof typeof GRAPH_SIGNATURES;
type Tensors = Readonly<Record<string, AssistanceOnnxTensorV1>>;

export interface CorridorKeyOnnxFrameProcessorOptionsV1 {
	/** Must be the authenticated GPU-wrapped runtime; this module never loads a runtime itself. */
	readonly runtime: AssistanceOnnxRuntimeModuleV1;
	/** Paths already admitted against the caller's exact model artifact identities. */
	readonly modelPaths: Readonly<Record<GraphRole, string>>;
	readonly signal?: AbortSignal;
}

export interface CorridorKeyOnnxFrameProcessorV1 {
	/** Calls snapshot input pixels and serialize one native-geometry stream with continuous RVM state. */
	process(frame: CorridorKeyRasterV1): Promise<CorridorKeyRasterV1>;
	/** Stop accepting frames, finish queued work, and release every session exactly once. */
	release(): Promise<void>;
}

/**
 * T=1 is the upstream low-memory execution mode: RVM retains temporal state,
 * while stage one and stage two process one frame with no hint (quality -1).
 * Shared session creation supplies baseline options to the caller's GPU wrapper,
 * which alone selects authenticated accelerators and manages CPU fallback.
 */
export async function createCorridorKeyOnnxFrameProcessorV1(
	options: CorridorKeyOnnxFrameProcessorOptionsV1,
): Promise<CorridorKeyOnnxFrameProcessorV1> {
	if (!options || typeof options !== 'object' || !options.modelPaths
		|| options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
		throw new TypeError('CorridorKey inference requires model paths and an optional abort signal.');
	}
	const runtime = assistanceOnnxRuntimeValueV1(options.runtime);
	const signal = options.signal;
	const roles = Object.keys(GRAPH_SIGNATURES) as GraphRole[];
	const paths = {} as Record<GraphRole, string>;
	for (const role of roles) {
		if (typeof options.modelPaths[role] !== 'string' || options.modelPaths[role].trim() === '') {
			throw new TypeError(`CorridorKey ${role} model path is missing.`);
		}
		paths[role] = options.modelPaths[role];
	}
	const obtained: AssistanceOnnxInferenceSessionV1[] = [];
	const sessions = {} as Record<GraphRole, AssistanceOnnxInferenceSessionV1>;
	// Capture sessions before the shared signature/surface validators can reject one.
	const capturingRuntime: AssistanceOnnxRuntimeModuleV1 = {
		Tensor: runtime.Tensor,
		InferenceSession: { create: async (path, settings) => {
			const session = await runtime.InferenceSession.create(path, settings);
			obtained.push(session);
			return session;
		} },
	};
	let accepting = true;
	let failed = false;
	let tail: Promise<void> = Promise.resolve();
	let closing: Promise<void> | null = null;
	let releaseResult: Promise<void> | null = null;
	let nativeGeometry: string | null = null;
	let rvmState: Float32Array | null = null;
	const onAbort = (): void => { void release().catch(() => {}); };
	try {
		for (const role of roles) {
			signal?.throwIfAborted();
			sessions[role] = await createAssistanceOnnxVisualSessionV1(capturingRuntime,
				paths[role], GRAPH_SIGNATURES[role][0], GRAPH_SIGNATURES[role][1]);
			signal?.throwIfAborted();
		}
	} catch (error) {
		await retire(error);
	}
	signal?.addEventListener('abort', onAbort, { once: true });
	// An abort can arrive while the last session creation is resolving.
	if (signal?.aborted) { await release(); signal.throwIfAborted(); }
	return Object.freeze({ process, release });

	function closeSessions(): Promise<void> {
		if (closing !== null) return closing;
		accepting = false;
		rvmState = null;
		signal?.removeEventListener('abort', onAbort);
		const captured = obtained.splice(0);
		closing = (async () => {
			const results = await Promise.allSettled(captured.map(async session => {
				if (typeof session?.release === 'function') await session.release();
			}));
			const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
				.map(result => result.reason as unknown);
			if (errors.length) throw new AggregateError(errors, 'CorridorKey session cleanup failed.');
		})();
		return closing;
	}

	async function retire(error: unknown): Promise<never> {
		failed = true;
		let cleanupFailed = false;
		let cleanupFailure: unknown;
		try { await closeSessions(); }
		catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; }
		if (cleanupFailed) throw new AggregateError([error, cleanupFailure], 'CorridorKey inference and cleanup failed.', { cause: error });
		throw error;
	}

	function release(): Promise<void> {
		accepting = false;
		releaseResult ??= tail.then(closeSessions);
		return releaseResult;
	}

	function process(frame: CorridorKeyRasterV1): Promise<CorridorKeyRasterV1> {
		if (!accepting) return Promise.reject(new Error('The CorridorKey frame processor is closed.'));
		const snapshot = frame && typeof frame === 'object'
			? { width: frame.width, height: frame.height,
				rgba: frame.rgba instanceof Uint8Array ? Uint8Array.from(frame.rgba) : frame.rgba } : frame;
		const result = tail.then(async () => {
			if (failed) throw new Error('The CorridorKey frame processor is closed.');
			try { return await infer(snapshot); }
			catch (error) { return retire(error); }
		});
		tail = result.then(() => undefined, () => undefined);
		return result;
	}

	async function run(role: GraphRole, feeds: Tensors): Promise<Tensors> {
		signal?.throwIfAborted();
		const result = await sessions[role].run(feeds);
		signal?.throwIfAborted();
		return exactAssistanceOnnxOutputsV1(result, GRAPH_SIGNATURES[role][1]);
	}

	function tensor(data: Float32Array, dims: readonly number[]): AssistanceOnnxTensorV1 {
		const value = new runtime.Tensor('float32', data, dims);
		exactAssistanceFloatTensorV1(value, dims, 'CorridorKey input');
		return value;
	}

	async function infer(frame: CorridorKeyRasterV1): Promise<CorridorKeyRasterV1> {
		signal?.throwIfAborted();
		const prepared = prepareCorridorKeyPixelsV1(frame);
		const geometry = `${prepared.width}x${prepared.height}`;
		if (nativeGeometry !== null && nativeGeometry !== geometry) {
			throw new RangeError('CorridorKey stream native geometry cannot change between frames.');
		}
		nativeGeometry = geometry;
		const h = prepared.paddedHeight;
		const w = prepared.paddedWidth;
		const gh = h / 64;
		const gw = w / 64;
		const cradio = await run('cradio', { rgb: tensor(areaResize(prepared.foundationRgb, w, h, w / 4, h / 4),
			[1, 3, h / 4, w / 4]) });
		const cradioData = exactAssistanceFloatTensorV1(cradio.features, [1, 1152, gh, gw], 'CorridorKey C-RADIO features');
		const moge = await run('moge', { rgb: tensor(areaResize(prepared.foundationRgb, w, h, w * 7 / 32, h * 7 / 32),
			[1, 3, h * 7 / 32, w * 7 / 32]) });
		const mogeData = exactAssistanceFloatTensorV1(moge.features, [1, 768, gh, gw], 'CorridorKey MoGe features');
		const stateDims = [1, 1 + gh * gw, 384];
		const recurrent = await run('rvm', {
			rgb: tensor(bilinearResize(prepared.foundationRgb, w, h, w / 4, h / 4), [1, 1, 3, h / 4, w / 4]),
			state: tensor(rvmState ?? new Float32Array((1 + gh * gw) * 384), stateDims),
		});
		const recurrentData = exactAssistanceFloatTensorV1(recurrent.features, [1, 1, 384, gh, gw], 'CorridorKey RVM features');
		const nextState = exactAssistanceFloatTensorV1(recurrent.state_out, stateDims, 'CorridorKey RVM state');
		const rgb = tensor(prepared.modelRgb, [1, 1, 3, h, w]);
		const first = await run('stage1', { rgb,
			hint: tensor(new Float32Array(h * w), [1, 1, 1, h, w]),
			moge: tensor(mogeData, [1, 1, 768, gh, gw]),
			cradio: tensor(cradioData, [1, 1, 1152, gh, gw]),
			rvm: tensor(recurrentData, [1, 1, 384, gh, gw]),
			quality: tensor(new Float32Array([-1]), [1, 1]),
		});
		const baton = exactAssistanceFloatTensorV1(first.baton, [1, 1, 512, h / 16, w / 16], 'CorridorKey baton');
		exactAssistanceFloatTensorV1(first.aux, [1, 1, 4, h / 2, w / 2], 'CorridorKey auxiliary output');
		const second = await run('stage2', { rgb, baton: tensor(baton, [1, 1, 512, h / 16, w / 16]) });
		const logits = exactAssistanceFloatTensorV1(second.logits, [1, 1, 4, h, w], 'CorridorKey refined output');
		const result = decodeCorridorKeyPixelsV1({ width: prepared.width, height: prepared.height,
			alpha: logits.subarray(0, h * w), foreground: logits.subarray(h * w) });
		signal?.throwIfAborted();
		rvmState = nextState.slice();
		return result;
	}
}

/** PyTorch area downsampling uses adaptive-average bins, including overlapping boundary bins. */
function areaResize(source: Float32Array, width: number, height: number,
	targetWidth: number, targetHeight: number): Float32Array {
	const output = new Float32Array(3 * targetWidth * targetHeight);
	for (let channel = 0; channel < 3; channel += 1) {
		for (let y = 0; y < targetHeight; y += 1) {
			const top = Math.floor(y * height / targetHeight);
			const bottom = Math.ceil((y + 1) * height / targetHeight);
			for (let x = 0; x < targetWidth; x += 1) {
				const left = Math.floor(x * width / targetWidth);
				const right = Math.ceil((x + 1) * width / targetWidth);
				let sum = 0;
				for (let sy = top; sy < bottom; sy += 1) for (let sx = left; sx < right; sx += 1) {
					sum += source[channel * width * height + sy * width + sx]!;
				}
				output[channel * targetWidth * targetHeight + y * targetWidth + x] = sum / ((bottom - top) * (right - left));
			}
		}
	}
	return output;
}

/** RVM's align_corners=false bilinear input uses pixel-center coordinates, without antialiasing. */
function bilinearResize(source: Float32Array, width: number, height: number,
	targetWidth: number, targetHeight: number): Float32Array {
	const output = new Float32Array(3 * targetWidth * targetHeight);
	for (let channel = 0; channel < 3; channel += 1) {
		for (let y = 0; y < targetHeight; y += 1) {
			const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / targetHeight - 0.5));
			const top = Math.floor(sy);
			const bottom = Math.min(height - 1, top + 1);
			const fy = sy - top;
			for (let x = 0; x < targetWidth; x += 1) {
				const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / targetWidth - 0.5));
				const left = Math.floor(sx);
				const right = Math.min(width - 1, left + 1);
				const fx = sx - left;
				const offset = channel * width * height;
				const upper = source[offset + top * width + left]! * (1 - fx) + source[offset + top * width + right]! * fx;
				const lower = source[offset + bottom * width + left]! * (1 - fx) + source[offset + bottom * width + right]! * fx;
				output[channel * targetWidth * targetHeight + y * targetWidth + x] = upper * (1 - fy) + lower * fy;
			}
		}
	}
	return output;
}
