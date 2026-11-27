// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
constexpr int isolatedEffectBlockSize = 128;
constexpr int nativeRenderBlockSize = 1024;
// Match the professional scan bound before allocating Tracktion compensation buffers.
constexpr int maximumLatencyFrames = 1'048'576;
const juce::Identifier formatProperty("soundscaperEffectFormat");
const juce::Identifier stableIdProperty("soundscaperEffectStableId");
const juce::Identifier digestProperty("soundscaperEffectSha256");

void validateIdentity(const OfflineEffectIdentity& effect)
{
	constexpr std::array<std::string_view, 6> formats{"clap", "vst3", "vst2", "au", "ladspa", "lv2"};
	if (std::ranges::find(formats, effect.format) == formats.end() || effect.stableId.empty()
	    || effect.stableId.size() > 512 || effect.stableId.find('\0') != std::string::npos
	    || effect.sha256.size() != 64 || effect.sha256.find_first_not_of("0123456789abcdef") != std::string::npos)
		throw std::invalid_argument("The Tracktion effect installation identity is invalid");
}

class OfflineEffectPlugin final : public te::Plugin
{
public:
	static constexpr const char* xmlTypeName = "soundscaperOfflineEffect";
	explicit OfflineEffectPlugin(te::PluginCreationInfo info) : Plugin(info) {}
	~OfflineEffectPlugin() override { notifyListenersOfDeletion(); }

	juce::String getName() const override { return state[stableIdProperty].toString(); }
	juce::String getPluginType() override { return xmlTypeName; }
	juce::String getSelectableDescription() override { return getName(); }
	BusLayout getBusses() const override { return BusLayout::singleStereoInOut(); }
	void initialise(const te::PluginInitialisationInfo&) override {}
	void deinitialise() override {}
	double getLatencySeconds() override { return latencySeconds; }

	OfflineEffectIdentity identity() const
	{
		return {state[formatProperty].toString().toStdString(), state[stableIdProperty].toString().toStdString(),
		        state[digestProperty].toString().toStdString()};
	}

	void bind(OfflineEffectHost& host, int sampleRate, std::atomic_bool& renderFailed)
	{
		const auto key = identity();
		validateIdentity(key);
		auto opened = host.openStereo(key, sampleRate, isolatedEffectBlockSize);
		if (!opened) throw std::invalid_argument("The selected isolated Tracktion effect is unavailable");
		const auto latency = opened->latencyFrames();
		if (latency < 0 || latency > maximumLatencyFrames)
			throw std::invalid_argument("The isolated Tracktion effect returned invalid latency");
		latencySeconds = static_cast<double>(latency) / sampleRate;
		failed = &renderFailed;
		instance = std::move(opened);
	}

	void release()
	{
		instance.reset();
		failed = nullptr;
		latencySeconds = 0.0;
	}

	void applyToBuffer(const te::PluginRenderContext& context) override
	{
		if (!context.isRendering || !instance || failed->load()) return;
		auto* buffer = context.destBuffer;
		if (!buffer || context.bufferNumSamples == 0) return;
		if (buffer->getNumChannels() != 2)
		{
			failed->store(true);
			return;
		}
		try
		{
			for (int offset = 0; offset < context.bufferNumSamples; offset += isolatedEffectBlockSize)
			{
				const auto start = context.bufferStartSample + offset;
				const auto count = static_cast<std::size_t>(std::min(isolatedEffectBlockSize, context.bufferNumSamples - offset));
				std::span<float> left(buffer->getWritePointer(0, start), count);
				std::span<float> right(buffer->getWritePointer(1, start), count);
				const auto finite = [](float sample) { return std::isfinite(sample); };
				if (!instance->process(left, right) || !std::ranges::all_of(left, finite) || !std::ranges::all_of(right, finite))
				{
					failed->store(true);
					return;
				}
			}
		}
		catch (...)
		{
			failed->store(true);
		}
	}

private:
	std::unique_ptr<OfflineEffectInstance> instance;
	std::atomic_bool* failed = nullptr;
	double latencySeconds = 0.0;
};

class RenderBindings
{
public:
	~RenderBindings()
	{
		for (auto* effect : effects) effect->release();
	}

	void attach(te::Edit& edit, OfflineEffectHost* host, int rate)
	{
		for (auto* plugin : te::getAllPlugins(edit, false))
			if (auto* effect = dynamic_cast<OfflineEffectPlugin*>(plugin); effect && effect->isEnabled())
			{
				if (!host) throw std::invalid_argument("The Tracktion render requires its isolated effects");
				effects.push_back(effect);
				effect->bind(*host, rate, failed);
			}
	}

	int renderBlockSize() const noexcept
	{
		return effects.empty() ? nativeRenderBlockSize : isolatedEffectBlockSize;
	}

	std::atomic_bool failed{false};

private:
	std::vector<OfflineEffectPlugin*> effects;
};
}

