/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { importVideoCaptionTrackV1, exportVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const clock = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;

test('real imported voiced WebVTT exports share immutable speaker and style inventories', () => {
	const cues = 1000, speakers = 128;
	const text = 'WEBVTT\n\n' + Array.from({ length: cues }, (_, index) => `cue-${index}\n${clock(index * 2)} --> ${clock(index * 2 + 1)}\n<v Speaker ${Math.min(index, speakers - 1)}><b>Caption ${index}</b></v>`).join('\n\n') + '\n';
	const { track } = importVideoCaptionTrackV1(text, { format: 'webvtt', sampleRate: 48_000,
		trackId: 'captions', sequenceId: 'sequence', trackName: 'Captions', language: 'en' });
	assert.equal(track.speakers.length, speakers);
	const find = Array.prototype.find;
	let visits = 0;
	Array.prototype.find = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		if (!new Error().stack?.includes('exportWebVttCue')) return find.call(this, predicate, receiver);
		return find.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
	};
	try {
		const result = exportVideoCaptionTrackV1(track, { format: 'webvtt', sampleRate: 48_000 });
		assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), 'a565bc3f265f535f48a9a998677b57120f01ad7cc33e1d7a3622a8acd38e3c76');
		assert.ok(visits <= speakers + 1, `${visits} speaker/style definition predicates`);
	} finally { Array.prototype.find = find; }
});
