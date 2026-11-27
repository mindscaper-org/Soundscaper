// SPDX-License-Identifier: AGPL-3.0-only

#include "peer_commands.h"
#include "session.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <initializer_list>
#include <limits>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
constexpr auto pageSize = 32u;
constexpr auto maxJsInteger = 9007199254740991ll;
using Fields = std::initializer_list<std::pair<const char*, juce::var>>;

juce::var record(Fields fields)
{
	auto result = std::make_unique<juce::DynamicObject>();
	for (const auto& [key, value] : fields)
		result->setProperty(key, value);
	return juce::var(result.release());
}

juce::var number(std::int64_t value)
{
	return juce::var(static_cast<juce::int64>(value));
}

void requireFields(const juce::DynamicObject& request, std::initializer_list<const char*> fields)
{
	if (request.getProperties().size() != static_cast<int>(fields.size() + 1))
		throw std::invalid_argument("The Tracktion command has an unexpected shape");
	for (const auto* field : fields)
		if (!request.hasProperty(field))
			throw std::invalid_argument("The Tracktion command is missing a field");
}

std::int64_t boundedInteger(const juce::DynamicObject& request, const char* field)
{
	const auto& value = request.getProperty(field);
	const auto parsed = static_cast<juce::int64>(value);
	if ((!value.isInt() && !value.isInt64()) || parsed < 0 || parsed > maxJsInteger)
		throw std::invalid_argument("The Tracktion command requires a nonnegative safe integer");
	return parsed;
}

size_t arrayIndex(const juce::DynamicObject& request, const char* field)
{
	const auto index = static_cast<std::uint64_t>(boundedInteger(request, field));
	if (index > std::numeric_limits<size_t>::max())
		throw std::invalid_argument("The Tracktion index is out of range");
	return static_cast<size_t>(index);
}

float mixerValue(const juce::DynamicObject& request, const char* field, double low, double high)
{
	const auto& value = request.getProperty(field);
	const auto number = static_cast<double>(value);
	if ((!value.isDouble() && !value.isInt() && !value.isInt64()) || !std::isfinite(number) || number < low || number > high)
		throw std::invalid_argument("The Tracktion mixer value is out of range");
	return static_cast<float>(number);
}

juce::String text(const juce::DynamicObject& request, const char* field, int maxBytes)
{
	const auto& value = request.getProperty(field);
	const auto parsed = value.toString();
	if (!value.isString() || parsed.isEmpty() || parsed.getNumBytesAsUTF8() > static_cast<size_t>(maxBytes))
		throw std::invalid_argument("The Tracktion command contains invalid text");
	return parsed;
}

TrackParameter trackParameter(const juce::DynamicObject& request)
{
	const auto parameter = text(request, "parameter", 6);
	if (parameter == "gainDb") return TrackParameter::gainDb;
	if (parameter == "pan") return TrackParameter::pan;
	throw std::invalid_argument("The Tracktion automation parameter is unsupported");
}

#if ! JUCE_WASM
std::string deviceId(const juce::DynamicObject& request, const char* field, bool defaultAllowed = false)
{
	const auto& value = request.getProperty(field);
	const auto id = value.toString();
	if (!value.isString() || (!(id.isEmpty() && defaultAllowed) && (id.length() != 16 || !id.containsOnly("0123456789abcdef"))))
		throw std::invalid_argument("The Tracktion audio device handle is invalid");
	return id.toStdString();
}

int audioNumber(const juce::DynamicObject& request, const char* field, int limit)
{
	const auto value = boundedInteger(request, field);
	if (value > limit) throw std::invalid_argument("The Tracktion audio setting is out of range");
	return static_cast<int>(value);
}

juce::var deviceChoices(const std::vector<DeviceChoice>& choices)
{
	juce::Array<juce::var> result;
	for (const auto& item : choices)
		result.add(record({{"id", juce::String(item.id)}, {"name", juce::String(item.name)}}));
	return juce::var(result);
}

juce::var appliedAudioSetup(const AppliedAudioSetup& entry)
{
	const auto& setup = entry.setup;
	return record({
		{"setup", record({
			{"hostId", juce::String(setup.hostId)}, {"inputId", juce::String(setup.inputId)}, {"outputId", juce::String(setup.outputId)},
			{"inputChannel", setup.inputChannel}, {"outputChannel", setup.outputChannel},
			{"sampleRate", setup.sampleRate}, {"blockSize", setup.blockSize},
		})},
		{"actualSampleRate", entry.actualSampleRate}, {"actualBlockSize", entry.actualBlockSize},
	});
}
#endif

