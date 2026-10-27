/* SPDX-License-Identifier: AGPL-3.0-only */

const ENGLISH = Object.freeze({
	automationGroupRouting: 'Routing',
	automationAssignmentTarget: 'Assignment to {destination}',
	automationSendTarget: 'Send to {destination}',
	automationRoute: 'Route',
	automationParameterUnavailable: 'Automation is unavailable for this parameter.',
	automationMultichannelPanUnavailable: 'Pan is unavailable while preserving multichannel or ADM channels.',
	automationElementParameter: '{element} · {parameter}',
	automation: 'automation',
	addAutomation: 'Add automation',
	automationParameter: 'Automation parameter',
	automationMode: 'Automation mode',
	automationRead: 'Read',
	automationTrim: 'Trim',
	automationTouch: 'Touch',
	automationLatch: 'Latch',
	automationWrite: 'Write',
	automationInsertPoint: 'Insert automation point',
	automationCurveMenu: 'Automation curve',
	automationDeleteLane: 'Delete automation lane',
	automationSegmentHold: 'Hold',
	automationSegmentLinear: 'Linear',
	automationSegmentEased: 'Eased',
	automationSegmentBezier: 'Bézier',
	automationFirstBezierControl: 'first Bézier control',
	automationSecondBezierControl: 'second Bézier control',
});

export const TRACK_AUTOMATION_COPY_BY_LOCALE = Object.freeze({ en: ENGLISH });
