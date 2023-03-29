import React from "react"
import { StyleSheet } from "react-native"
import { Button, Dialog, Paragraph, Portal } from "react-native-paper"

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
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Paragraph>{message}</Paragraph>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onCancel}>Cancel</Button>
          <Button onPress={onConfirm}>Confirm</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  actions: {
    justifyContent: "space-around",
  },
})

export default ConfirmationModal
