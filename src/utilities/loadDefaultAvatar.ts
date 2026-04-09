import * as FileSystem from 'expo-file-system/legacy'
import { Asset } from 'expo-asset'

/**
 * Load the default character avatar as a base64-encoded string
 * This image is bundled with the app in assets/adaptive-icon-200x200.png
 */
export async function loadDefaultCharacterAvatar(): Promise<string> {
  try {
    // Load the asset bundled with the app
    const [asset] = await Asset.loadAsync(require('../../assets/adaptive-icon-200x200.webp'))
    
    if (!asset.localUri && !asset.uri) {
      console.warn('Failed to get asset URI for default avatar')
      return ''
    }

    const fileUri = asset.localUri || asset.uri
    
    // Read the file as base64 using legacy API
    const base64Data = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    })

    return base64Data
  } catch (error) {
    console.error('Failed to load default character avatar:', error)
    // Return empty string if loading fails - avatar will show fallback
    return ''
  }
}