std::uint64_t itemId(const juce::DynamicObject& request, const char* field)
{
	const auto value = text(request, field, 20).toStdString();
	std::uint64_t id = 0;
	const auto end = value.data() + value.size();
	const auto parsed = std::from_chars(value.data(), end, id);
	if (parsed.ec != std::errc() || parsed.ptr != end || id == 0 || value.front() == '0')
		throw std::invalid_argument("The Tracktion command contains an invalid item ID");
	return id;
}

juce::File exchangeFile(const juce::File& exchange, const juce::DynamicObject& request,
                        const char* direction, const char* extension)
{
	const auto name = text(request, "asset", 32);
	if (name.length() != 32 || !name.containsOnly("0123456789abcdef"))
		throw std::invalid_argument("The Tracktion asset handle is invalid");
	const auto directory = exchange.getChildFile(direction);
	if (!directory.isDirectory() || directory.isSymbolicLink() || exchange.isSymbolicLink())
		throw std::runtime_error("The Tracktion exchange directory is unavailable");
	const auto file = directory.getChildFile(name + extension);
	if (file.isSymbolicLink())
		throw std::invalid_argument("The Tracktion asset handle names a symbolic link");
	return file;
}

juce::var pageCursor(size_t end, size_t total)
{
	return end < total ? number(static_cast<std::int64_t>(end)) : juce::var();
}

juce::var projectPageReply(const ProjectPage& project, size_t offset)
{
	juce::Array<juce::var> tracks;
	for (const auto& track : project.tracks)
		tracks.add(record({
			{"id", juce::String(std::to_string(track.id))},
			{"name", juce::String(track.name).substring(0, 128)},
			{"clipCount", number(static_cast<std::int64_t>(track.clipCount))},
		}));
	return record({
		{"revision", number(project.revision)}, {"sampleRate", project.sampleRate},
		{"canUndo", project.canUndo}, {"canRedo", project.canRedo},
		{"tracks", juce::var(tracks)}, {"nextOffset", pageCursor(offset + project.tracks.size(), project.total)},
	});
}

juce::var clipPageReply(const ClipPage& page, Revision revision, size_t offset)
{
	juce::Array<juce::var> clips;
	for (const auto& clip : page.clips)
		clips.add(record({
			{"id", juce::String(std::to_string(clip.id))},
			{"name", juce::String(clip.name).substring(0, 128)},
			{"start", number(clip.start)}, {"end", number(clip.end)}, {"sourceOffset", number(clip.sourceOffset)},
		}));
	return record({
		{"revision", number(revision)}, {"clips", juce::var(clips)}, {"nextOffset", pageCursor(offset + page.clips.size(), page.total)},
	});
}

juce::var transportObservation(Session& session)
{
	auto view = record({
		{"playing", session.isPlaying()}, {"recording", session.isRecording()},
		{"frame", number(std::max(Frame{}, session.playbackPosition()))},
	});
	if (session.outputInterrupted()) view.getDynamicObject()->setProperty("outputInterrupted", true);
	if (const auto take = session.interruptedTake())
		view.getDynamicObject()->setProperty("interruptedTake", record({
			{"revision", number(take->revision)},
			{"itemId", take->item ? juce::var(juce::String(std::to_string(*take->item))) : juce::var{}},
		}));
	return view;
}

juce::var transportView(Session& session)
{
	const auto ready = session.playbackReady();
	auto view = transportObservation(session);
	view.getDynamicObject()->setProperty("ready", ready);
	return view;
}
}

