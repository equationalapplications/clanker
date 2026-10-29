require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  # Vendored from @speechmatics/expo-two-way-audio@0.1.2 (EA behavioral fork,
  # replaces patches/@speechmatics+expo-two-way-audio+0.1.2.patch).
  # iOS deployment target kept at upstream's 13.4 to match today's builds.
  s.name           = 'ExpoTwoWayAudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '13.4' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/speechmatics/expo-two-way-audio' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
