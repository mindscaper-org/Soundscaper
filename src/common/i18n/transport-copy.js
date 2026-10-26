/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy for the transport: playback and record commands, the loop region, and the metronome's tempo and time signature. */
export const TRANSPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
			transport: 'Playback and recording',
			jumpStart: 'Jump to project start',
			play: 'Play',
			pause: 'Pause',
			resumePlayback: 'Resume playback',
			playCutPreview: 'Cut preview',
			playSpectralSelection: 'Play selected frequencies',
			spectralSelectionRequired: 'Select a frequency range first.',
			playStopSetCursor: 'Play/Stop and set cursor',
			stop: 'Stop',
			jumpEnd: 'Jump to project end',
			loop: 'Loop selection',
			clearLoopRegion: 'Clear loop region',
			loopToSelection: 'Set loop region to selection',
			selectionToLoop: 'Set selection to loop region',
			selectionFollowsLoop: 'Creating a loop also selects audio',
			setLoopInOut: 'Set loop from cursor to end',
			metronome: 'Metronome',
			projectTempo: 'Project tempo (BPM)',
			timeSignature: 'Time signature',
			numerator: 'numerator',
			denominator: 'denominator',
			record: 'Record onto the armed track',
			recordActiveTrack: 'Record onto the active track',
			monitor: 'Monitor input',
	}),
});
