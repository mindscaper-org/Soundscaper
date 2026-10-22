/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runs one native speech-analysis job in a terminateable utility-process thread. */

import { Worker } from 'node:worker_threads';

export function createAssistanceSpeechJobRunner({ WorkerImpl = Worker,
	loadGpuValidation = () => import('./project-library-runtime/desktop/assistance-sherpa-gpu-validation.js') } = {}) {
	return ({ grant, onProgress, jobId }) => {
		if (process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS === '1'
			&& process.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION === '1' && grant.operation !== 'status') {
			let runner = null;
			let cancelled = false;
			const completion = loadGpuValidation().then(async (module) => {
				runner = module.createValidatedSherpaSpeechJob({ jobId, grant, WorkerImpl, onProgress,
					workerEntry: new URL('./assistance-inference-worker.js', import.meta.url) });
				if (cancelled) await runner.cancel();
				return runner.completion;
			});
			return Object.freeze({ completion, async cancel() {
				cancelled = true;
				await runner?.cancel();
				await completion.catch(() => undefined);
			} });
		}
		let settled = false;
		const worker = new WorkerImpl(new URL('./assistance-inference-worker.js', import.meta.url), {
			workerData: grant,
		});
		const completion = new Promise((resolve, reject) => {
			worker.on('message', (message) => {
				if (settled) return;
				if (message?.type === 'progress' && typeof message.value === 'number') {
					onProgress(message.value);
					return;
				}
				settled = true;
				if (message?.type === 'result') resolve(message.result);
				else reject(reviveWorkerError(message?.error));
			});
			worker.once('error', (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});
			worker.once('exit', (code) => {
				if (settled) return;
				settled = true;
				reject(new Error(`The speech-analysis worker exited before answering (code ${String(code)}).`));
			});
		});
		return Object.freeze({
			completion,
			cancel: async () => {
				if (settled) return;
				await worker.terminate();
			},
		});
	};
}

function reviveWorkerError(value) {
	const error = new Error(typeof value?.message === 'string' ? value.message : 'The speech-analysis worker failed.');
	if (typeof value?.name === 'string') error.name = value.name;
	return error;
}
