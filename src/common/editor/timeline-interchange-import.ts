/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseAdlDocument } from './aes31-import.ts';
import { parseEdlTimeline } from './timeline-interchange-edl-import.ts';
import { parseOtioTimeline } from './timeline-interchange-otio-import.ts';
import { parseFcpxmlTimeline } from './timeline-interchange-fcpxml-import.ts';
import { parseArdourDocument } from './ardour-import.ts';
import { parseSoundcraftDocument } from './soundcraft-import.ts';
import { parseHindenburgDocument } from './hindenburg-import.ts';
import { TIMELINE_INTERCHANGE_MAXIMUM_BYTES, type TimelineInterchangeDocument } from './timeline-interchange-types.ts';
import type { Rational } from './timeline-time.ts';

export function parseTimelineInterchange(fileName: string, text: string,
	options: Readonly<{ edlRate?: Rational }> = {}): TimelineInterchangeDocument {
	if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > TIMELINE_INTERCHANGE_MAXIMUM_BYTES) {
		throw new RangeError('The timeline interchange document exceeds the text byte limit.');
	}
	if (/\.adl$/iu.test(fileName)) return parseAdlDocument(text);
	if (/\.edl$/iu.test(fileName)) return parseEdlTimeline(text, options.edlRate);
	if (/\.otio$/iu.test(fileName)) return parseOtioTimeline(text);
	if (/\.ardour$/iu.test(fileName)) return parseArdourDocument(text);
	if (/\.scraft$/iu.test(fileName)) return parseSoundcraftDocument(text);
	if (/\.nhsx$/iu.test(fileName)) return parseHindenburgDocument(text);
	if (/\.(?:fcpxml|xml)$/iu.test(fileName)) return parseFcpxmlTimeline(text);
	throw new TypeError('An EDL, OTIO, FCPXML, Ardour, SoundCraft or Hindenburg filename is required.');
}
