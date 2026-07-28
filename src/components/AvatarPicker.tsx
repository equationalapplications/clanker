import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Button, Dialog, HelperText, Icon, Portal, Text } from 'react-native-paper'
import { getCurrentUser } from '~/config/firebaseConfig'
import {
  getCharacterImages,
  setActiveImageId,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { deleteCharacterImage } from '~/services/characterImageService'
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

  const refresh = useCallback(async () => {
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
    setItems(resolved)
  }, [characterId])

  useEffect(() => {
    if (visible) void refresh()
  }, [visible, refresh])

  const { uploadAvatar, isUploading, error: uploadError, clearError: clearUploadError } =
    useAvatarUpload({ characterId, onImageUploaded: (id) => { onActiveImageChange(id); void refresh() } })

  const { generateImage, isGenerating, error: generateError, clearError: clearGenerateError } =
    useImageGeneration({ characterId, onImageGenerated: (id) => { onActiveImageChange(id); void refresh() } })

  const handleActivate = async (imageId: string) => {
    await setActiveImageId(characterId, imageId)
    onActiveImageChange(imageId)
    await refresh()
  }

  const handleDelete = async (imageId: string) => {
    const userId = getCurrentUser()?.uid
    await deleteCharacterImage(imageId, userId ?? '')
    if (imageId === activeImageId) {
      const remaining = await getCharacterImages(characterId)
      onActiveImageChange(remaining[0]?.id ?? null)
    }
    await refresh()
  }

  const error = uploadError || generateError

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