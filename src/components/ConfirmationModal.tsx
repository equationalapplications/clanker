import React from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Button, Dialog, Paragraph, Portal } from 'react-native-paper'

type ConfirmationModalProps = {
  visible: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
}) => {
  const { width } = useWindowDimensions()
  const isLargeScreen = width > 768

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title style={styles.title}>{title}</Dialog.Title>
        <Dialog.Content>
          <Paragraph style={[styles.message, isLargeScreen && styles.messageWide]}>
            {message}
          </Paragraph>
        </Dialog.Content>
        <Dialog.Actions style={[styles.actions, isLargeScreen && styles.actionsWide]}>
          {onCancel ? (
            <>
              <Button onPress={onCancel}>Cancel</Button>
              <Button onPress={onConfirm}>Confirm</Button>
            </>
          ) : (
            <Button onPress={onConfirm}>Okay</Button>
          )}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  message: {
    textAlign: 'center',
  },
  messageWide: {
    marginHorizontal: 20,
  },
  actions: {
    justifyContent: 'space-around',
    marginBottom: 80,
  },
  actionsWide: {
    justifyContent: 'center',
    flexDirection: 'row',
    marginVertical: 10,
  },
  title: {
    textAlign: 'center',
    marginTop: 120,
  },
})

export default ConfirmationModal
