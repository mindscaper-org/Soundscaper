/* SPDX-License-Identifier: AGPL-3.0-only */

#include "vamp_analyzer_adapter.h"

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

int main(int argc, char **argv)
{
	using namespace soundscaper::vamp;
	if (argc != 2) return 1;
	const std::string rawPath(argv[1]);
	const auto path = std::filesystem::weakly_canonical(std::filesystem::path(std::u8string(
		reinterpret_cast<const char8_t *>(rawPath.data()),
		reinterpret_cast<const char8_t *>(rawPath.data() + rawPath.size()))));
	std::string detail;
	std::vector<AnalyzerDescriptor> descriptors;
	if (ExactVampAnalyzer::scanExactLibrary(path, 48000.0, descriptors, detail) != Status::ok
		|| descriptors.size() != 1u
		|| descriptors[0].identifier != "org.soundscaper.fixture.amplitude"
		|| descriptors[0].parameters.size() != 1u || descriptors[0].outputs.size() != 1u) return 2;
	std::unique_ptr<ExactVampAnalyzer> analyzer;
	if (ExactVampAnalyzer::openExactLibrary(path, descriptors[0].identifier, 48000.0,
		analyzer, detail) != Status::ok || analyzer == nullptr) return 3;
	Configuration configuration;
	configuration.sampleRate = 48000.0;
	configuration.channelCount = 1u;
	configuration.stepSize = 2u;
	configuration.blockSize = 4u;
	configuration.frameCount = 4u;
	configuration.parameters.emplace_back("gain", 1.0F);
	configuration.program = "Default";
	std::vector<OutputDescriptor> outputs;
	if (analyzer->configure(configuration, outputs, detail) != Status::ok
		|| outputs.size() != 1u || outputs[0].identifier != "amplitude") return 4;
	const std::vector<float> pcm{0.25F, 0.5F, 0.75F, 1.0F};
	const float *planes[] = { pcm.data() };
	std::vector<Feature> features;
	if (analyzer->processPcm(0u, planes, 1u, pcm.size(), features, detail) != Status::ok
		|| features.size() != 1u || features[0].values.size() != 1u
		|| features[0].values[0] != 0.25F) return 5;
	if (analyzer->finish(features, detail) != Status::ok || features.empty()) return 6;
	analyzer->cancel();
	for (const bool overrideProgram : { false, true }) {
		if (ExactVampAnalyzer::openExactLibrary(path, descriptors[0].identifier, 48000.0,
			analyzer, detail) != Status::ok) return 7;
		configuration.program = "Sensitive";
		configuration.parameters.clear();
		if (overrideProgram) configuration.parameters.emplace_back("gain", 1.0F);
		if (analyzer->configure(configuration, outputs, detail) != Status::ok) return 8;
		if (analyzer->processPcm(0u, planes, 1u, pcm.size(), features, detail) != Status::ok
			|| features.size() != 1u || features[0].values.size() != 1u
			|| features[0].values[0] != (overrideProgram ? 0.25F : 0.125F)) return 9;
		analyzer->cancel();
	}
	if (ExactVampAnalyzer::openExactLibrary(path, descriptors[0].identifier, 48000.0,
		analyzer, detail) != Status::ok) return 10;
	configuration.program = "Default";
	configuration.parameters = { { "gain", 1.0F } };
	configuration.stepSize = 512u;
	configuration.blockSize = 1024u;
	configuration.frameCount = 131072u;
	if (analyzer->configure(configuration, outputs, detail) != Status::ok) return 11;
	std::vector<float> streamed(configuration.frameCount);
	for (std::size_t frame = 0u; frame < streamed.size(); ++frame) {
		streamed[frame] = static_cast<float>(frame) / 262144.0F;
	}
	std::size_t window = 0u;
	for (std::size_t start = 0u; start < streamed.size(); start += 65536u) {
		const float *chunk[] = { streamed.data() + start };
		if (analyzer->processPcm(start, chunk, 1u, 65536u, features, detail) != Status::ok
			|| features.size() != (start == 0u ? 127u : 128u)) return 12;
		for (const auto &feature : features) {
			if (feature.values.size() != 1u || feature.values[0] != streamed[window * 512u]) return 13;
			++window;
		}
	}
	if (window != 255u || analyzer->finish(features, detail) != Status::ok
		|| features.empty() || features[0].values[0] != streamed[window * 512u]) return 14;
	return 0;
}
