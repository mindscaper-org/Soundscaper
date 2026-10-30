/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer-ownership and cancellation boundary for main-owned audio codec jobs. */

import {
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityQuery,
} from './desktop-audio-codec-capability-contract.ts';
import {
	assertDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import { DesktopAudioCodecIpcQueue } from './desktop-audio-codec-ipc-queue.ts';

export interface DesktopAudioCodecMainIpcChannels {
	readonly desktopAudioCodecExecute: string;
	readonly desktopAudioCodecCancel: string;
	readonly desktopAudioCodecCapabilities: string;
}

export interface DesktopAudioCodecMainIpcService {
	capabilities(query: DesktopAudioCodecCapabilityQuery): Promise<unknown>;
	execute(
		request: DesktopAudioCodecRequest,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Promise<unknown>;
}

export interface DesktopAudioCodecMainIpcOptions<Owner extends object> {
	readonly channels: DesktopAudioCodecMainIpcChannels;
	readonly handle: (
		channel: string,
		listener: (event: unknown, ...arguments_: unknown[]) => unknown,
	) => void;
	readonly removeHandler: (channel: string) => void;
	readonly ownerFor: (event: unknown) => Owner;
	readonly service: DesktopAudioCodecMainIpcService;
	/** Lower-only test/deployment seams beneath the non-raiseable defaults. */
	readonly maximumActiveOperationsPerOwner?: number;
	readonly maximumActiveOperations?: number;
	readonly maximumActiveInputBytes?: number;
}

export interface DesktopAudioCodecMainIpcRegistration<Owner extends object> {
	revokeOwner(owner: Owner): Promise<boolean>;
	dispose(): Promise<void>;
}

const CHANNEL_FIELDS = Object.freeze([
	'desktopAudioCodecExecute', 'desktopAudioCodecCancel', 'desktopAudioCodecCapabilities',
] as const);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
export const DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS_PER_OWNER = 2;
export const DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS = 4;
export const DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_INPUT_BYTES = 64 * 1_024 * 1_024;

export function registerDesktopAudioCodecMainIpc<Owner extends object>(
	options: DesktopAudioCodecMainIpcOptions<Owner>,
): DesktopAudioCodecMainIpcRegistration<Owner> {
	validateOptions(options);
	const limits = ipcLimits(options);
	const queue = new DesktopAudioCodecIpcQueue<Owner>(limits,
		(request, signal) => options.service.execute(request, Object.freeze({ signal })));
	let disposed = false;
	let disposal: Promise<void> | null = null;
	const registered: string[] = [];
	const bind = (channel: string, listener: (event: unknown, ...arguments_: unknown[]) => unknown): void => {
		options.handle(channel, listener);
		registered.push(channel);
	};
	try {
		bind(options.channels.desktopAudioCodecExecute, async (event, ...arguments_) => {
			if (disposed) throw new Error('The desktop audio codec IPC service is disposed.');
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec execute IPC requires one request.');
			assertDesktopAudioCodecRequest(arguments_[0]);
			const candidate = arguments_[0];
			const requestId = requiredRequestId(candidate.requestId);
			const owner = owned(options.ownerFor(event));
			return queue.enqueue(owner, requestId, candidate);
		});
		bind(options.channels.desktopAudioCodecCancel, (event, ...arguments_) => {
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec cancel IPC requires one request ID.');
			const requestId = requiredRequestId(arguments_[0]);
			return queue.cancel(owned(options.ownerFor(event)), requestId);
		});
		bind(options.channels.desktopAudioCodecCapabilities, async (event, ...arguments_) => {
			if (disposed) throw new Error('The desktop audio codec IPC service is disposed.');
			if (arguments_.length !== 1) throw new TypeError('Desktop audio codec capability IPC requires one query.');
			owned(options.ownerFor(event));
			const query = normalizeDesktopAudioCodecCapabilityQuery(arguments_[0]);
			return normalizeDesktopAudioCodecCapabilityResult(
				await options.service.capabilities(query), query,
			);
		});
	} catch (error) {
		for (const channel of registered) options.removeHandler(channel);
		throw error;
	}

	return Object.freeze({
		async revokeOwner(ownerValue: Owner): Promise<boolean> {
			const owner = owned(ownerValue);
			return queue.revokeOwner(owner);
		},
		dispose(): Promise<void> {
			if (disposal !== null) return disposal;
			disposed = true;
			for (const channel of registered) options.removeHandler(channel);
			disposal = queue.dispose();
			return disposal;
		},
	});
}

function validateOptions<Owner extends object>(options: DesktopAudioCodecMainIpcOptions<Owner>): void {
	if (!options || typeof options !== 'object' || !options.channels
		|| typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function' || !options.service
		|| typeof options.service.execute !== 'function'
		|| typeof options.service.capabilities !== 'function'
		|| !validLowerLimit(options.maximumActiveOperationsPerOwner,
			DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS_PER_OWNER)
		|| !validLowerLimit(options.maximumActiveOperations,
			DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS)
		|| !validLowerLimit(options.maximumActiveInputBytes,
			DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_INPUT_BYTES)) {
		throw new TypeError('Desktop audio codec IPC ports are invalid.');
	}
	const channels = CHANNEL_FIELDS.map((field) => options.channels[field]);
	if (channels.some((channel) => typeof channel !== 'string' || channel.length < 1
		|| channel.length > 128 || !/^[a-z0-9:-]+$/u.test(channel))) {
		throw new TypeError('Desktop audio codec IPC channels are invalid.');
	}
	if (new Set(channels).size !== channels.length) {
		throw new TypeError('Desktop audio codec IPC channels must be unique.');
	}
}

function ipcLimits<Owner extends object>(
	options: DesktopAudioCodecMainIpcOptions<Owner>,
): Readonly<{ readonly perOwner: number; readonly total: number; readonly inputBytes: number }> {
	const total = options.maximumActiveOperations ?? DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS;
	const perOwner = options.maximumActiveOperationsPerOwner
		?? DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_OPERATIONS_PER_OWNER;
	if (perOwner > total) throw new RangeError('The desktop audio codec IPC per-owner limit exceeds its global limit.');
	return Object.freeze({
		perOwner,
		total,
		inputBytes: options.maximumActiveInputBytes ?? DESKTOP_AUDIO_CODEC_IPC_MAXIMUM_ACTIVE_INPUT_BYTES,
	});
}

function validLowerLimit(value: number | undefined, maximum: number): boolean {
	return value === undefined || Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function requiredRequestId(value: unknown): string {
	if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
		throw new TypeError('A desktop audio codec request ID is required.');
	}
	return value;
}

function owned<Owner extends object>(value: Owner): Owner {
	if (!value || typeof value !== 'object') throw new TypeError('A desktop renderer owner is required.');
	return value;
}
