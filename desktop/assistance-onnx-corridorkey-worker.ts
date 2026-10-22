/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated, bounded, full-source CorridorKey inference with continuous recurrent state. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ASSISTANCE_BINARY_MAXIMUM_BYTES } from '../src/common/editor/assistance/binary-formats-v1.ts';
import { validateAssistanceSelectionFence } from '../src/common/editor/assistance/proposal-session.ts';
import {
	createAssistanceVisualFramePackV2,
	reviewAssistanceVisualFramePackV2,
	type ReviewedAssistanceVisualFramePackV2,
	type AssistanceVisualFramePackV2FrameDraft,
} from '../src/common/editor/assistance/visual-frame-pack-v2.ts';
import {
	createCorridorKeyOnnxFrameProcessorV1,
	type CorridorKeyOnnxFrameProcessorOptionsV1,
	type CorridorKeyOnnxFrameProcessorV1,
} from './assistance-corridorkey-inference.ts';
import { corridorKeyModelPathsFromGrantsV1 } from './assistance-corridorkey-model.ts';
import type { AssistanceRuntimeFamilyInputGrantV1,
	AssistanceRuntimeFamilyJobResultV1 } from './assistance-runtime-family-job-contract.ts';
import type { AssistanceRuntimeFamilyWorkerExecutionContext } from './assistance-runtime-family-worker-entry.ts';
import { publishAssistanceOnnxOutputV1 } from './assistance-onnx-worker-common.ts';
import { assistanceOnnxRuntimeValueV1, assertAssistanceOnnxVisualRuntimeJobV1,
	type AssistanceOnnxVisualRuntimeLoaderV1 } from './assistance-onnx-visual-worker-common.ts';

const MIME = 'application/vnd.soundscaper.frame-pack';
const MAXIMUM_PACKS = 64;
const MAXIMUM_STREAM_BYTES = 8 * 1024 ** 3;

export interface AssistanceOnnxCorridorKeyWorkerOptionsV1 {
	/** Test seam; production always uses the five authenticated ONNX graphs. */
	readonly createProcessor?: (options: CorridorKeyOnnxFrameProcessorOptionsV1) =>
		Promise<CorridorKeyOnnxFrameProcessorV1>;
}

interface StreamGeometry {
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frameCount: number;
}

export function createAssistanceOnnxCorridorKeyWorkerAdapterV1(
	loadRuntime: AssistanceOnnxVisualRuntimeLoaderV1,
	options: AssistanceOnnxCorridorKeyWorkerOptionsV1 = {},
): (context: AssistanceRuntimeFamilyWorkerExecutionContext) => Promise<AssistanceRuntimeFamilyJobResultV1> {
	if (typeof loadRuntime !== 'function'
		|| options.createProcessor !== undefined && typeof options.createProcessor !== 'function') {
		throw new TypeError('CorridorKey requires its authenticated runtime loader and processor factory.');
	}
	const createProcessor = options.createProcessor ?? createCorridorKeyOnnxFrameProcessorV1;
	return async context => {
		assertAssistanceOnnxVisualRuntimeJobV1(context, 'video-keying');
		assertSettingsAndGrants(context);
		const modelPaths = corridorKeyModelPathsFromGrantsV1(context.grant.models);
		context.signal?.throwIfAborted();
		const geometry = await inspectStream(context);
		context.onProgress(0);
		const runtime = assistanceOnnxRuntimeValueV1(await loadRuntime(context.job.descriptor.entrypoint));
		const processor = await createProcessor({ runtime, modelPaths, signal: context.signal });
		let completed = 0;
		const outputs: AssistanceRuntimeFamilyJobResultV1['outputs'][number][] = [];
		try {
			for (const [index, input] of context.grant.inputs.entries()) {
				const pack = await readPack(input, context.signal);
				const frames: AssistanceVisualFramePackV2FrameDraft[] = [];
				for (let ordinal = 0; ordinal < pack.frameCount; ordinal += 1) {
					context.signal?.throwIfAborted();
					const frame = pack.frame(ordinal);
					const keyed = await processor.process({ width: geometry.width, height: geometry.height, rgba: frame.rgba });
					if (keyed.width !== geometry.width || keyed.height !== geometry.height
						|| !(keyed.rgba instanceof Uint8Array) || keyed.rgba.length !== geometry.width * geometry.height * 4) {
						throw new RangeError('CorridorKey output changed its exact full-source RGBA geometry.');
					}
					frames.push({ sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick, rgba: keyed.rgba });
					completed += 1;
					context.onProgress(completed / (geometry.frameCount + 1));
				}
				const chunks = createAssistanceVisualFramePackV2({ sourceWidth: geometry.width, sourceHeight: geometry.height,
					rasterWidth: geometry.width, rasterHeight: geometry.height, timescale: geometry.timescale, frames });
				const published = await publishAssistanceOnnxOutputV1({ ...context,
					grant: { ...context.grant, outputs: [context.grant.outputs[index]!] }, onProgress: () => {} },
				chunks, 'Keyed frames exceed their exact authenticated pack reservation.', { exactOutputCount: 1 });
				outputs.push(published.outputs[0]!);
			}
			context.signal?.throwIfAborted();
			context.onProgress(1);
			return Object.freeze({ resultVersion: 1, jobId: context.grant.jobId,
				familyId: 'onnxruntime-node', task: 'video-keying', outputs: Object.freeze(outputs) });
		} finally { await processor.release(); }
	};
}

