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
import type { Message } from '~/types/chat'
import { useResolvedImage } from '~/hooks/useResolvedImage'

type PhotoMessage = Message & { imageId?: string }

const THUMB_SIZE = 200

export default function ChatImageBubble({ currentMessage }: { currentMessage?: PhotoMessage }) {
  const imageId = currentMessage?.imageId ?? null
  const [viewerOpen, setViewerOpen] = useState(false)

  // `useResolvedImage` returns null both while the lookup is in flight and
  // after a completed lookup that found no row (see `useResolvedImage.ts`).
  // `isResolved` is the only signal that distinguishes the two: a null thumb
  // before that is just the spinner for the row fetch, not a real absence.
  const { uri: thumbUri, isResolved: thumbResolved } = useResolvedImage(imageId, 'thumb')
  // Resolved only while the viewer is open so scrollback never pulls masters.
  const { uri: masterUri } = useResolvedImage(viewerOpen ? imageId : null, 'master')

  if (!imageId) return null

  if (!thumbUri) {
    // Don't render the "Photo unavailable" placeholder until the lookup has
    // completed — the row may simply be mid-sync on this device (message
    // arrived first, image row still en route from another device). Once the
    // lookup completes with no thumbUri, the row is genuinely missing or
    // evicted, and the placeholder is the correct fallback.
    if (!thumbResolved) return null
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
        <Pressable
          style={styles.viewerBackdrop}
          onPress={() => setViewerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          {masterUri && (
            <Image
              source={{ uri: masterUri }}
              style={styles.viewerImage}
              resizeMode="contain"
              accessible
              accessibilityLabel="Full size photo"
            />
          )}
          {/*
            The image is full-bleed and sits on top of the backdrop, so tapping
            the photo itself never reaches the backdrop's dismiss. This button is
            the only affordance a screen-reader or keyboard user can land on —
            and on web `onRequestClose` does not fire for Escape, so without it
            the viewer has no reachable exit at all.
          */}
          <Pressable
            style={styles.viewerClose}
            onPress={() => setViewerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Text variant="labelLarge" style={styles.viewerCloseLabel}>
              Close
            </Text>
          </Pressable>
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
  viewerClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewerCloseLabel: { color: '#FFFFFF' },
})
