import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, type ViewStyle } from 'react-native'
import ProviderButton from '~/auth/AuthProviderButton'
import { initializeGoogleSignIn, renderGoogleSignInButton } from '~/auth/googleSignin.web'

type ButtonState = 'idle' | 'loading' | 'error'

type Props = {
  onLoadingChange?: (loading: boolean) => void
  /** Disables interaction while another provider sign-in is in flight (e.g. Apple). */
  disabled?: boolean
  style?: ViewStyle
}

export default function GoogleSignInButton({ onLoadingChange, disabled, style }: Props) {
  const containerRef = useRef<View>(null)
  const [buttonState, setButtonState] = useState<ButtonState>('idle')
  const [initFailed, setInitFailed] = useState(false)
  const onLoadingChangeRef = useRef(onLoadingChange)
  onLoadingChangeRef.current = onLoadingChange

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      try {
        await initializeGoogleSignIn({
          onCredentialStart: () => {
            if (cancelled) return
            setButtonState('loading')
            onLoadingChangeRef.current?.(true)
          },
          onCredentialSuccess: () => {
            if (cancelled) return
            setButtonState('idle')
            onLoadingChangeRef.current?.(false)
          },
          onCredentialError: (error: Error) => {
            if (cancelled) return
            console.warn('Google Sign-In error:', error)
            setButtonState('error')
            onLoadingChangeRef.current?.(false)
          },
        })

        if (cancelled) return

        const domNode = containerRef.current as unknown as HTMLElement | null
        if (domNode) {
          renderGoogleSignInButton(domNode)
        }
      } catch (err) {
        if (cancelled) return
        console.warn('Google Sign-In initialization failed:', err)
        setInitFailed(true)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [])

  if (initFailed) {
    return (
      <View style={style}>
        <ProviderButton type="google" onPress={() => {}} disabled>
          Google
        </ProviderButton>
        <Text style={styles.caption}>
          Google Sign-In unavailable. Please refresh or try Apple.
        </Text>
      </View>
    )
  }

  return (
    <View
      style={[styles.wrap, disabled && styles.wrapDisabled, style]}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      <View ref={containerRef} style={styles.container} />
      {buttonState === 'error' && (
        <Text style={styles.caption}>Sign-in failed. Please try again.</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  wrapDisabled: {
    opacity: 0.55,
  },
  container: {
    minHeight: 44,
    width: '100%',
    marginVertical: 5,
  },
  caption: {
    marginTop: 6,
    fontSize: 12,
    color: '#cc0000',
    textAlign: 'center',
    maxWidth: 300,
    alignSelf: 'center',
  },
})
