/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeDesktopAudioCodecRequest, type DesktopAudioCodecRequest } from './desktop-audio-codec-operation-contract.ts';

export const DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_PENDING_OPERATIONS = 8;

export interface DesktopAudioCodecIpcQueueLimits {
	readonly perOwner: number;
	readonly total: number;
	readonly inputBytes: number;
}

interface Job<Owner extends object> {
	readonly owner: Owner;
	readonly id: string;
	readonly request: DesktopAudioCodecRequest;
	readonly inputBytes: number;
	readonly controller: AbortController;
	readonly settled: Promise<unknown>;
	readonly resolve: (value: unknown) => void;
	readonly reject: (reason: unknown) => void;
	active: boolean;
}

/** Retain bounded owned input while waiting for global and renderer-specific slots. */
export class DesktopAudioCodecIpcQueue<Owner extends object> {
	readonly #limits: DesktopAudioCodecIpcQueueLimits;
	readonly #execute: (request: DesktopAudioCodecRequest, signal: AbortSignal) => Promise<unknown>;
	readonly #jobs = new Map<string, Job<Owner>>();
	readonly #waiting: Job<Owner>[] = [];
	readonly #activeByOwner = new WeakMap<Owner, number>();
	readonly #revoked = new WeakSet<Owner>();
	#active = 0;
	#inputBytes = 0;
	#disposal: Promise<void> | null = null;

	constructor(limits: DesktopAudioCodecIpcQueueLimits,
		execute: (request: DesktopAudioCodecRequest, signal: AbortSignal) => Promise<unknown>) {
		this.#limits = limits;
		this.#execute = execute;
	}

	async enqueue(owner: Owner, id: string, candidate: DesktopAudioCodecRequest): Promise<unknown> {
		if (this.#disposal !== null || this.#revoked.has(owner)) throw new Error('The desktop audio codec owner or service was revoked.');
		if (this.#jobs.has(id)) throw new Error('The desktop audio codec request ID is already active.');
		if (candidate.input.byteLength > this.#limits.inputBytes - this.#inputBytes) {
			throw new Error('The desktop audio codec IPC aggregate input byte limit was reached.');
		}
		if (this.#waiting.length >= DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_PENDING_OPERATIONS) {
			throw new Error('The desktop audio codec IPC pending operation queue is full.');
		}
		const request = normalizeDesktopAudioCodecRequest(candidate);
		const completion = createCompletion<unknown>();
		const job: Job<Owner> = { owner, id, request, inputBytes: request.input.byteLength, controller: new AbortController(),
			settled: completion.promise, resolve: completion.resolve, reject: completion.reject, active: false };
		this.#jobs.set(id, job);
		this.#waiting.push(job);
		this.#inputBytes += job.inputBytes;
		this.#drain();
		return job.settled;
	}

	cancel(owner: Owner, id: string): boolean {
		const job = this.#jobs.get(id);
		if (!job || job.owner !== owner) return false;
		this.#cancel(job, 'The renderer cancelled the desktop audio codec operation.');
		return true;
	}

	async revokeOwner(owner: Owner): Promise<boolean> {
		this.#revoked.add(owner);
		const jobs = [...this.#jobs.values()].filter((job) => job.owner === owner);
		for (const job of jobs) this.#cancel(job, 'The owning renderer was revoked during a desktop audio codec operation.');
		await Promise.allSettled(jobs.map(({ settled }) => settled));
		return jobs.length > 0;
	}

	dispose(): Promise<void> {
		if (this.#disposal !== null) return this.#disposal;
		const completion = createCompletion<void>();
		this.#disposal = completion.promise;
		const jobs = [...this.#jobs.values()];
		for (const job of jobs) this.#cancel(job, 'The desktop audio codec IPC service stopped.');
		void Promise.allSettled(jobs.map(({ settled }) => settled)).then(() => { completion.resolve(); });
		return completion.promise;
	}

	#cancel(job: Job<Owner>, message: string): void {
		job.controller.abort(new DOMException(message, 'AbortError'));
		if (!job.active) this.#finish(job, true, job.controller.signal.reason);
	}

	#drain(): void {
		if (this.#disposal !== null) return;
		for (const job of [...this.#waiting]) {
			if (this.#active >= this.#limits.total) break;
			if (this.#revoked.has(job.owner)) continue;
			const ownerCount = this.#activeByOwner.get(job.owner) ?? 0;
			if (ownerCount >= this.#limits.perOwner) continue;
			this.#waiting.splice(this.#waiting.indexOf(job), 1);
			job.active = true;
			this.#active += 1;
			this.#activeByOwner.set(job.owner, ownerCount + 1);
			void Promise.resolve().then(() => {
				job.controller.signal.throwIfAborted();
				return this.#execute(job.request, job.controller.signal);
			}).then(
				(value) => { this.#finish(job, false, value); },
				(error: unknown) => { this.#finish(job, true, error); },
			);
		}
	}

	#finish(job: Job<Owner>, failed: boolean, value: unknown): void {
		if (this.#jobs.get(job.id) !== job) return;
		this.#jobs.delete(job.id);
		this.#inputBytes -= job.inputBytes;
		if (job.active) {
			this.#active -= 1;
			const count = (this.#activeByOwner.get(job.owner) ?? 1) - 1;
			if (count === 0) this.#activeByOwner.delete(job.owner);
			else this.#activeByOwner.set(job.owner, count);
		} else this.#waiting.splice(this.#waiting.indexOf(job), 1);
		if (failed) job.reject(value);
		else job.resolve(value);
		this.#drain();
	}
}

function createCompletion<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}
