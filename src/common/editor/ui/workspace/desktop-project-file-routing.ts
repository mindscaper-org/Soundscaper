/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveByteSource } from '../../../scape/archive-byte-source.ts';
import { SESX_XML_MAXIMUM_BYTES } from '../../sesx-format.ts';
import { SES_BINARY_MAXIMUM_BYTES } from '../../ses-format.ts';
import { withDesktopOriginalReadCleanup } from '../../desktop-original-file-port.ts';
import {
	DESKTOP_READ_PROFILE_MATERIALIZED,
	DESKTOP_READ_PROFILE_SCAPE_RANGE,
	DESKTOP_READ_PROFILE_SELECTED_RANGE,
} from '../../desktop-read-profile.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface DesktopProjectReadDescriptor {
	readonly id?: unknown;
	readonly readProfile?: unknown;
	readonly name?: unknown;
	readonly mimeType?: unknown;
	readonly size?: unknown;
}

export interface DesktopProjectReadService<Value> {
	withReadDescriptors(
		descriptors: readonly DesktopProjectReadDescriptor[],
		request: Readonly<Record<string, never>>,
		consume: (files: readonly Blob[]) => Awaitable<Value>,
	): PromiseLike<Value>;
	withScapeReadDescriptor(
		descriptor: DesktopProjectReadDescriptor,
		request: Readonly<Record<string, never>>,
		consume: (source: ScapeArchiveByteSource) => Awaitable<Value>,
	): PromiseLike<Value>;
	releaseRead?(id: string): Awaitable<unknown>;
	releaseOriginalFile?(id: string): Awaitable<unknown>;
	releaseSesxSession?(sessionReadId: string): Awaitable<unknown>;
}

export interface DesktopProjectConsumers<Value> {
	readonly openMaterialized: (file: Blob) => Awaitable<Value>;
	readonly openScape: (source: ScapeArchiveByteSource) => Awaitable<Value>;
}

export async function discardDesktopProjectReadDescriptor(
	fileService: Pick<DesktopProjectReadService<unknown>, 'releaseRead' | 'releaseSesxSession'> & {
		readonly releaseOriginalFile?: (id: string) => Awaitable<unknown>;
	},
	descriptor: DesktopProjectReadDescriptor,
): Promise<void> {
	await withDesktopOriginalReadCleanup([descriptor], fileService.releaseOriginalFile, async () => {
		if (typeof descriptor?.id !== 'string') return;
		try { await fileService.releaseRead?.(descriptor.id); }
		finally { await releaseDesktopProjectSession(fileService, descriptor); }
	});
}

export async function withDesktopProjectReadDescriptor<Value>(
	fileService: DesktopProjectReadService<Value>,
	descriptor: DesktopProjectReadDescriptor,
	consumers: DesktopProjectConsumers<Value>,
	admit?: () => Awaitable<void>,
): Promise<Value> {
	if (!fileService || typeof fileService !== 'object') {
		throw new TypeError('A desktop project file service is required.');
	}
	if (!consumers || typeof consumers.openMaterialized !== 'function'
		|| typeof consumers.openScape !== 'function') {
		throw new TypeError('Desktop project consumers are required.');
	}
	if (admit) {
		try { await admit(); }
		catch (error) {
			await discardDesktopProjectReadDescriptor(fileService, descriptor);
			throw error;
		}
	}
	try {
		if (descriptor?.readProfile === DESKTOP_READ_PROFILE_SCAPE_RANGE) {
			return await fileService.withScapeReadDescriptor(descriptor, {}, consumers.openScape);
		}
		if (descriptor?.readProfile !== DESKTOP_READ_PROFILE_MATERIALIZED
			&& descriptor?.readProfile !== DESKTOP_READ_PROFILE_SELECTED_RANGE) {
			return await fileService.withReadDescriptors([descriptor], {}, () => {
				throw new TypeError('A supported desktop project read profile is required.');
			});
		}
		const legacySes = /\.ses$/iu.test(String(descriptor?.name || ''));
		const reaper = /\.rpp$/iu.test(String(descriptor?.name || ''));
		const boundedSession = legacySes || reaper || /\.(?:sesx|nhsx)$/iu.test(String(descriptor?.name || ''));
		const sessionKind = legacySes ? 'SES' : reaper ? 'RPP' : /\.nhsx$/iu.test(String(descriptor?.name || '')) ? 'NHSX' : 'SESX';
		const maximumBytes = legacySes ? SES_BINARY_MAXIMUM_BYTES : SESX_XML_MAXIMUM_BYTES;
		if (boundedSession && typeof descriptor.size === 'number' && descriptor.size > maximumBytes) {
			if (typeof descriptor.id !== 'string' || typeof fileService.releaseRead !== 'function') {
				throw new Error(`Desktop ${sessionKind} capability release is unavailable.`);
			}
			await fileService.releaseRead(descriptor.id);
			throw new RangeError(`The ${sessionKind} session exceeds the 32 MiB ${legacySes ? 'binary' : reaper ? 'text' : 'XML'} limit.`);
		}
		return await fileService.withReadDescriptors([descriptor], {}, (files) => {
			if (files.length !== 1 || !(files[0] instanceof Blob)) {
				throw new Error('The desktop project descriptor did not produce one file.');
			}
			return consumers.openMaterialized(files[0]);
		});
	} finally {
		await releaseDesktopProjectSession(fileService, descriptor);
	}
}

async function releaseDesktopProjectSession(fileService: Pick<DesktopProjectReadService<unknown>, 'releaseSesxSession'>, descriptor: DesktopProjectReadDescriptor): Promise<void> {
	if (/\.(?:sesx?|edl|otio|fcpxml|omfi?|aaf|nhsx|rpp)$/iu.test(String(descriptor?.name || '')) && typeof descriptor?.id === 'string') {
		await fileService.releaseSesxSession?.(descriptor.id);
	}
}
