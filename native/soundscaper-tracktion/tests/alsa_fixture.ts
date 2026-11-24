/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';

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

export async function writeAlsaCaptureFixture(config: string, input: string): Promise<void> {
	const pcm = Buffer.alloc(8 * 1024 * 1024);
	const sample = Buffer.alloc(4);
	sample.writeFloatLE(0.25);
	pcm.fill(sample);
	await writeFile(input, pcm);
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
}

export async function writeAlsaRoutingFixture(config: string, input: string, output: string): Promise<void> {
	const pcm = Buffer.alloc(8 * 1024 * 1024);
	const frame = Buffer.alloc(8);
	frame.writeFloatLE(0.125);
	frame.writeFloatLE(0.375, 4);
	pcm.fill(frame);
	await writeFile(input, pcm);
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
}