void registerOfflineEffectPlugin(te::Engine& engine)
{
	engine.getPluginManager().createBuiltInType<OfflineEffectPlugin>();
}

void requireLiveEffectSupport(const te::Edit& edit)
{
	for (auto* plugin : te::getAllPlugins(edit, false))
		if (dynamic_cast<OfflineEffectPlugin*>(plugin) && plugin->isEnabled())
			throw std::invalid_argument("This Tracktion Edit has an effect that requires offline rendering");
}

std::uint64_t Session::insertOfflineEffect(Revision expected, TrackId id, const OfflineEffectIdentity& effect)
{
	auto& s = *state;
	s.checkRevision(expected);
	validateIdentity(effect);
	if (s.edit->getTransport().isPlaying()) throw std::invalid_argument("Stop Tracktion playback before adding an offline effect");
	auto& track = s.track(id);
	juce::ValueTree pluginState(te::IDs::PLUGIN);
	pluginState.setProperty(te::IDs::type, OfflineEffectPlugin::xmlTypeName, nullptr);
	pluginState.setProperty(formatProperty, juce::String(effect.format), nullptr);
	pluginState.setProperty(stableIdProperty, juce::String(effect.stableId), nullptr);
	pluginState.setProperty(digestProperty, juce::String(effect.sha256), nullptr);
	s.begin("Add isolated effect");
	const auto plugin = track.pluginList.insertPlugin(pluginState, -1);
	if (!plugin) throw std::invalid_argument("Tracktion could not add the effect to this track");
	s.commit();
	return plugin->itemID.getRawID();
}

std::vector<OfflineEffectSlot> Session::offlineEffects(Revision expected, TrackId id) const
{
	state->checkRevision(expected);
	std::vector<OfflineEffectSlot> result;
	for (auto* plugin : state->track(id).pluginList.getPlugins())
		if (auto* effect = dynamic_cast<OfflineEffectPlugin*>(plugin))
			result.push_back({effect->itemID.getRawID(), effect->identity()});
	return result;
}

void Session::removeOfflineEffect(Revision expected, TrackId track, std::uint64_t slot)
{
	auto& s = *state;
	s.checkRevision(expected);
	if (s.edit->getTransport().isPlaying()) throw std::invalid_argument("Stop Tracktion playback before removing an offline effect");
	for (auto* plugin : s.track(track).pluginList.getPlugins())
		if (auto* effect = dynamic_cast<OfflineEffectPlugin*>(plugin); effect && effect->itemID.getRawID() == slot)
		{
			s.begin("Remove isolated effect");
			effect->deleteFromParent();
			s.commit();
			return;
		}
	throw std::invalid_argument("The selected Tracktion effect slot is unavailable");
}

void Session::render(Revision expected, const juce::File& output, Frame start, Frame end,
                     const std::atomic_bool* cancelled, OfflineEffectHost* effects)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto from = s.position(start);
	const auto until = s.position(end);
	if (end <= start || output.exists() || output.isSymbolicLink() || !output.hasFileExtension("wav"))
		throw std::invalid_argument("Render requires a valid range and a new WAV file");
	const auto isCancelled = [cancelled] { return cancelled != nullptr && cancelled->load(); };
	if (isCancelled())
		throw std::runtime_error("The Tracktion render was cancelled");
	s.edit->flushState();
	const auto renderEdit = s.makeEdit(s.edit->state.createCopy(), te::Edit::forRendering);
	if (!renderEdit)
		throw std::runtime_error("Cannot detach the Tracktion Edit for rendering");
	RenderBindings bindings;
	bindings.attach(*renderEdit, effects, s.sampleRate);

	juce::TemporaryFile staging(output);
	te::Renderer::Parameters params(*renderEdit);
	params.destFile = staging.getFile();
	params.audioFormat = s.engine.getAudioFileFormatManager().getWavFormat();
	params.time = {from, until};
	params.tracksToDo = te::toBitSet(te::getAllTracks(*renderEdit));
	params.sampleRateForAudio = s.sampleRate;
	params.blockSizeForAudio = bindings.renderBlockSize();
	params.bitDepth = 16;
	params.canRenderInMono = false;
	params.checkNodesForAudio = false;
	params.useMasterPlugins = true;
	auto task = te::render_utils::createRenderTask(params, "Soundscaper render", nullptr, nullptr);
	if (!task)
		throw std::runtime_error("Tracktion could not prepare the render");
	task->setCancellationCheck([&] { return isCancelled() || bindings.failed.load(); });
	while (task->runJob() != juce::ThreadPoolJob::jobHasFinished) {}
	if (isCancelled())
		throw std::runtime_error("The Tracktion render was cancelled");
	if (bindings.failed.load())
		throw std::invalid_argument("An isolated Tracktion effect failed during rendering");
	if (task->errorMessage.isNotEmpty() || !staging.getFile().existsAsFile()
	    || !staging.overwriteTargetFileWithTemporary())
		throw std::runtime_error("Tracktion could not render the Edit");
}
}
