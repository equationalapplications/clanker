import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Button, Dialog, HelperText, Icon, Portal, Text } from 'react-native-paper'
import { getCurrentUser } from '~/config/firebaseConfig'
import {
  getActiveCharacterImage,
  getCharacterImages,
  setActiveImageId,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { deleteCharacterImage } from '~/services/characterImageService'
import { pushActiveImageId } from '~/services/characterImageSyncService'
import { resolveImageUri } from '~/services/localImageStore'
import { useAvatarUpload } from '~/hooks/useAvatarUpload'
import { useImageGeneration } from '~/hooks/useImageGeneration'

interface AvatarPickerProps {
  visible: boolean
  characterId: string
  activeImageId: string | null
  /** Prompt handed to generation when the user taps Generate. */
  imagePrompt: string
  onDismiss: () => void
  onActiveImageChange: (imageId: string | null) => void
}

interface PickerItem {
  row: CharacterImageRow
  uri: string | null
}

export function AvatarPicker({
  visible,
  characterId,
  activeImageId,
  imagePrompt,
  onDismiss,
  onActiveImageChange,
}: AvatarPickerProps) {
  const [items, setItems] = useState<PickerItem[]>([])
  const [actionError, setActionError] = useState<string | null>(null)

  const refreshEpoch = useRef(0)
  const refresh = useCallback(async () => {
    const epoch = ++refreshEpoch.current
    try {
      const rows = await getCharacterImages(characterId)
      // Resolve thumbs, not masters: 100 masters is a ~15 MB screen, 100 thumbs
      // is ~1.2 MB — and on web every byte crosses the WASM boundary.
      const resolved = await Promise.all(
        rows.map(async (row) => {
          try {
            return { row, uri: await resolveImageUri(row, 'thumb') }
          } catch {
            return { row, uri: null }
          }
        }),
      )
      if (epoch === refreshEpoch.current) {
        setItems(resolved)
        setActionError(null)
      }
    } catch (err) {
      if (epoch === refreshEpoch.current) {
        setItems([])
        setActionError(err instanceof Error ? err.message : 'Failed to load images')
      }
    }
  }, [characterId])

  useEffect(() => {
    // Fetching the gallery from SQLite when the modal opens is exactly the
    // "synchronize with an external system" case this lint rule allows for —
    // `refresh`'s own setState calls happen asynchronously after the DB read
    // resolves, not synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() calls setState asynchronously after DB read
    if (visible) void refresh()
  }, [visible, refresh])

  const { uploadAvatar, isUploading, error: uploadError, clearError: clearUploadError } =
    useAvatarUpload({ characterId, onImageUploaded: (id) => { onActiveImageChange(id); void refresh() } })

  const { generateImage, isGenerating, error: generateError, clearError: clearGenerateError } =
    useImageGeneration({ characterId, onImageGenerated: (id) => { onActiveImageChange(id); void refresh() } })

  const handleActivate = async (imageId: string) => {
    try {
      await setActiveImageId(characterId, imageId)
      onActiveImageChange(imageId)
      // Best-effort: the regular sweep would eventually push this pointer too,
      // but pushing it now is what lets a second device see the change without
      // waiting for the next full sync.
      const userId = getCurrentUser()?.uid
      if (userId) void pushActiveImageId(characterId, userId)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to activate image'
      setActionError(message)
    }
  }

  const performDelete = async (imageId: string) => {
    const userId = getCurrentUser()?.uid
    // deleteCharacterImage's ownership check silently returns for a mismatched
    // user, so passing '' would make the confirmed delete a no-op with no
    // feedback at all. Say so instead.
    if (!userId) {
      Alert.alert('Sign in required', 'You must be signed in to delete an image.')
      return
    }

    try {
      await deleteCharacterImage(imageId, userId)
      if (imageId === activeImageId) {
        // deleteCharacterImage already repointed active_image_id in the DB
        // (excluding 'reserved' rows); read that back instead of re-deriving
        // next-active client-side, which would drift from its selection logic.
        const nextActive = await getActiveCharacterImage(characterId)
        onActiveImageChange(nextActive?.id ?? null)
        // Pushed even when null: clearing the pointer after deleting the last
        // image is exactly the change other devices need to see.
        void pushActiveImageId(characterId, userId, { allowClear: true })
      }
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete image'
      setActionError(message)
    }
  }

  // Deletion is irreversible for images the user spent credits on, so a
  // long-press must not fire it directly — confirm first. Returns a promise
  // that resolves once the confirmed delete (if any) completes, so callers —
  // including tests driving onLongPress directly — can await the whole flow.
  const handleDelete = (imageId: string): Promise<void> => {
    return new Promise((resolve) => {
      Alert.alert('Delete this image?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void performDelete(imageId).then(resolve, resolve) },
        },
      ])
    })
  }

  const error = uploadError || generateError || actionError

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Choose avatar</Dialog.Title>
        <Dialog.Content>
          <View style={styles.headerActions}>
            <Button
              testID="avatar-picker-upload"
              mode="outlined"
              icon={isUploading ? undefined : 'image-plus'}
              loading={isUploading}
              disabled={isUploading || isGenerating}
              onPress={() => { clearUploadError(); clearGenerateError(); return uploadAvatar() }}
              style={styles.headerButton}
            >
              Upload
            </Button>
            <Button
              testID="avatar-picker-generate"
              mode="outlined"
              icon={isGenerating ? undefined : 'image-auto-adjust'}
              loading={isGenerating}
              disabled={isUploading || isGenerating}
              onPress={() => { clearUploadError(); clearGenerateError(); return generateImage(imagePrompt) }}
              style={styles.headerButton}
            >
              Generate
            </Button>
          </View>

          {error ? <HelperText type="error" visible>{error}</HelperText> : null}

          {items.length === 0 ? (
            <Text testID="avatar-picker-empty" style={styles.empty}>
              No images yet. Upload a photo or generate one.
            </Text>
          ) : (
            <FlatList
              data={items}
              numColumns={3}
              keyExtractor={(item) => item.row.id}
              renderItem={({ item, index }) => {
                const selected = item.row.id === activeImageId
                // 'local' is the privacy-mode terminal state, NOT a failure —
                // only rows that tried and could not reach the cloud are flagged.
                const notBackedUp = item.row.sync_state === 'failed'
                return (
                  <TouchableOpacity
                    testID="avatar-picker-item"
                    style={styles.tile}
                    onPress={() => handleActivate(item.row.id)}
                    onLongPress={() => handleDelete(item.row.id)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `Avatar ${index + 1} of ${items.length}` +
                      `${selected ? ', selected' : ''}` +
                      `${notBackedUp ? ', not backed up' : ''}`
                    }
                    accessibilityHint="Tap to use this avatar, long press to delete it"
                  >
                    {item.uri ? (
                      <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbMissing]} />
                    )}
                    {selected ? (
                      <View style={styles.check}>
                        <Icon source="check-circle" size={20} />
                      </View>
                    ) : null}
                    {notBackedUp ? (
                      <View style={styles.warning}>
                        <Icon source="cloud-off-outline" size={16} />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Done</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  dialog: { maxHeight: '80%' },
  headerActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  headerButton: { flex: 1 },
  empty: { textAlign: 'center', opacity: 0.7, paddingVertical: 24 },
  tile: { flex: 1 / 3, aspectRatio: 1, padding: 4 },
  thumb: { width: '100%', height: '100%', borderRadius: 8 },
  thumbMissing: { backgroundColor: 'rgba(127,127,127,0.2)' },
  check: { position: 'absolute', right: 6, bottom: 6 },
  warning: { position: 'absolute', left: 6, bottom: 6 },
})

export default AvatarPicker
