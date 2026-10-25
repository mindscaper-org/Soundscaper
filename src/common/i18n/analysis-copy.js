/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy for the Analyze menu: the spectrum plot, clipping and contrast reports, and beat finding. */
export const ANALYSIS_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze({
			analysis: 'Analysis',
			analysisCommand: 'Analysis',
			analysisDialog: 'Analysis',
			analyzeSelection: 'Analyze selection',
			repeatLastAnalyzer: 'Repeat last analyzer',
			plotSpectrum: 'Plot spectrum',
			spectrumSelectionTooShort: 'Plot spectrum requires at least {samples} samples. Select a longer audio range.',
			findClipping: 'Find clipping',
			contrast: 'Contrast',
			contrastSelectionInstructions: 'Select and measure the foreground, then select and measure the background.',
			spectrumPeak: 'Peak frequency',
			spectrumPeakDetail: '{label}: {frequency} Hz · {level}',
			spectrumConfiguration: '{size} FFT · {sampleRate} Hz',
			clippingRegions: '{count} clipping regions',
			clippingRegionDetail: '{start}–{end} s · {peak}',
			noClippingRegions: 'No clipping regions found.',
			captureContrastForeground: 'Measure foreground',
			captureContrastBackground: 'Measure background',
			contrastForeground: 'Foreground RMS',
			contrastBackground: 'Background RMS',
			contrastDifference: 'Difference',
			contrastPass: 'Contrast meets the recommended 20 dB difference.',
			contrastFail: 'Contrast is below the recommended 20 dB difference.',
			beatFinder: 'Beat finder',
			analyzeTrack: 'Analyze track',
			analyzeMaster: 'Analyze master',
	}),
});
