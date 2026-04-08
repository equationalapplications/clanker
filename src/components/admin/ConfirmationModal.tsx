import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper'
import { canSubmitAdminConfirmation } from '~/components/admin/confirmationValidation'

interface AdminConfirmationModalProps {
  visible: boolean
  title: string
  summary: string
  confirmLabel?: string
  confirmKeyword?: string
  requireReason?: boolean
  loading?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function AdminConfirmationModal({
  visible,
  title,
  summary,
  confirmLabel = 'Confirm',
  confirmKeyword,
  requireReason = true,
  loading = false,
  onCancel,
  onConfirm,
}: AdminConfirmationModalProps) {
  const [typedKeyword, setTypedKeyword] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    setTypedKeyword('')
    setReason('')
  }, [visible, confirmKeyword])

  const keywordMatched = useMemo(() => {
    if (!confirmKeyword) {
      return true
    }
    return typedKeyword.trim().toUpperCase() === confirmKeyword.toUpperCase()
  }, [confirmKeyword, typedKeyword])

  const canSubmit = canSubmitAdminConfirmation({
    confirmKeyword,
    typedKeyword,
    requireReason,
    reason,
    loading,
  })

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={loading ? undefined : onCancel} style={styles.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text style={styles.summary}>{summary}</Text>
          {confirmKeyword ? (
            <View>
              <TextInput
                mode="outlined"
                label={`Type ${confirmKeyword} to continue`}
                value={typedKeyword}
                onChangeText={setTypedKeyword}
                autoCapitalize="characters"
              />
              <HelperText type={keywordMatched ? 'info' : 'error'}>
                {keywordMatched
                  ? 'Confirmation keyword is valid.'
                  : `You must type ${confirmKeyword} exactly.`}
              </HelperText>
            </View>
          ) : null}
          {requireReason ? (
            <TextInput
              mode="outlined"
              label="Reason"
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
            />
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onPress={() => onConfirm(reason.trim())} disabled={!canSubmit} loading={loading}>
            {confirmLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  dialog: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  summary: {
    marginBottom: 16,
  },
})