function assertSettingsAndGrants(context: AssistanceRuntimeFamilyWorkerExecutionContext): void {
	const { settings, grant } = context;
	if (settings.schemaVersion !== 1 || settings.operation !== 'video-keying'
		|| Object.keys(settings).sort().join(',') !== 'inputRoles,operation,outputRoles,schemaVersion,selectionFence'
		|| grant.inputs.length < 1 || grant.inputs.length > MAXIMUM_PACKS
		|| grant.outputs.length !== grant.inputs.length
		|| grant.inputs.some(input => input.role !== 'frame-pack' || input.mediaType !== MIME
			|| input.byteLength < 1 || input.byteLength > ASSISTANCE_BINARY_MAXIMUM_BYTES)
		|| grant.outputs.some((output, index) => output.role !== 'keyed-frames' || output.mediaType !== MIME
			|| output.maximumByteLength !== grant.inputs[index]!.byteLength)
		|| JSON.stringify(settings.inputRoles) !== JSON.stringify(grant.inputs.map(() => 'frame-pack'))
		|| JSON.stringify(settings.outputRoles) !== JSON.stringify(grant.outputs.map(() => 'keyed-frames'))) {
		throw new TypeError('Video keying requires exact paired frame-pack grants and settings.');
	}
	const totalBytes = grant.inputs.reduce((sum, input) => sum + input.byteLength, 0);
	if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_STREAM_BYTES) {
		throw new RangeError('Video keying exceeds its aggregate 8 GiB frame-pack byte bound.');
	}
	const fence = validateAssistanceSelectionFence(settings.selectionFence);
	if (fence.schemaFamily !== 'framescaper' || fence.sourceStartFrame !== 0) {
		throw new TypeError('Video keying requires Framescaper full-source selection authority starting at ordinal zero.');
	}
}

async function inspectStream(context: AssistanceRuntimeFamilyWorkerExecutionContext): Promise<StreamGeometry> {
	let width = 0;
	let height = 0;
	let timescale = 0;
	let frameCount = 0;
	let previousTick = -1n;
	for (const input of context.grant.inputs) {
		const pack = await readPack(input, context.signal);
		if (pack.frameCount < 1 || pack.rasterWidth !== pack.sourceWidth || pack.rasterHeight !== pack.sourceHeight) {
			throw new RangeError('Video keying requires every full-source frame at native raster geometry.');
		}
		if (width !== 0 && (pack.sourceWidth !== width || pack.sourceHeight !== height || pack.timescale !== timescale)) {
			throw new RangeError('Video keying frame packs changed source geometry or exact timescale.');
		}
		width = pack.sourceWidth;
		height = pack.sourceHeight;
		timescale = pack.timescale;
		for (let ordinal = 0; ordinal < pack.frameCount; ordinal += 1) {
			const timing = pack.frameTiming(ordinal);
			if (timing.sourceFrame !== frameCount || BigInt(timing.presentationTick) <= previousTick) {
				throw new RangeError('Video keying requires contiguous full-source ordinals and increasing presentation ticks.');
			}
			previousTick = BigInt(timing.presentationTick);
			frameCount += 1;
		}
	}
	const fence = validateAssistanceSelectionFence(context.settings.selectionFence);
	if (fence.sourceEndFrame !== frameCount) {
		throw new RangeError('Video keying frame packs must exactly cover their full-source selection fence.');
	}
	return Object.freeze({ width, height, timescale, frameCount });
}

async function readPack(input: AssistanceRuntimeFamilyInputGrantV1, signal?: AbortSignal): Promise<ReviewedAssistanceVisualFramePackV2> {
	signal?.throwIfAborted();
	const bytes = await readFile(input.path);
	signal?.throwIfAborted();
	if (bytes.length !== input.byteLength || createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
		throw new Error('A video keying input changed its authenticated byte identity or digest.');
	}
	return reviewAssistanceVisualFramePackV2(bytes);
}
