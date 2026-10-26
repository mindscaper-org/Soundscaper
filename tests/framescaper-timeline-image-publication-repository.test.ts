/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	FramescaperTimelineImagePublicationRepositoryTimelineImage as Repository,
	FramescaperTimelineImagePublisherTimelineImage as Publisher,
} from '../src/framescaper/editor-timeline-image-publication-timeline-image.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, {} as never) as unknown as Data;
}

function port(): never {
	return { database: async () => null, memory: {} } as unknown as never;
}

function store(): never {
	return {
		beginMediaAssetWrite: async () => ({}),
		getMediaAssetMetadata: async () => null,
		deleteMediaAsset: async () => undefined,
	} as unknown as never;
}

test('a publication is a closed record of exactly its expected and next project', async () => {
	const repo = new Repository(PROFILE, port());
	const current = project();

	await assert.rejects(() => repo.publishIfCurrent({} as never), /unsupported, missing, or extra/u);
	await assert.rejects(
		() => repo.publishIfCurrent({ expected: current, project: current, extra: 1 } as never),
		/unsupported, missing, or extra/u,
	);
});

test('a publication must advance to exactly the next revision', async () => {
	const repo = new Repository(PROFILE, port());
	const current = project();

	await assert.rejects(
		() => repo.publishIfCurrent({ expected: current, project: current } as never),
		/must publish exactly the next revision/u,
	);
});

test('a publisher request is closed and must carry its staged body bytes', async () => {
	const publisher = new Publisher(PROFILE, { port: port(), store: store() } as never);
	const current = project();

	await assert.rejects(
		() => publisher.publishIfCurrent({} as never),
		/publication request has unsupported, missing/u,
	);
	await assert.rejects(
		() => publisher.publishIfCurrent({ expected: current, project: current } as never),
		/publication request has unsupported, missing/u,
	);
});
