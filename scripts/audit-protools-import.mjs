/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseProToolsDocument } from '../src/common/editor/protools-import.ts';
import { multiplyRationals } from '../src/common/editor/timeline-time.ts';

const REVISION = 'af15ee90825f59b84b9977591862cce96bb1d781';
const BASE = `https://raw.githubusercontent.com/zamaudio/ptformat/${REVISION}/`;
const sourcePins = [
	['ptformat.cc', '4b229d4da2a4289785adee02590bae1c63fda938b1b91a592377c5e1a88f81eb'],
	['ptformat/ptformat.h', '38fd94259f86fd8ecc4a13b23c8b5c88e273253af3367f68a5a1528dce17db0d'],
	['ptformat/visibility.h', '02a3007b9684ddec29bacd319d37a49fe7f7707106249c0b47787c878f89de04'],
	['COPYING.LESSER', 'dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551'],
];
const sessions = [
	['Damien_monos.pts', '796e5473a10d3c8ffdf77a11052f359d84745839e2c311d49c33b97e09eb6328', 48000, 8],
	['Fa_16_48.pts', '624f7ef862abab428197fd2947a3ef9981bddaeb9bc6e3777abad26b68a6e65c', 48000, 14],
	['RegionTest.ptx', 'cdcd8c1f7fff055ae6bbd518cb4b986f912ca31a6ee4e4f388137323391b9ddf', 44100, 6],
	['TestMXF.ptx', '0239778f4d6f3f71286559d5042a0056045c5c2aa979103eb0e485839a6d8163', 48000, 1],
	['TestPTX.ptx', 'cea0b0bb5024fca1ecbe6e354d4ebac8ab1316da37b6911c319306ebca0d3df4', 48000, 3],
	['forArdour.pts', 'd8dd57de0280f2ca187f457afaa7ab7d7c0c5d9f3de3796e6cd8b28c42eed2eb', 48000, 6],
	['goodplaylists2.ptf', '4418829d6572988c36360cfda8b5a3b5db3bdc3e0d1fd69e5b926cdc9f33f055', 48000, 13],
	['midi345x.ptf', '4b4fd53d31711e42d4700ee9042177aee5b61c1242ae1dca0e59bfd9cd7dbb4c', 48000, 0],
];
const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'protools-reference-'));
try {
	const bytesByPath = new Map();
	const downloads = await Promise.allSettled([...sourcePins, ...sessions.map(([name, digest]) => [`bins/${name}`, digest])]
		.map(async ([path, digest]) => {
			const response = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
			if (!response.ok) throw new Error(`Reference download failed: ${path} (${response.status}).`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, path);
			bytesByPath.set(path, bytes);
			await mkdir(dirname(join(directory, path)), { recursive: true });
			await writeFile(join(directory, path), bytes);
		}));
	for (const result of downloads) if (result.status === 'rejected') throw result.reason;
	const probe = join(directory, 'probe.cc'), executable = join(directory, process.platform === 'win32' ? 'probe.exe' : 'probe');
	await writeFile(probe, String.raw`
#include "ptformat/ptformat.h"
#include <iostream>
#include <string>
int main(int argc, char** argv) {
 if(argc!=3) return 2;
 PTFFormat session;
 if(session.load(argv[1], std::stoll(argv[2]))) return 3;
 std::cout << session.sessionrate() << '\n';
 for(auto const& track: session.tracks()) {
  auto const& clip=track.reg;
  std::cout << clip.wave.index << '\t' << clip.startpos << '\t' << clip.sampleoffset << '\t' << clip.length << '\n';
 }
}
`);
	await execute(process.env.CXX || 'c++', ['-std=c++11', '-O1', '-I', directory, join(directory, 'ptformat.cc'), probe, '-o', executable], { timeout: 30000 });
	let clips = 0;
	for (const [name, , sampleRate, expectedCount] of sessions) {
		const document = parseProToolsDocument(bytesByPath.get(`bins/${name}`), { fileName: name });
		assert.equal(document.sampleRate, sampleRate, name);
		const toSamples = value => {
			const result = multiplyRationals(value, sampleRate);
			assert.equal(result.den, 1, name);
			return result.num;
		};
		const actual = document.tracks.flatMap(track => track.clips.map(clip => [
			Number(clip.mediaId.slice('source:'.length)), toSamples(clip.start), toSamples(clip.sourceStart), toSamples(clip.duration),
		].join('\t'))).sort();
		assert.equal(actual.length, expectedCount, name);
		const { stdout } = await execute(executable, [join(directory, 'bins', name), String(sampleRate)], { timeout: 10000 });
		const [rate, ...expected] = stdout.trim().split(/\r?\n/u);
		assert.equal(Number(rate), sampleRate, name);
		assert.deepEqual(actual, expected.sort(), name);
		clips += actual.length;
		console.log(`${name}: ${actual.length} audio cuts agree with pinned libptformat.`);
	}
	console.log(`Pro Tools import audit passed: ${sessions.length} sessions, ${clips} placed audio cuts.`);
} finally { await rm(directory, { recursive: true, force: true }); }
