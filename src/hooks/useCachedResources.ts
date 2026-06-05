import FontAwesome from '@expo/vector-icons/FontAwesome'
import Ionicons from '@expo/vector-icons/Ionicons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import * as Font from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { getDatabase } from '~/database'

export default function useCachedResources() {
  const [isLoadingComplete, setLoadingComplete] = useState(false)
  const [dbInitFailed, setDbInitFailed] = useState(false)
  const [dbInitError, setDbInitError] = useState<Error | null>(null)

  // Load any resources or data that we need prior to rendering the app
  useEffect(() => {
    async function loadResourcesAndDataAsync() {
      try {
        SplashScreen.preventAutoHideAsync()

        // Load fonts
        await Font.loadAsync({
          ...FontAwesome.font,
          ...Ionicons.font,
          ...MaterialCommunityIcons.font,
          ...MaterialIcons.font,
          'space-mono': require('../../assets/fonts/SpaceMono-Regular.ttf'),
        })

        console.log('✅ Fonts loaded successfully')
      } catch (e) {
        // We might want to provide this error information to an error reporting service
        console.warn('❌ Error loading fonts:', e)
      }

      // DB warm-up must complete BEFORE setLoadingComplete so WikiProvider
      // receives a valid wiki instance on first render.
      try {
        await getDatabase()
        console.log('✅ Database ready')
      } catch (e) {
        console.warn('❌ Error warming up database:', e)
        setDbInitFailed(true)
        setDbInitError(e instanceof Error ? e : new Error(String(e)))
      }

      setLoadingComplete(true)
      SplashScreen.hideAsync()
    }

    loadResourcesAndDataAsync()
  }, [])

  return { isLoadingComplete, dbInitFailed, dbInitError }
}
