import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View, Text, StyleSheet, type ViewStyle } from 'react-native'
import { initializeAppleSignIn } from '~/auth/appleSignin.web'

type ButtonState = 'idle' | 'loading' | 'error'

type Props = {
  onLoadingChange?: (loading: boolean) => void
  /** Auth machine busy states (initializing / bootstrapping); shows overlay on web. */
  loading?: boolean
  /** Disables interaction while another provider sign-in is in flight (e.g. Google). */
  disabled?: boolean
  style?: ViewStyle
}

export default function AppleSignInButton(props: Props) {
  if (!process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID || !process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI) {
    return null
  }
  return <AppleSignInButtonInner {...props} />
}

function AppleSignInButtonInner({ onLoadingChange, loading, disabled, style }: Props) {
  const containerRef = useRef<View>(null)
  const [buttonState, setButtonState] = useState<ButtonState>('idle')
  const [initFailed, setInitFailed] = useState(false)
  const onLoadingChangeRef = useRef(onLoadingChange)
  onLoadingChangeRef.current = onLoadingChange

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    const init = async () => {
      try {
        const domNode = containerRef.current as unknown as HTMLElement | null
        if (domNode && typeof domNode.setAttribute === 'function') {
          domNode.id = 'appleid-signin'
          domNode.setAttribute('data-color', 'black')
          domNode.setAttribute('data-border', 'false')
          domNode.setAttribute('data-type', 'sign in')
          domNode.setAttribute('data-width', '300')
          domNode.setAttribute('data-height', '44')
          domNode.setAttribute('data-border-radius', '4')
        }

        const resultCleanup = await initializeAppleSignIn({
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
            console.warn('Apple Sign-In error:', error)
            setButtonState('error')
            onLoadingChangeRef.current?.(false)
          },
        })

        if (cancelled) {
          resultCleanup()
          return
        }

        cleanup = resultCleanup
      } catch (err) {
        if (cancelled) return
        console.warn('Apple Sign-In initialization failed:', err)
        setInitFailed(true)
      }
    }

    void init()
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  if (initFailed) {
    return (
      <View style={[styles.wrap, styles.wrapDisabled, style]}>
        <View style={styles.container}>
          <Text style={styles.caption} testID="apple-signin-unavailable-caption">
            Apple sign-in is unavailable right now. Please try again later.
          </Text>
        </View>
      </View>
    )
  }

  const credentialBusy = buttonState === 'loading'
  const busy = disabled || loading || credentialBusy
  const showLoadingOverlay = loading || credentialBusy

  return (
    <View
      style={[styles.wrap, busy && styles.wrapDisabled, style]}
      pointerEvents={busy ? 'none' : 'auto'}
    >
      <View ref={containerRef} style={styles.container} />
      {showLoadingOverlay ? (
        <View style={styles.loadingOverlay} pointerEvents="none" testID="apple-signin-loading-overlay">
          <ActivityIndicator />
        </View>
      ) : null}
      {buttonState === 'error' && (
        <Text style={styles.caption}>Sign-in failed. Please try again.</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    position: 'relative',
  },
  wrapDisabled: {
    opacity: 0.55,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
  container: {
    minHeight: 44,
    width: '100%',
    marginVertical: 5,
    alignItems: 'center',
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
