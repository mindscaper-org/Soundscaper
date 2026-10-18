/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
	isAssistanceGpuValidationEnabled, recordAssistanceGpuValidation, withAssistanceGpuValidationJob,
} from './assistance-gpu-validation.ts';
import { readAssistanceOnnxGpuProfileDirectoryV1 } from './assistance-onnx-gpu-profile.ts';
import { validateAssistanceSpeechJobGrant, type AssistanceSpeechJobGrant } from './assistance-speech-job-contract.ts';

type Provider = 'webgpu';
interface ProfilePlan { readonly directory: string; readonly modelIds: readonly string[]; }
interface Selection { readonly modelId: string; readonly provider: Provider; }
interface WorkerPort {
	on(event: 'message', listener: (value: unknown) => void): this;
	once(event: 'error' | 'exit', listener: (value: unknown) => void): this;
	terminate(): Promise<number>;
}
interface Options {
	readonly jobId: string;
	readonly grant: unknown;
	readonly workerEntry: URL;
	readonly WorkerImpl: new (entry: URL, options: { workerData: unknown }) => WorkerPort;
	readonly onProgress: (value: number) => void;
}

/** The worker configures profiling; its parent reads flushed native traces after exit. */
export function createValidatedSherpaSpeechJob(options: Options) {
	let worker: WorkerPort | null = null;
	let cancelled = false;
	let completed = false;
	const completion = (async () => {
		if (!isAssistanceGpuValidationEnabled()) throw new Error('Sherpa GPU validation requires trusted test mode.');
		const grant = validateAssistanceSpeechJobGrant(options.grant);
		const modelIds = modelIdsFor(grant);
		const root = process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT!;
		const stat = await lstat(root);
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Sherpa profiling requires a private regular directory.');
		const directory = await mkdtemp(join(root, 'sherpa-profile-'));
		try {
			for (const modelId of modelIds) for (const provider of ['webgpu']) {
				await writeFile(join(directory, `${modelId}-${provider}.config`),
					`ProfilingFilePrefix=${join(directory, `${modelId}-${provider}`)}\n`, { flag: 'wx', mode: 0o600 });
			}
			if (cancelled) throw new DOMException('Sherpa GPU validation was cancelled.', 'AbortError');
			worker = new options.WorkerImpl(options.workerEntry, { workerData: {
				grant, gpuValidation: { directory, modelIds },
			} });
			const { result, selections } = await waitForWorker(worker, options.onProgress, () => cancelled);
			if (selections.length !== modelIds.length || modelIds.some(id => !selections.some(value => value.modelId === id))) {
				throw new Error('Sherpa did not report one observed provider for every authenticated model.');
			}
			for (const { modelId, provider } of selections) {
				const work = await readAssistanceOnnxGpuProfileDirectoryV1(directory, `${modelId}-${provider}`,
					'WebGpuExecutionProvider');
				if (cancelled) throw new DOMException('Sherpa GPU validation was cancelled.', 'AbortError');
				await withAssistanceGpuValidationJob({ jobId: options.jobId, familyId: 'sherpa-onnx-node', modelIds: [modelId] },
					async () => await recordAssistanceGpuValidation({ provider, proof: 'onnx-profile',
						gpuWorkCount: work.gpuKernelCount, cpuWorkCount: work.cpuKernelCount,
						...(work.processIds === undefined ? {} : { processIds: work.processIds }) }));
			}
			return result;
		} finally {
			completed = true;
			await rm(directory, { recursive: true, force: true });
		}
	})();
	return Object.freeze({ completion, async cancel() {
		if (completed) return;
		cancelled = true;
		await worker?.terminate();
		await completion.catch(() => undefined);
	} });
}

export function createSherpaGpuProfileProvider(value: unknown) {
	if (!isAssistanceGpuValidationEnabled() || !value || typeof value !== 'object') throw new Error('Invalid Sherpa GPU profile plan.');
	const { directory, modelIds } = value as ProfilePlan;
	const root = process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT!;
	const child = typeof directory === 'string' ? relative(root, directory) : '..';
	if (!isAbsolute(directory) || /[\r\n]/u.test(directory) || !child || child === '..' || child.startsWith(`..${sep}`)
		|| !Array.isArray(modelIds) || modelIds.length < 1 || modelIds.length > 32
		|| modelIds.some(id => typeof id !== 'string' || !/^[a-z\d][a-z\d.-]{0,63}$/u.test(id))) {
		throw new Error('The Sherpa GPU profile plan escaped its trusted job directory.');
	}
	const selected = new Map<string, Provider>();
	return Object.freeze({
		providerForModel(modelId: string, provider: string): string {
			if (!modelIds.includes(modelId) || provider !== 'webgpu') {
				throw new Error('GPU validation forbids a foreign Sherpa model or CPU fallback.');
			}
			selected.set(modelId, provider);
			return `${provider}:${join(directory, `${modelId}-${provider}.config`)}`;
		},
		selections: () => [...selected].map(([modelId, provider]) => ({ modelId, provider })),
	});
}

function modelIdsFor(grant: AssistanceSpeechJobGrant): readonly string[] {
	if (grant.operation === 'status') throw new Error('GPU profiling requires an inference job.');
	return grant.operation === 'diarize-speakers' ? Object.values(grant.modelIds) : [grant.modelId];
}

function waitForWorker(worker: WorkerPort, onProgress: (value: number) => void, cancelled: () => boolean) {
	return new Promise<{ result: unknown; selections: readonly Selection[] }>((resolve, reject) => {
		let terminal: { result: unknown } | null = null;
		let selections: readonly Selection[] = [];
		let failure: Error | null = null;
		worker.on('message', (value: unknown) => {
			if (failure) return;
			try {
				if (!value || typeof value !== 'object' || terminal) throw new Error('Sherpa repeated its terminal result.');
				const message = value as Record<string, unknown>;
				if (message.type === 'progress' && typeof message.value === 'number') { onProgress(message.value); return; }
				if (message.type === 'gpu-profiles') {
					if (selections.length || !Array.isArray(message.selections) || message.selections.length > 32) throw new Error('Malformed Sherpa GPU profile selections.');
					selections = message.selections.map((entry: unknown) => {
						if (!entry || typeof entry !== 'object') throw new Error('Malformed Sherpa GPU profile selection.');
						const row = entry as Selection;
						if (typeof row.modelId !== 'string' || row.provider !== 'webgpu') throw new Error('Malformed Sherpa GPU provider.');
						return { modelId: row.modelId, provider: row.provider };
					});
					return;
				}
				if (message.type === 'result') terminal = { result: message.result };
				else throw new Error(typeof (message.error as { message?: unknown } | undefined)?.message === 'string'
					? (message.error as { message: string }).message : 'Sherpa GPU inference failed.');
			} catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
		});
		worker.once('error', value => { failure = value instanceof Error ? value : new Error(String(value)); });
		worker.once('exit', code => {
			if (cancelled()) reject(new DOMException('Sherpa GPU validation was cancelled.', 'AbortError'));
			else if (failure) reject(failure);
			else if (code !== 0 || !terminal) reject(new Error('Sherpa GPU worker exited without a successful result.'));
			else resolve({ result: terminal.result, selections });
		});
	});
}