juce::var dispatch(Session& session, const juce::File& exchange, const juce::File& clipboard, const juce::var& value,
                   OfflineEffectHost* effects)
{
	const auto* payload = value.getDynamicObject();
	if (payload == nullptr)
		throw std::invalid_argument("The Tracktion command must be an object");
	const auto& request = *payload;
	const auto kind = text(request, "kind", 24);
	const auto integer = [&request](const char* field) { return boundedInteger(request, field); };
#if ! JUCE_WASM
	if (kind == "transportObservation")
	{
		requireFields(request, {});
		return transportObservation(session);
	}
	if (kind == "audioHosts")
	{
		requireFields(request, {});
		const auto view = session.audioHosts();
		return record({{"hosts", deviceChoices(view.hosts)}, {"selected", view.selected ? appliedAudioSetup(*view.selected) : juce::var{}}});
	}
	if (kind == "audioDevices")
	{
		requireFields(request, {"hostId"});
		const auto view = session.audioDevices(deviceId(request, "hostId"));
		return record({{"inputs", deviceChoices(view.inputs)}, {"outputs", deviceChoices(view.outputs)}, {"separateDevices", view.separateDevices}});
	}
	if (kind == "setAudioSetup" || kind == "useAudioProfile")
	{
		requireFields(request, {"hostId", "inputId", "outputId", "inputChannel", "outputChannel", "sampleRate", "blockSize"});
		AudioSetup setup{
			deviceId(request, "hostId"), deviceId(request, "outputId", true), deviceId(request, "inputId", true),
			audioNumber(request, "inputChannel", 63), audioNumber(request, "outputChannel", 62),
			audioNumber(request, "sampleRate", 192000), audioNumber(request, "blockSize", 8192),
		};
		if (kind == "useAudioProfile")
		{
			session.rememberAudioSetup(std::move(setup));
			return {};
		}
		return appliedAudioSetup(session.setAudioSetup(std::move(setup)));
	}
#endif

	if (kind == "project")
	{
		requireFields(request, {"offset"});
		const auto offset = arrayIndex(request, "offset");
		return projectPageReply(session.projectPage(offset, pageSize), offset);
	}
	if (kind == "transportStatus" || kind == "prepareOutput" || kind == "play" || kind == "stop" || kind == "seek" || kind == "setLoop")
	{
		if (kind == "play" || kind == "seek")
		{
			requireFields(request, {"frame"});
			const auto frame = integer("frame");
			if (kind == "seek") session.seek(frame);
			else if (session.playbackReady()) session.play(frame);
		}
		else if (kind == "setLoop")
		{
			requireFields(request, {"enabled", "start", "end"});
			const auto& enabled = request.getProperty("enabled");
			if (!enabled.isBool()) throw std::invalid_argument("The Tracktion loop toggle must be a boolean");
			const auto start = integer("start");
			const auto end = integer("end");
			if (end <= start) throw std::invalid_argument("The Tracktion loop range is empty");
			session.setLoop(static_cast<bool>(enabled), start, end);
		}
		else
		{
			requireFields(request, {});
			if (kind == "prepareOutput") session.prepareSystemOutput();
			if (kind == "stop") session.stop();
		}
		return transportView(session);
	}

	const auto revision = static_cast<Revision>(integer("revision"));
	if (revision != session.revision() && kind != "finishRecording")
		throw std::invalid_argument("The Tracktion Edit revision has changed");

	std::uint64_t created = 0;
	if (kind == "startRecording")
	{
		requireFields(request, {"revision", "trackId", "frame"});
		session.startRecording(revision, itemId(request, "trackId"), integer("frame"));
		return transportView(session);
	}
	if (kind == "clips")
	{
		requireFields(request, {"revision", "trackId", "offset"});
		const auto offset = arrayIndex(request, "offset");
		return clipPageReply(session.clipPage(itemId(request, "trackId"), offset, pageSize), revision, offset);
	}
	if (kind == "trackMix")
	{
		requireFields(request, {"revision", "trackId"});
		const auto mix = session.trackMix(revision, itemId(request, "trackId"));
		return record({{"gainDb", mix.gainDb}, {"pan", mix.pan}, {"muted", mix.muted}, {"solo", mix.solo}});
	}
	if (kind == "trackAutomation")
	{
		requireFields(request, {"revision", "trackId", "parameter", "offset"});
		const auto offset = arrayIndex(request, "offset");
		const auto page = session.trackAutomation(revision, itemId(request, "trackId"), trackParameter(request), offset, pageSize);
		juce::Array<juce::var> points;
		for (const auto& point : page.points)
			points.add(record({{"frame", number(point.frame)}, {"value", point.value}, {"curve", point.curve}}));
		return record({{"revision", number(revision)}, {"points", juce::var(points)},
		               {"nextOffset", pageCursor(offset + page.points.size(), page.total)}});
	}
	if (kind == "offlineEffects")
	{
		requireFields(request, {"revision", "trackId", "offset"});
		const auto effects = session.offlineEffects(revision, itemId(request, "trackId"));
		const auto start = arrayIndex(request, "offset");
		if (start > effects.size()) throw std::invalid_argument("The Tracktion offline effects page is outside the track");
		const auto end = std::min(effects.size(), start + pageSize);
		juce::Array<juce::var> slots;
		for (auto i = start; i < end; ++i)
		{
			const auto& slot = effects[i];
			const auto name = juce::String(slot.effect.stableId).substring(0, 128);
			const auto format = juce::String(slot.effect.format).substring(0, 16);
			constexpr auto labelCharacters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._:-";
			slots.add(record({{"id", juce::String(std::to_string(slot.id))},
			                  {"name", name.isNotEmpty() && name.containsOnly(labelCharacters) ? name : juce::String("Offline effect")},
			                  {"format", format.containsOnly(labelCharacters) ? format : juce::String()}}));
		}
		return record({{"revision", number(session.revision())}, {"slots", juce::var(slots)}, {"nextOffset", pageCursor(end, effects.size())}});
	}
	if (kind == "finishRecording")
	{
		requireFields(request, {"revision", "discard"});
		const auto& discard = request.getProperty("discard");
		if (!discard.isBool()) throw std::invalid_argument("The Tracktion discard flag must be a boolean");
		created = session.finishRecording(revision, static_cast<bool>(discard)).value_or(0);
	}
	else if (kind == "addTrack")
	{
		requireFields(request, {"revision", "name"});
		created = session.addTrack(revision, text(request, "name", 128).toStdString());
	}
	else if (kind == "duplicateTrack")
	{
		requireFields(request, {"revision", "trackId"});
		created = session.duplicateTrack(revision, itemId(request, "trackId"));
	}
	else if (kind == "setTrackMix")
	{
		requireFields(request, {"revision", "trackId", "gainDb", "pan", "muted", "solo"});
		const auto& muted = request.getProperty("muted");
		const auto& solo = request.getProperty("solo");
		if (!muted.isBool() || !solo.isBool()) throw std::invalid_argument("The Tracktion mixer toggles must be booleans");
		session.setTrackMix(revision, itemId(request, "trackId"),
		                    {mixerValue(request, "gainDb", -100.0, 6.0), mixerValue(request, "pan", -1.0, 1.0),
		                     static_cast<bool>(muted), static_cast<bool>(solo)});
	}
	else if (kind == "setAutomationPoint")
	{
		requireFields(request, {"revision", "trackId", "parameter", "index", "frame", "value", "curve"});
		const auto parameter = trackParameter(request);
		const auto gain = parameter == TrackParameter::gainDb;
		const auto index = request.getProperty("index").isVoid() ? std::nullopt : std::optional{arrayIndex(request, "index")};
		session.setAutomationPoint(revision, itemId(request, "trackId"), parameter, index,
		                           {integer("frame"), mixerValue(request, "value", gain ? -100.0 : -1.0, gain ? 6.0 : 1.0),
		                            mixerValue(request, "curve", -1.0, 1.0)});
	}
	else if (kind == "removeAutomationPoint")
	{
		requireFields(request, {"revision", "trackId", "parameter", "index"});
		session.removeAutomationPoint(revision, itemId(request, "trackId"), trackParameter(request), arrayIndex(request, "index"));
	}
	else if (kind == "clearAutomation")
	{
		requireFields(request, {"revision", "trackId", "parameter"});
		session.clearAutomation(revision, itemId(request, "trackId"), trackParameter(request));
	}
	else if (kind == "import")
	{
		requireFields(request, {"revision", "trackId", "asset", "name", "start", "sourceOffset", "frames"});
		const auto input = exchangeFile(exchange, request, "input", ".wav");
		created = session.insertAudio(revision, itemId(request, "trackId"), input,
		                              integer("start"), integer("sourceOffset"), integer("frames"),
		                              text(request, "name", 512).toStdString());
	}
	else if (kind == "importFile")
	{
		requireFields(request, {"revision", "trackId", "asset", "name", "start"});
		const auto input = exchangeFile(exchange, request, "input", ".wav");
		created = session.insertAudio(revision, itemId(request, "trackId"), input,
		                              integer("start"), 0, std::nullopt, text(request, "name", 512).toStdString());
	}
	else if (kind == "trim")
	{
		requireFields(request, {"revision", "clipId", "start", "end"});
		session.trim(revision, itemId(request, "clipId"), integer("start"), integer("end"));
	}
	else if (kind == "split")
	{
		requireFields(request, {"revision", "clipId", "frame"});
		created = session.split(revision, itemId(request, "clipId"), integer("frame"));
	}
	else if (kind == "moveClip" || kind == "duplicateClip")
	{
		requireFields(request, {"revision", "clipId", "trackId", "start"});
		const auto clip = itemId(request, "clipId");
		const auto track = itemId(request, "trackId");
		const auto start = integer("start");
		if (kind == "moveClip") session.moveClip(revision, clip, track, start);
		else created = session.duplicateClip(revision, clip, track, start);
	}
	else if (kind == "deleteClip")
	{
		requireFields(request, {"revision", "clipId"});
		session.deleteClip(revision, itemId(request, "clipId"));
	}
	else if (kind == "deleteRange" || kind == "copyRange" || kind == "cutRange")
	{
		requireFields(request, {"revision", "mode", "trackId", "start", "end"});
		const auto mode = text(request, "mode", 9);
		RangeDeleteMode selected;
		if (mode == "leaveGap") selected = RangeDeleteMode::leaveGap;
		else if (mode == "perClip") selected = RangeDeleteMode::perClip;
		else if (mode == "track") selected = RangeDeleteMode::track;
		else if (mode == "allTracks") selected = RangeDeleteMode::allTracks;
		else throw std::invalid_argument("Unknown Tracktion range delete mode");
		std::optional<TrackId> track;
		if (!request.getProperty("trackId").isVoid()) track = itemId(request, "trackId");
		const auto start = integer("start");
		const auto end = integer("end");
		if (kind == "deleteRange") session.deleteRange(revision, selected, track, start, end);
		else session.copyRange(revision, selected, track, start, end, clipboard, kind == "cutRange");
	}
	else if (kind == "pasteRange")
	{
		requireFields(request, {"revision", "mode", "trackId", "start"});
		const auto mode = text(request, "mode", 12);
		RangePasteMode selected;
		if (mode == "overlap") selected = RangePasteMode::overlap;
		else if (mode == "insertTracks") selected = RangePasteMode::insertTracks;
		else if (mode == "insertAll") selected = RangePasteMode::insertAll;
		else throw std::invalid_argument("Unknown Tracktion paste mode");
		session.pasteRange(revision, selected, itemId(request, "trackId"), integer("start"), clipboard);
	}
	else if (kind == "undo" || kind == "redo" || kind == "save")
	{
		requireFields(request, {"revision"});
		if (kind == "undo") session.undo(revision);
		else if (kind == "redo") session.redo(revision);
		else session.save(revision);
	}
	else if (kind == "render")
	{
		const auto ranged = request.hasProperty("start") || request.hasProperty("end");
		if (ranged) requireFields(request, {"revision", "start", "end", "asset"});
		else requireFields(request, {"revision", "asset"});
		const auto start = ranged ? integer("start") : Frame{};
		const auto end = ranged ? integer("end") : session.mixEnd();
		session.render(revision, exchangeFile(exchange, request, "output", ".wav"), start, end, nullptr, effects);
	}
#if ! JUCE_WASM
	else if (kind == "insertOfflineEffect")
	{
		requireFields(request, {"revision", "trackId", "format", "stableId", "sha256"});
		created = session.insertOfflineEffect(revision, itemId(request, "trackId"),
			{text(request, "format", 5).toStdString(), text(request, "stableId", 512).toStdString(), text(request, "sha256", 64).toStdString()});
	}
#endif
	else if (kind == "archive")
	{
		requireFields(request, {"revision", "asset"});
		session.archive(revision, exchangeFile(exchange, request, "output", ".zip"));
	}
	else if (kind == "removeOfflineEffect")
	{
		requireFields(request, {"revision", "trackId", "slotId"});
		session.removeOfflineEffect(revision, itemId(request, "trackId"), itemId(request, "slotId"));
	}
	else
	{
		throw std::invalid_argument("The Tracktion command is unsupported");
	}

	return record({
		{"revision", number(session.revision())},
		{"itemId", created != 0 ? juce::var(juce::String(std::to_string(created))) : juce::var()},
	});
}
}
