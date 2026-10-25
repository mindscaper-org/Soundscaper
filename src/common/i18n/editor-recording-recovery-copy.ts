/* SPDX-License-Identifier: AGPL-3.0-only */
export const RECORDING_RECOVERY_COPY = Object.freeze({
	ordinaryRecoveryTitle: 'Interrupted recording',
	ordinaryRecoveryTrack: 'Recovered recording',
	ordinaryRecoveryMenu: 'Resolve interrupted recording',
	ordinaryRecoveryDescription: 'This recording was interrupted before it finished saving. Recover the saved audio checkpoints into their original tracks, or discard this interrupted recording.',
	ordinaryRecoverySummary: '{count} recording tracks contain {checkpoints} saved audio checkpoints.',
	ordinaryRecoveryRecover: 'Recover recording',
	ordinaryRecoveryDiscard: 'Discard recording',
	ordinaryRecoveryWorking: 'Resolving interrupted recording',
	ordinaryRecoveryCloseHint: 'Closing this dialog keeps the saved audio. Editing remains blocked until you recover or discard the recording.',
	ordinaryRecoveryLossHint: 'The last unfinished checkpoint may be missing (about 10 seconds, plus audio waiting to be saved).',
	ordinaryRecoveryRecoveredWithLoss: '{count} unavailable final recording checkpoints were omitted; all earlier checkpoints were recovered.',
});
