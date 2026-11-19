/* SPDX-License-Identifier: AGPL-3.0-only */

export const CHAINED_AUDIO_MESSAGE = 'This Ogg file contains chained audio recordings. Split it into individual recordings before importing to avoid losing later audio.';

export class ChainedOpusAudioError extends Error {
	constructor() { super(CHAINED_AUDIO_MESSAGE); }
}
