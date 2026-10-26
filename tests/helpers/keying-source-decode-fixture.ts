/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { externalFfmpegExecutablePairClosureSha256 } from '../../desktop/external-ffmpeg-node-runtime.ts';
export async function admittedExternalFfmpeg(directory: string) {
	const executablePath = join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
	const ffprobePath = join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
	const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
	const ffmpegSha256 = await digest(executablePath), ffprobeSha256 = await digest(ffprobePath);
	const admission = { executablePath, version: 'source-decode-test', capabilityGeneration: 'source-decode-test',
		identity: { version: 'source-decode-test', ffmpegSha256, ffprobePath, ffprobeSha256,
			executablePairClosureSha256: externalFfmpegExecutablePairClosureSha256({ ffmpegPath: executablePath, ffmpegSha256, ffprobePath, ffprobeSha256 }) },
		capabilities: { encoders: ['rawvideo'], decoders: ['prores'], muxers: ['rawvideo'], demuxers: ['mov'], filters: [] } };
	return { admission: () => admission, invalidateAdmission: async () => { throw new Error('Unexpected executable identity change.'); } };
}
