/* SPDX-License-Identifier: AGPL-3.0-only */
#include "editor.h"

namespace soundscaper::effects {
Editor::Editor(Processor &value)
	: juce::DocumentWindow(value.kind == Kind::gain ? "JUCE Gain" : "JUCE Convolution Reverb",
		juce::Colours::darkgrey, juce::DocumentWindow::closeButton), processor(value)
{
	setUsingNativeTitleBar(true);
	panel.setSize(520, processor.kind == Kind::gain ? 110 : 280);
	for (uint32_t index = 0; index < processor.parameterCount(); ++index) {
		const bool gain = processor.kind == Kind::gain || index == 2;
		auto &slider = sliders[index];
		slider.setRange(gain ? -60 : 0, gain ? 12 : index == 0 ? 100 : 1000, 0.01);
		slider.setValue(gain ? -60 + processor.parameter(index) * 72
			: processor.parameter(index) * (index == 0 ? 100 : 1000));
		slider.setTextValueSuffix(gain ? " dB" : index == 0 ? " %" : " ms");
		slider.setBounds(155, 15 + static_cast<int>(index) * 50, 345, 40);
		slider.onValueChange = [this, index, gain]() {
			const double value = sliders[index].getValue();
			processor.setParameter(index, gain ? (value + 60) / 72 : value / (index == 0 ? 100 : 1000));
		};
		labels[index].setText(gain ? "Output gain" : index == 0 ? "Wet mix" : "Pre-delay", juce::dontSendNotification);
		labels[index].setBounds(15, 15 + static_cast<int>(index) * 50, 135, 40);
		panel.addAndMakeVisible(slider); panel.addAndMakeVisible(labels[index]);
	}
	if (processor.kind == Kind::convolution) {
		load.setBounds(15, 170, 250, 35); panel.addAndMakeVisible(load);
		status.setBounds(15, 210, 490, 55); panel.addAndMakeVisible(status);
		status.setText(processor.impulseName().isEmpty() ? "Load a mono or stereo WAV/AIFF impulse response."
			: processor.impulseName(), juce::dontSendNotification);
		load.onClick = [this]() {
			chooser = std::make_unique<juce::FileChooser>("Load impulse response", juce::File(), "*.wav;*.aif;*.aiff");
			chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
				[safe = juce::Component::SafePointer<Editor>(this)](const juce::FileChooser &selected) {
					if (safe == nullptr || selected.getResult() == juce::File()) return;
					juce::String error;
					const bool loaded = safe->processor.loadImpulseFile(selected.getResult(), error);
					safe->status.setText(loaded ? safe->processor.impulseName() : error, juce::dontSendNotification);
				});
		};
	}
	setContentNonOwned(&panel, false); centreWithSize(panel.getWidth(), panel.getHeight());
	startTimerHz(10);
}
void Editor::timerCallback()
{
	processor.collectRetired();
	for (uint32_t index = 0; index < processor.parameterCount(); ++index) {
		if (sliders[index].isMouseButtonDown()) continue;
		const bool gain = processor.kind == Kind::gain || index == 2;
		sliders[index].setValue(gain ? -60 + processor.parameter(index) * 72
			: processor.parameter(index) * (index == 0 ? 100 : 1000), juce::dontSendNotification);
	}
}
}
