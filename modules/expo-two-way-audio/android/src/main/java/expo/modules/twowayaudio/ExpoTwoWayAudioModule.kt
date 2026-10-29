package expo.modules.twowayaudio

import android.util.Log
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.interfaces.permissions.Permissions

class ExpoTwoWayAudioModule : Module() {
    companion object {
        private const val ON_MIC_DATA_EVENT = "onMicrophoneData"
        private const val ON_INPUT_VOLUME_LEVEL_EVENT = "onInputVolumeLevelData"
        private const val ON_OUTPUT_VOLUME_LEVEL_EVENT = "onOutputVolumeLevelData"
        private const val ON_RECORDING_CHANGE_EVENT = "onRecordingChange"
        private const val ON_AUDIO_INTERRUPTION_EVENT = "onAudioInterruption"
        var audioEngine: AudioEngine? = null
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoTwoWayAudio")
        AsyncFunction("initialize") { promise: Promise ->
            try {
                if (audioEngine != null) {
                    promise.resolve(true)
                    return@AsyncFunction
                }
                audioEngine = appContext.reactContext?.let { AudioEngine(it) }
                setupCallbacks()
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e("ExpoTwoWayAudio", "initialize failed", e)
                promise.resolve(false)
            }
        }

         Function("isRecording") {
             audioEngine?.isRecording ?: false
         }

         Function("toggleRecording") { value: Boolean ->
             audioEngine?.let { engine ->
                 val isRecording = engine.toggleRecording(value)
                 sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf("data" to isRecording))
                 isRecording
             } ?: false
         }

         Function("tearDown") {
             audioEngine?.tearDown()
             audioEngine = null
             null
         }

         // Barge-in: flush playback immediately, keep the mic/engine alive.
         // (Replaces upstream's forked `restart`; emits no events — recording
         // state does not change and the app only subscribes onMicrophoneData.)
         Function("bargeIn") {
             audioEngine?.clearPlaybackQueueForBargeIn()
         }

         Function("playPCMData") { data: kotlin.ByteArray ->
             audioEngine?.playPCMData(data)
         }

         Function("bypassVoiceProcessing") { bypass: Boolean ->
             audioEngine?.bypassVoiceProcessing(bypass)
         }

         Function("isPlaying") {
             audioEngine?.isPlaying ?: false
         }

        Function("getMicrophoneModeIOS") {
            throw UnsupportedOperationException("getMicrophoneModeIOS is only supported on iOS")
        }

        Function ("setMicrophoneModeIOS") {
            throw UnsupportedOperationException("setMicrophoneModeIOS is only supported on iOS")
        }

         AsyncFunction("getMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.getPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

         AsyncFunction("requestMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.askForPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

        // Register events
        Events(
            ON_MIC_DATA_EVENT,
            ON_INPUT_VOLUME_LEVEL_EVENT,
            ON_OUTPUT_VOLUME_LEVEL_EVENT,
            ON_RECORDING_CHANGE_EVENT,
            ON_AUDIO_INTERRUPTION_EVENT
        )
    }

    private fun setupCallbacks() {
        audioEngine?.apply {
            onMicDataCallback = { data ->
                sendEvent(ON_MIC_DATA_EVENT, bundleOf("data" to data))
            }
            onInputVolumeCallback = { level ->
                sendEvent(ON_INPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onOutputVolumeCallback = { level ->
                sendEvent(ON_OUTPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onAudioInterruptionCallback = { data ->
                sendEvent(ON_AUDIO_INTERRUPTION_EVENT, bundleOf("data" to data))
                sendEvent(ON_RECORDING_CHANGE_EVENT, bundleOf(
                    "data" to (audioEngine?.isRecording ?: false)
                ))
            }
        }
    }
}