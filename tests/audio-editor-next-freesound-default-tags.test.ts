/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundImportService } from '../src/common/editor/controller/import/freesound-import-service.ts';
import { mergeSourceProvenance, normalizeSourceProvenance, type SourceProvenanceV1 } from '../src/common/editor/source-provenance.ts';
import { createFreesoundUploadQueue } from '../src/common/editor/ui/workspace/freesound-upload-queue.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { waitFor } from './helpers/async-test-control.ts';

for (const kind of ['combined-budget', 'Unicode-tag'] as const) {
	test(`an imported Freesound clip's ${kind} default tags can be published unchanged`, async () => {
		const bytes = encodeWav([Float32Array.of(0, 0.25, -0.25)], { sampleRate: 48_000, bitDepth: 16, dither: false });
		const file = new File([Uint8Array.from(bytes).buffer], 'joined.wav', { type: 'audio/wav' });
		const contributions: SourceProvenanceV1[] = [];
		const tagsFor = (id: number) => kind === 'combined-budget'
			? Array.from({ length: 8 }, (_, index) => `${String(id)}-${String(index)}-${'ambience'.repeat(4)}`)
			: ['𐐀'.repeat(40), 'outdoors', 'recording'];
		const importer = createFreesoundImportService({ enabled: true, authenticated: true,
			apiBaseUrl: 'https://soundscaper.org', createContributionId: () => `sound-${String(contributions.length)}`,
			importFile: async (_file, options) => { contributions.push(normalizeSourceProvenance(options.sourceProvenance)); },
			fetch: async input => {
				const url = new URL(String(input));
				if (url.pathname.endsWith('/original')) return new Response(Uint8Array.from(bytes).buffer, { headers: { 'Content-Type': 'audio/wav' } });
				const id = Number(url.pathname.split('/').at(-1));
				return Response.json({ data: {
					id, name: `Recording ${String(id)}.wav`, pageUrl: `https://freesound.org/s/${String(id)}/`,
					creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' },
					description: 'Outdoor recording.', tags: tagsFor(id), category: 'Soundscapes', subcategory: 'Nature',
					createdAt: '2026-04-16T20:07:11.145', generativeAiPreference: null, explicit: false, durationSeconds: 3 / 48_000,
					license: { code: 'cc-by', name: 'Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/',
						requiresAttribution: true, commercialUseAllowed: true },
					originalFile: { format: 'wav', channels: 1, byteLength: bytes.length, sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
					statistics: { downloads: 1, averageRating: 4, ratingCount: 1 },
					preview: { available: false, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
					waveform: { available: false, url: null },
				} });
			},
		});
		for (const soundId of [42, 43]) await importer.importSound({ soundId, variant: 'original', destination: 'timeline' });
		const provenance = mergeSourceProvenance(contributions);
		let described = 0;
		const queue = createFreesoundUploadQueue({ upload: async () => ({ uploadFilename: file.name }),
			materializeClip: async () => ({ file, clipTitle: 'Joined recording', source: { provenance, name: file.name, sampleRate: 48_000, channelCount: 1, frameCount: 3 }, clip: { title: 'Joined recording' } }),
			describe: async request => {
				described += 1;
				assert.ok(request.tags.every(tag => tag.length <= 64));
				assert.ok(request.tags.join(' ').length <= 512);
				request.tags.forEach(tag => assert.doesNotMatch(tag, /[\uD800-\uDFFF]/u));
				return { status: 'pending_moderation' };
			},
		});
		const id = queue.enqueueClip({ projectId: 'joined-project', clipId: 'joined-clip' });
		await waitFor(() => queue.getSnapshot().items[0]?.status === 'ready-to-publish', 'clip upload ready');
		const item = queue.getSnapshot().items[0]; assert.ok(item);
		await queue.publish(id, { title: item.title, description: item.description, tags: item.tags,
			categoryId: 'ss-n', license: 'cc-by' });
		assert.equal(described, 1);
		assert.equal(queue.getSnapshot().items[0]?.status, 'submitted');
	});
}
