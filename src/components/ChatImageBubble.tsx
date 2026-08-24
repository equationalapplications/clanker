/**
 * The photo inside a chat bubble.
 *
 * Renders the 256 thumb, not the master: a scrollback of masters is ~15 MB of
 * decoded bitmaps against ~1.2 MB of thumbs, which is the same reason the picker
 * uses thumbs. The master is resolved only once the user taps through.
 *
 * Save/share arrived with agent image generation (spec §6.6): add-only photo
 * permission, expo-sharing for the sheet; either failing degrades to the inline
 * notice and leaves gallery rows and viewer state untouched.
 */

import { useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import type { Message } from '~/types/chat'
import { useResolvedImage } from '~/hooks/useResolvedImage'

type PhotoMessage = Message & { imageId?: string }

const THUMB_SIZE = 200

export default function ChatImageBubble({ currentMessage }: { currentMessage?: PhotoMessage }) {
  const imageId = currentMessage?.imageId ?? null
  const [viewerOpen, setViewerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // `useResolvedImage` returns null both while the lookup is in flight and
  // after a completed lookup that found no row (see `useResolvedImage.ts`).
  // `isResolved` is the only signal that distinguishes the two: a null thumb
  // before that is just the spinner for the row fetch, not a real absence.
  const { uri: thumbUri, isResolved: thumbResolved } = useResolvedImage(imageId, 'thumb')
  // Resolved only while the viewer is open so scrollback never pulls masters.
  const { uri: masterUri } = useResolvedImage(viewerOpen ? imageId : null, 'master')

  if (!imageId) return null

  const saveToPhotos = async (): Promise<void> => {
    if (!masterUri) return
    try {
      // writeOnly → the add-only prompt backed by NSPhotoLibraryAddUsageDescription.
      const perm = await MediaLibrary.requestPermissionsAsync(true)
      if (!perm.granted) {
        setNotice('Photo library permission denied')
        return
      }
      await MediaLibrary.saveToLibraryAsync(masterUri)
      setNotice('Saved to Photos')
    } catch {
      setNotice("Couldn't save to Photos")
    }
  }

  const shareImage = async (): Promise<void> => {
    if (!masterUri) return
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setNotice('Sharing is not available here')
        return
      }
      await Sharing.shareAsync(masterUri, { mimeType: 'image/webp', dialogTitle: 'Share image' })
    } catch {
      setNotice("Couldn't share this image")
    }
  }

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
        onPress={() => {
          setNotice(null)
          setViewerOpen(true)
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo in this message"
        accessibilityHint="Opens the photo full screen"
      >
        <Image source={{ uri: thumbUri }} style={styles.thumb} resizeMode="contain" />
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
          {notice && (
            <View style={styles.noticePill} accessible accessibilityLiveRegion="polite">
              <Text variant="labelMedium" style={styles.noticeLabel}>
                {notice}
              </Text>
            </View>
          )}
          <View style={styles.actionBar}>
            <Pressable
              style={styles.actionButton}
              onPress={saveToPhotos}
              accessibilityRole="button"
              accessibilityLabel="Save to Photos"
            >
              <Text variant="labelLarge" style={styles.actionLabel}>
                Save
              </Text>
            </Pressable>
            <Pressable
              style={styles.actionButton}
              onPress={shareImage}
              accessibilityRole="button"
              accessibilityLabel="Share photo"
            >
              <Text variant="labelLarge" style={styles.actionLabel}>
                Share
              </Text>
            </Pressable>
          </View>
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
  actionBar: {
    position: 'absolute',
    bottom: 48,
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  actionLabel: { color: '#FFFFFF' },
  noticePill: {
    position: 'absolute',
    bottom: 108,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  noticeLabel: { color: '#FFFFFF' },
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
