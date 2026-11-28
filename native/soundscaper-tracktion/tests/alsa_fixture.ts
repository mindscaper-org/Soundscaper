/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync, spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';

type StopFixture = () => Promise<void>;

export async function writeAlsaOutputFixture(config: string, output: string): Promise<void> {
	await writeFile(config, `
pcm.null { type null }
pcm.!default {
	type file
	slave.pcm "null"
	file ${JSON.stringify(output)}
	format "raw"
	hint.description "Soundscaper test output"
}
`);
}

export async function startAlsaCaptureFixture(config: string, input: string): Promise<StopFixture> {
	await writeFile(config, `
pcm.null { type null }
pcm.!default {
	type asym
	playback.pcm "null"
	capture.pcm {
		type file
		slave.pcm "null"
		file "/dev/null"
		infile ${JSON.stringify(input)}
		format "raw"
	}
	hint.description "Soundscaper test duplex"
}
`);
	return startAlsaInput(input, [0.25]);
}

export async function startAlsaRoutingFixture(config: string, input: string, output: string): Promise<StopFixture> {
	await writeFile(config, `
pcm.null { type null }
pcm.!default {
	type null
	hint.description "Default duplex"
}
pcm.selected {
	type asym
	playback.pcm {
		type file
		slave.pcm "null"
		file ${JSON.stringify(output)}
		format "raw"
	}
	capture.pcm {
		type file
		slave.pcm "null"
		file "/dev/null"
		infile ${JSON.stringify(input)}
		format "raw"
	}
	hint.description "Selected duplex"
}
`);
	return startAlsaInput(input, [0.125, 0.375]);
}

// ALSA's null device runs without a hardware clock, even before Record.
// Feed a constant stream across device reopens so it cannot exhaust the input.
function startAlsaInput(input: string, samples: readonly number[]): StopFixture {
	execFileSync('mkfifo', [input]);
	const frame = Buffer.alloc(samples.length * 4);
	samples.forEach((sample, index) => frame.writeFloatLE(sample, index * 4));
	const producer = spawn(process.execPath, ['--eval', `
		const fs = require('node:fs');
		const [path, bytes] = process.argv.slice(1);
		const block = Buffer.alloc(4096).fill(Buffer.from(bytes, 'hex'));
		while (true) {
			const fd = fs.openSync(path, 'w');
			try { while (true) fs.writeSync(fd, block); }
			catch (error) { if (error.code !== 'EPIPE') throw error; }
			finally { fs.closeSync(fd); }
		}
	`, input, frame.toString('hex')], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'inherit'],
	});
	let failed: Error | undefined;
	producer.once('error', (error) => { failed = error; });
	const closed = new Promise<void>((resolve) => { producer.once('close', () => resolve()); });
	return async () => {
		producer.kill('SIGTERM');
		await closed;
		if (failed) throw failed;
	};
}

export async function countAlsaFrames(path: string, channels: number, minimum: number,
                                     matches: (samples: Buffer, offset: number) => boolean): Promise<number> {
	const file = await open(path, 'r');
	try {
		const frameBytes = channels * 4;
		const samples = Buffer.alloc(16_384 * frameBytes);
		let found = 0;
		while (found < minimum) {
			const { bytesRead } = await file.read(samples);
			if (!bytesRead) break;
			for (let offset = 0; offset + frameBytes <= bytesRead; offset += frameBytes)
				if (matches(samples, offset)) found += 1;
		}
		return found;
	} finally {
		await file.close();
	}
}
