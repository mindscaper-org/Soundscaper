import { realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from './constants.js';
import { isRetryableReadCapabilityAdmissionError } from './read-capability-admission.js';

// Positional arguments and open-with hand-offs admit every project suffix, not
// only the one this build writes.
export const OPENABLE_PROJECT_EXTENSIONS = Object.freeze([
	...ACCEPTED_PROJECT_FILE_EXTENSIONS, '.aup3', '.aup4', '.aup4unsaved',
]);

export class PendingProjectQueue {
	#deliver;
	#dispatchPromise = null;
	#dispatchRequested = false;
	#offers = new Map();
	#paths = [];

	constructor(deliver) {
		if (typeof deliver !== 'function') throw new TypeError('Pending project delivery callback is required');
		this.#deliver = deliver;
	}

	enqueue(filePath) {
		if (this.#paths.some((entry) => entry.filePath === filePath)) return false;
		this.#paths.push({ filePath });
		return true;
	}

	trackOffer(id, filePath, owner) {
		this.#offers.set(id, { filePath, owner });
	}

	claimOffer(id, owner) {
		const offer = this.#offers.get(id);
		return Boolean(offer && offer.owner === owner && this.#offers.delete(id));
	}

	requeueOffers(owner) {
		const retry = [];
		for (const [id, offer] of this.#offers) {
			if (offer.owner !== owner) continue;
			this.#offers.delete(id);
			retry.push({ filePath: offer.filePath });
		}
		if (!retry.length) return false;
		this.#paths = retry.concat(this.#paths);
		return true;
	}

	dispatch() {
		this.#dispatchRequested = true;
		this.#dispatchPromise ??= Promise.resolve().then(() => this.#drain());
		return this.#dispatchPromise;
	}

	async #drain() {
		try {
			do {
				this.#dispatchRequested = false;
				while (this.#paths.length) {
					const entry = this.#paths[0];
					if (!await this.#deliver(entry.filePath)) break;
					this.#paths.splice(this.#paths.indexOf(entry), 1);
				}
			} while (this.#dispatchRequested);
		} finally {
			this.#dispatchPromise = null;
		}
	}
}

export function createPendingProjectDelivery({
	isReady,
	currentOwner,
	isOwnerCurrent,
	register,
	release,
	send,
	onOffer,
	reportError,
}) {
	return async (filePath) => {
		if (!isReady()) return false;
		let descriptor = null;
		let owner = null;
		try {
			owner = currentOwner();
			const selectedPath = hasPosixParentSegment(filePath)
				? join(await realpath(dirname(filePath)), basename(filePath))
				: filePath;
			descriptor = await register(selectedPath, owner);
			if (!isOwnerCurrent(owner)) {
				const staleDescriptor = descriptor;
				descriptor = null;
				await releaseDescriptor(release, staleDescriptor, owner);
				return false;
			}
			if (send(descriptor) !== true) throw new Error('Renderer did not accept pending project delivery');
			onOffer?.(descriptor.id, filePath, owner);
			return true;
		} catch (error) {
			let reportedError = error;
			if (descriptor) {
				try {
					await releaseDescriptor(release, descriptor, owner);
				} catch (cleanupError) {
					reportedError = new AggregateError(
						[error, cleanupError],
						'Pending project delivery and read capability cleanup both failed',
						{ cause: cleanupError },
					);
				}
			}
			if (!isOwnerCurrent(owner)) return false;
			if (isRetryableReadCapabilityAdmissionError(error)) return false;
			reportError(reportedError);
			return true;
		}
	};
}

export async function redispatchPendingProjectsAfterReadRelease(queue, releasePromise) {
	const released = await releasePromise;
	if (released) void queue.dispatch();
	return released;
}

export function extractProjectPaths(argv, workingDirectory = process.cwd()) {
	const paths = [];
	let positionalOnly = false;
	for (const argument of Array.isArray(argv) ? argv : []) {
		if (typeof argument !== 'string') continue;
		if (argument === '--') {
			positionalOnly = true;
			continue;
		}
		if (!positionalOnly && argument.startsWith('-')) continue;
		let candidate = argument;
		if (candidate.startsWith('file://')) {
			try {
				candidate = fileURLToPath(candidate);
			} catch {
				continue;
			}
		}
		if (!OPENABLE_PROJECT_EXTENSIONS.includes(extname(candidate).toLowerCase())) continue;
		const absolutePath = absoluteProjectPath(candidate, workingDirectory);
		if (!paths.includes(absolutePath)) paths.push(absolutePath);
	}
	return paths;
}

export const extractAup4Paths = extractProjectPaths;

function absoluteProjectPath(candidate, workingDirectory) {
	if (isAbsolute(candidate)) return candidate;
	if (!hasPosixParentSegment(candidate)) return resolve(workingDirectory, candidate);
	// POSIX follows directory symlinks before interpreting parent segments.
	const directory = resolve(workingDirectory);
	return `${directory === '/' ? '' : directory}/${candidate}`;
}

function hasPosixParentSegment(path) {
	return process.platform !== 'win32' && path.split('/').includes('..');
}

async function releaseDescriptor(release, descriptor, owner) {
	if (!await release(descriptor.id, owner)) {
		throw new Error('Pending project read capability was not released');
	}
}
