/**
 * The photo inside a chat bubble.
 *
 * Renders the 256 thumb, not the master: a scrollback of masters is ~15 MB of
 * decoded bitmaps against ~1.2 MB of thumbs, which is the same reason the picker
 * uses thumbs. The master is resolved only once the user taps through.
 *
 * Download and share belong to Phase 3, where they arrive with expo-media-library
 * and expo-sharing for agent-generated images.
 */

import { useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import type { IMessage } from 'react-native-gifted-chat'
import { useResolvedImage } from '~/hooks/useResolvedImage'

type PhotoMessage = IMessage & { imageId?: string }

const THUMB_SIZE = 200

export default function ChatImageBubble({ currentMessage }: { currentMessage?: PhotoMessage }) {
  const imageId = currentMessage?.imageId ?? null
  const [viewerOpen, setViewerOpen] = useState(false)

  const thumbUri = useResolvedImage(imageId, 'thumb')
  // Resolved only while the viewer is open so scrollback never pulls masters.
  const masterUri = useResolvedImage(viewerOpen ? imageId : null, 'master')

  if (!imageId) return null

  if (!thumbUri) {
    // A dangling render hint is expected, not exceptional: the row may be
    // mid-sync on this device, deleted from the gallery, or cap-evicted. The
    // message keeps its text; only the picture degrades.
    return (
      <View style={styles.placeholder} accessible accessibilityLabel="Photo unavailable">
        <Text variant="labelSmall">Photo unavailable</Text>
      </View>
    )
  }

  return (
    <>
      <Pressable
        onPress={() => setViewerOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo in this message"
        accessibilityHint="Opens the photo full screen"
      >
        <Image
          source={{ uri: thumbUri }}
          style={styles.thumb}
          // Contain, not cover: chat photos keep their native aspect ratio, and
          // cropping the bubble preview would hide the part being asked about.
          resizeMode="contain"
        />
      </Pressable>

      <Modal visible={viewerOpen} transparent onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          {masterUri && (
            <Image
              source={{ uri: masterUri }}
              style={styles.viewerImage}
              resizeMode="contain"
              accessible
              accessibilityLabel="Full size photo"
            />
          )}
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12, margin: 3 },
  placeholder: {
    width: THUMB_SIZE,
    height: 60,
    margin: 3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
})
