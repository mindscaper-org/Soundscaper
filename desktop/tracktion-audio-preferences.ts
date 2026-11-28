/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';

import { readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import type { TracktionAudioSetup } from '../src/soundscaper/tracktion-audio-device-contract.ts';

import { readTracktionAudioSetup, tracktionAudioSetupFields } from './tracktion-audio-device-wire.ts';

export interface TracktionAudioPreferences {
	read(): Promise<TracktionAudioSetup | null>;
	write(setup: TracktionAudioSetup): Promise<void>;
}

export function tracktionAudioPreferences(path: string): TracktionAudioPreferences {
	return {
		async read() {
			const stream = await open(path, 'r').catch((error: unknown) => {
				const { code } = error as NodeJS.ErrnoException;
				if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null;
				throw error;
			});
			if (!stream) return null;
			try {
				const metadata = await stream.stat();
				if (!metadata.isFile() || metadata.size > 2048) return null;
				const buffer = Buffer.alloc(2049);
				const { bytesRead } = await stream.read(buffer);
				if (bytesRead > 2048) return null;
				const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)));
				const fields = readClosedDomainRecord(value, 'Tracktion audio preferences', ['version', ...tracktionAudioSetupFields]);
				return fields.version === 1 ? readTracktionAudioSetup(fields) : null;
			} catch (error) {
				if (error instanceof SyntaxError || error instanceof TypeError) return null;
				throw error;
			} finally {
				await stream.close();
			}
		},
		async write(setup) {
			const temporary = path + '.' + randomUUID() + '.tmp';
			try {
				const stream = await open(temporary, 'wx', 0o600);
				try {
					await stream.writeFile(JSON.stringify({ version: 1, ...setup }) + '\n', 'utf8');
					await stream.sync();
				} finally {
					await stream.close();
				}
				await rename(temporary, path);
			} catch (error) {
				await rm(temporary, { force: true });
				throw error;
			}
		},
	};
}
