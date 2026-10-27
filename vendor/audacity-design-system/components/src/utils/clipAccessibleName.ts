import { COMPONENT_COPY, componentCopyTemplate, type ComponentCopy } from '../component-copy';
import { formatTimeForA11y } from './announce';

/** Authored timeline seconds may differ from the viewport's painted interval. */
export interface ClipAccessibleTiming {
	name: string;
	start: number;
	duration: number;
	timelineStartSeconds?: number;
	timelineDurationSeconds?: number;
}

export function clipAccessibleName(clip: ClipAccessibleTiming, copy: ComponentCopy = COMPONENT_COPY, locale = 'en'): string {
	const start = clip.timelineStartSeconds ?? clip.start;
	const duration = clip.timelineDurationSeconds ?? clip.duration;
	return componentCopyTemplate(copy.clipDescription, { name: clip.name, start: formatTimeForA11y(start, locale), duration: formatTimeForA11y(duration, locale) });
}
