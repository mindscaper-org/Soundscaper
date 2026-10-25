/**
 * Copy for delivery: what is delivered, in what form, and what the queue did.
 *
 * The range and output vocabulary lives here with the batch that reuses it,
 * because a batch target and an export range are the same choice offered twice
 * and they must not read differently in the two places.
 *
 * One entry per key with both locales beside each other, so a translation can
 * never drift into a different position from the string it translates — the
 * catalogs assert that both locales carry exactly the same keys.
 */
const DELIVERY_QUEUE_COPY_ENTRIES = Object.freeze([
	['exportMode', 'Output'],
	['mix', 'Stereo mix'],
	['stems', 'Individual stems (archive)'],
	['exportRange', 'Range'],
	['entireProject', 'Entire project'],
	['currentSelection', 'Current selection'],
	['loopRegion', 'Loop region'],
	['deliveryQueue', 'Delivery queue'],
	['deliveryQueueEmpty', 'Nothing is queued.'],
	['deliveryQueuePause', 'Pause between jobs'],
	['deliveryQueueResume', 'Resume'],
	['deliveryQueueCancelJob', 'Cancel'],
	['deliveryQueueRetryJob', 'Retry'],
	['deliveryQueueProjectChanged', 'Reopen the original project before retrying this delivery.'],
	['deliveryQueueSelectDestination', 'Choose destination'],
	['deliveryQueueReauthorizeDestination', 'Reauthorize destination'],
	['deliveryQueueMoveEarlier', 'Move earlier'],
	['deliveryQueueMoveLater', 'Move later'],
	['deliveryQueueShowReport', 'View report'],
	['deliveryQueueReport', 'Persisted delivery report'],
	['deliveryQueueProgress', '{percent}% complete'],
	['deliveryQueueStateQueued', 'Queued'],
	['deliveryQueueStateRunning', 'Running'],
	['deliveryQueueStateWaitingForProject', 'Waiting for the exact saved project'],
	['deliveryQueueStateNeedsAuthorization', 'Destination authorization required'],
	['deliveryQueueStateStale', 'Stale project or plan'],
	['deliveryQueueStateCompleted', 'Delivered'],
	['deliveryQueueStateFailed', 'Failed'],
	['deliveryQueueStateCancelled', 'Cancelled'],
	['deliveryBatch', 'Batch delivery'],
	['deliveryBatchTargets', 'Deliver'],
	['deliveryBatchFormats', 'Formats'],
	['deliveryBatchQueue', 'Queue batch'],
	['deliveryBatchRetryFailures', 'Retry what did not deliver'],
	['deliveryBatchQueued', '{members} deliveries queued.'],
	['deliveryBatchNoFormats', 'Save a delivery preset to queue a batch.'],
	['deliveryBatchNoTargets', 'Choose at least one thing to deliver.'],
	['deliveryPresetStemsUnsupported', 'A BW64 / ADM programme cannot be delivered as stems.'],
	[
		'deliveryBatchSummary',
		'{delivered} delivered, {failed} failed, {cancelled} cancelled, {notStarted} not started.',
	],
	['deliveryTargetNoSelection', 'Make a selection to deliver it.'],
	['deliveryTargetNoLoop', 'Enable the loop to deliver it.'],
	[
		'deliveryTargetSequenceUndeliverable',
		'Resolve the sequence issues to deliver it.',
	],
	[
		'deliveryTargetStemsUnsupported',
		'A mastering sequence cannot be delivered as stems.',
	],
	// The export dialog asks what is delivered once, so its options name both the
	// form and the span in the same words. The queue still asks the two questions
	// separately and keeps the vocabulary above.
	['exportOutputStems', 'Individual stems (split by tracks)'],
	['exportOutputClips', 'Individual clips (split by clips)'],
	['exportOutputClipsFrozen', 'Unfreeze audio tracks before exporting individual clips.'],
	['exportOutputChapters', 'Chapters (split by labels)'],
	['exportOutputMarkerChapters', 'Chapters (split by markers)'],
	['exportOutputLoop', 'In/Out (looping region)'],
	['exportOutputNoLabels', 'Add labels or markers to split the export into chapters.'],
]);

export const DELIVERY_QUEUE_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(DELIVERY_QUEUE_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
