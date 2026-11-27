// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
constexpr std::size_t maximumPoints = 4096;

te::AutomationCurve& curveFor(te::AudioTrack& track, TrackParameter key)
{
	const auto parameters = trackAutomationParameters(track);
	auto* parameter = parameters[key == TrackParameter::gainDb ? 0 : 1];
	if (!parameter) throw std::invalid_argument("This Tracktion track has no gain and pan automation");
	return parameter->getCurve();
}
}

std::array<te::AutomatableParameter*, 2> trackAutomationParameters(te::AudioTrack& track)
{
	if (auto* plugin = track.getVolumePlugin()) return {plugin->volParam.get(), plugin->panParam.get()};
	return {};
}

AutomationPage Session::trackAutomation(Revision expected, TrackId track, TrackParameter key, std::size_t offset, std::size_t limit) const
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto& curve = curveFor(s.track(track), key);
	const auto total = static_cast<std::size_t>(curve.getNumPoints());
	if (offset > total) throw std::invalid_argument("The Tracktion automation page is outside the curve");
	const auto count = std::min(total - offset, limit);
	AutomationPage result{total, {}};
	result.points.reserve(count);
	for (std::size_t i = offset; i < offset + count; ++i)
	{
		const auto point = static_cast<int>(i);
		const auto value = curve.getPointValue(point);
		result.points.push_back({tracktion::toSamples(curve.getPointTime(point), s.sampleRate),
		                         key == TrackParameter::gainDb ? te::volumeFaderPositionToDB(value) : value,
		                         curve.getPointCurve(point)});
	}
	return result;
}

std::size_t Session::setAutomationPoint(Revision expected, TrackId track, TrackParameter key,
                                        std::optional<std::size_t> index, AutomationPoint point)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto gain = key == TrackParameter::gainDb;
	if (!std::isfinite(point.value) || point.value < (gain ? -100.0f : -1.0f) || point.value > (gain ? 6.0f : 1.0f)
	    || !std::isfinite(point.curve) || point.curve < -1.0f || point.curve > 1.0f)
		throw std::invalid_argument("The Tracktion automation value or curve is out of range");
	const auto time = s.position(point.frame);
	auto& curve = curveFor(s.track(track), key);
	const auto count = static_cast<std::size_t>(curve.getNumPoints());
	if (index ? *index >= count : count >= maximumPoints)
		throw std::invalid_argument("The Tracktion automation point is outside the curve limits");
	const auto value = gain ? te::decibelsToVolumeFaderPosition(point.value) : point.value;
	const auto slot = index ? static_cast<int>(*index) : -1;
	const auto sameFrame = index && tracktion::toSamples(curve.getPointTime(slot), s.sampleRate) == point.frame;
	if (sameFrame && curve.getPointValue(slot) == value && curve.getPointCurve(slot) == point.curve) return *index;
	if (!sameFrame)
		for (int i = 0; i < curve.getNumPoints(); ++i)
			if (tracktion::toSamples(curve.getPointTime(i), s.sampleRate) == point.frame)
				throw std::invalid_argument("A Tracktion automation point already exists at this frame");

	s.begin(index ? "Update automation point" : "Add automation point");
	auto* undo = &s.edit->getUndoManager();
	auto pointIndex = slot;
	if (sameFrame)
	{
		curve.setPointValue(slot, value, undo);
		curve.setCurveValue(slot, point.curve, undo);
	}
	else
	{
		if (index) curve.removePoint(slot, undo);
		pointIndex = curve.addPoint(te::EditPosition(time), value, point.curve, undo);
	}
	s.commit();
	return static_cast<std::size_t>(pointIndex);
}

void Session::removeAutomationPoint(Revision expected, TrackId track, TrackParameter key, std::size_t index)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& curve = curveFor(s.track(track), key);
	if (index >= static_cast<std::size_t>(curve.getNumPoints()))
		throw std::invalid_argument("The Tracktion automation point is outside the curve");
	s.begin("Remove automation point");
	curve.removePoint(static_cast<int>(index), &s.edit->getUndoManager());
	s.commit();
}

void Session::clearAutomation(Revision expected, TrackId track, TrackParameter key)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& curve = curveFor(s.track(track), key);
	if (curve.getNumPoints() == 0) return;
	s.begin("Clear automation");
	curve.clear(&s.edit->getUndoManager());
	s.commit();
}
}
