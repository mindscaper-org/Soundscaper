/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { interchangePythonExecutable } from '../../scripts/lib/interchange-python.mjs';

/** Ask the maintained independent OTIO reader which exported picture is visible. */
export function referenceTopClipId(text: string, frame: number, rate: number): string {
	const referenceRoot = resolve(import.meta.dirname, '../../vendor/interchange-conformance');
	return execFileSync(interchangePythonExecutable({ referenceRoot }), ['-c', `
import sys, opentimelineio as otio
timeline = otio.adapters.read_from_string(sys.stdin.read(), "otio_json")
clip = otio.algorithms.top_clip_at_time(timeline.tracks, otio.opentime.RationalTime(float(sys.argv[1]), float(sys.argv[2])))
print(clip.metadata["media.kw.soundscaper"]["clipId"] if clip else "")
`, String(frame), String(rate)], { encoding: 'utf8', input: text,
		env: { ...process.env, PYTHONPATH: referenceRoot, PYTHONDONTWRITEBYTECODE: '1' } }).trim();
}
