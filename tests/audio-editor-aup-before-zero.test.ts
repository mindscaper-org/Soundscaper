/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAup3Fixture } from './aup3-fixture.js';
import { SQL } from './helpers/aup4-database-harness.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { prepareAudacitySerializedDatabase, readAup4SampleBlock, upgradeAudacityProjectDatabase } from '../src/common/editor/aup4-database.js';
import { streamAup4SourceAudio } from '../src/common/editor/aup4-import-audio.ts';
import { readAup4ImportSamples } from '../src/common/editor/aup4-import-sample-reader.ts';
import type { Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

for (const planAudio of [false, true]) test(`saved Audacity audio wholly before zero remains in Project Bin (streamed ${String(planAudio)})`, async () => {
	const samples = [0.25, -0.5, 0.75, 0];
	const bytes = await createAup3Fixture({ SQL, tracks: [{ name: 'Hidden take', clips: [{ offset: -1, samples }] }] });
	const database = new SQL.Database(prepareAudacitySerializedDatabase(bytes));
	try {
		const validation = upgradeAudacityProjectDatabase(database).validation;
		assert.equal(database.exec('SELECT length(samples) FROM sampleblocks')[0]?.values[0]?.[0], 16);
		let sequence = 0;
		const decoded = await decodeAudacityProjectTree(validation.document.root, (block: number) => readAup4SampleBlock(database, block), {
			sourceGeneration: 'aup3', planAudio, idFactory: (prefix: string) => `${prefix}-${++sequence}`,
		});
		assert.ok(validateAudioEditorProjectV17(decoded.project));
		assert.equal(decoded.project.clips.length, 0);
		assert.equal(decoded.project.projectBin.clips.length, 1);
		assert.equal(decoded.project.sources.length, 1);
		assert.equal(decoded.sources.length, 1);
		const clip = decoded.project.projectBin.clips[0]!;
		assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames], [0, 0, 4, 4]);
		assert.ok(decoded.warnings.some((warning: string) => /before time zero.*Project Bin/u.test(warning)));
		if (planAudio) {
			const source = decoded.sources[0] as Aup4ImportSourcePlan;
			const actual: number[] = [];
			for await (const chunk of streamAup4SourceAudio(source, (block, offset, frames) => readAup4ImportSamples(database, block, offset, frames))) {
				actual.push(...chunk[0]!);
			}
			assert.deepEqual(actual, samples);
		} else {
			const channel = decoded.sources[0]?.channels?.[0];
			assert.ok(channel);
			assert.deepEqual([...channel], samples);
		}
	} finally { database.close(); }
});
