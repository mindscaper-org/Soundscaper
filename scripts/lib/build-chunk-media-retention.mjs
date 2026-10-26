/* SPDX-License-Identifier: AGPL-3.0-only */

// Shared storage interprets source roots, publication budgets and writer leases.
// Keep their contracts apart from project construction and timeline/effects;
// importing media custody must not instantiate an editor product.
/** @type {import('rolldown').CodeSplittingGroup[]} */
export const mediaRetentionChunkGroups = [{
	// Retention and both scalar resource facades share their exact extracted
	// custody kernel; no product, body reader or render authority is opened.
	name: 'editor-media-storage-contracts',
	test: /src[\\/]common[\\/]editor[\\/](?:(?:retention|project-lock)\.js|(?:project-schema-version|publication-byte-estimates|take-group-source-references|cube-lut-reference-contract|video-cube-lut-(?:profile-v1|project-references-(?:v1|current-v1))|video-source-characteristics|sequence-timecode|waveform-peak-contract|video-timing-asset-reference)\.ts|internal[\\/]video-cube-lut-project-references-kernel-v1\.ts)$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// Original custody, byte publication and disposable derivatives borrow the
	// same generic repositories. Keep their exact storage closure separate from
	// linked audio/video readers and project/revision persistence.
	name: 'editor-media-custody-storage',
	test: /src[\\/]common[\\/]editor[\\/]storage[\\/](?:binary-(?:copy|derivative-cache-(?:pairs|records|repository))|derivative-cache-(?:entry|inventory|policy)|indexeddb-(?:backend|schema)|key-value-(?:canonical-comparison|repository)|linked-original-(?:binding|provisional-root-schema|schema)|linked-video-original-binding|media-asset-(?:binary-inspection|blob-stream|chunk-(?:records|schema)|cleanup-error|disposal-repository|lifecycle-coordinator|load-repository|opfs-startup-(?:namespace|reconciliation)|owned-publication|path-staging|staged-sink|staging-(?:repository|schema)|write-(?:admission|publication|repository))|media-binary-reference-query|media-catalog-original-(?:inspection-repository|records|repair-(?:contract|publication|repository)|repository|schema)|media-content-(?:digest|provenance)|media-(?:records|repository)|memory-backend|opfs-(?:binary-inspection|blob-write-plan|pcm-(?:read-view|writer-lifecycle)|repository|sync-(?:repository-bridge|worker-client|worker-protocol|writer-adapters))|project-(?:storage-profile|store-defaults)|retention-session-guard|status|storage-(?:clone|record-projection)|video-derivative-(?:payload|relationship|repository)|video-proxy-(?:claim-(?:repository|staging-record)|cleanup-tombstone(?:-schema)?))\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];
