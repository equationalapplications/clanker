import { supabaseClient } from '../config/supabaseClient'
import { generateImageWithVertexAI } from './vertexAIService'

export interface ImageGenerationOptions {
  prompt: string
  characterId: string
  userId: string
  width?: number
  height?: number
  maxFileSizeKB?: number
  quality?: number
}

export interface GeneratedImageResult {
  imageUrl: string
  storagePath: string
  publicUrl: string
}

/**
 * Generate an image using Firebase Vertex AI and store it in Supabase Storage
 * Optimized for small file sizes (under 140KB) using WebP format
 */
export const generateAndStoreCharacterImage = async ({
  prompt,
  characterId,
  userId,
  width = 200,
  height = 200,
  maxFileSizeKB = 140,
  quality = 85,
}: ImageGenerationOptions): Promise<GeneratedImageResult> => {
  try {
    console.log('🎨 Starting optimized image generation for character:', characterId)

    // 1. Generate image using Vertex AI with small dimensions
    const imageBase64 = await generateImageWithVertexAI({
      prompt,
      width,
      height,
      outputFormat: 'webp',
    })

    // 2. Convert and compress to WebP format
    const compressedBlob = await convertAndCompressToWebP(imageBase64, quality, maxFileSizeKB)

    // 3. Verify file size
    const fileSizeKB = compressedBlob.size / 1024
    console.log(`📏 Compressed image size: ${fileSizeKB.toFixed(2)}KB (limit: ${maxFileSizeKB}KB)`)

    if (fileSizeKB > maxFileSizeKB) {
      console.warn(
        `⚠️ Image size (${fileSizeKB.toFixed(2)}KB) exceeds limit (${maxFileSizeKB}KB), but proceeding`,
      )
    }

    // 4. Create storage path with WebP extension
    const timestamp = Date.now()
    const filename = `character-${characterId}-${timestamp}.webp`
    const storagePath = `character-avatars/${userId}/${filename}`

    // 5. Upload to Supabase Storage
    const { error: uploadError } = await supabaseClient.storage
      .from('yours-brightly-images')
      .upload(storagePath, compressedBlob, {
        contentType: 'image/webp',
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('Failed to upload image to Supabase Storage:', uploadError)
      throw new Error(`Storage upload failed: ${uploadError.message}`)
    }

    // 6. Get public URL
    const { data: urlData } = supabaseClient.storage
      .from('yours-brightly-images')
      .getPublicUrl(storagePath)

    if (!urlData.publicUrl) {
      throw new Error('Failed to get public URL for uploaded image')
    }

    console.log('✅ Optimized image generated and stored successfully:', {
      storagePath,
      publicUrl: urlData.publicUrl,
      fileSizeKB: fileSizeKB.toFixed(2) + 'KB',
    })

    return {
      imageUrl: urlData.publicUrl,
      storagePath,
      publicUrl: urlData.publicUrl,
    }
  } catch (error) {
    console.error('Error in generateAndStoreCharacterImage:', error)
    throw error
  }
}

/**
 * Update character avatar URL in database after successful image generation
 */
export const updateCharacterAvatar = async (
  characterId: string,
  imageUrl: string,
): Promise<void> => {
  try {
    const { error } = await supabaseClient
      .from('yours_brightly_characters')
      .update({ avatar: imageUrl })
      .eq('id', characterId)

    if (error) {
      console.error('Failed to update character avatar:', error)
      throw new Error(`Database update failed: ${error.message}`)
    }

    console.log('✅ Character avatar updated successfully:', characterId)
  } catch (error) {
    console.error('Error updating character avatar:', error)
    throw error
  }
}

/**
 * Delete old character image from storage (cleanup)
 */
export const deleteCharacterImage = async (storagePath: string): Promise<void> => {
  try {
    const { error } = await supabaseClient.storage
      .from('yours-brightly-images')
      .remove([storagePath])

    if (error) {
      console.warn('Failed to delete old image from storage:', error)
      // Don't throw error for cleanup operations
    } else {
      console.log('🗑️ Old character image deleted:', storagePath)
    }
  } catch (error) {
    console.warn('Error deleting character image:', error)
    // Don't throw error for cleanup operations
  }
}

/**
 * Get signed URL for private image access (if needed)
 */
export const getSignedImageUrl = async (
  storagePath: string,
  expiresIn: number = 3600,
): Promise<string> => {
  try {
    const { data, error } = await supabaseClient.storage
      .from('yours-brightly-images')
      .createSignedUrl(storagePath, expiresIn)

    if (error) {
      throw new Error(`Failed to create signed URL: ${error.message}`)
    }

    return data.signedUrl
  } catch (error) {
    console.error('Error creating signed URL:', error)
    throw error
  }
}

/**
 * Convert base64 image to WebP format with compression
 * Iteratively reduces quality until file size is under the limit
 */
async function convertAndCompressToWebP(
  base64Data: string,
  initialQuality: number = 85,
  maxFileSizeKB: number = 140,
): Promise<Blob> {
  // Remove data URL prefix if present
  const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '')

  // Create an image element to load the base64 data
  const img = new Image()
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Failed to get canvas context for image compression')
  }

  return new Promise((resolve, reject) => {
    img.onload = async () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      let quality = initialQuality
      let blob: Blob | null = null
      let attempts = 0
      const maxAttempts = 10

      // Iteratively reduce quality until file size is acceptable
      while (attempts < maxAttempts) {
        blob = await new Promise<Blob | null>((resolveBlob) => {
          canvas.toBlob(resolveBlob, 'image/webp', quality / 100)
        })

        if (!blob) {
          reject(new Error('Failed to convert image to WebP'))
          return
        }

        const fileSizeKB = blob.size / 1024
        console.log(
          `🔄 Compression attempt ${attempts + 1}: ${fileSizeKB.toFixed(2)}KB at ${quality}% quality`,
        )

        if (fileSizeKB <= maxFileSizeKB || quality <= 10) {
          console.log(`✅ Final image: ${fileSizeKB.toFixed(2)}KB at ${quality}% quality`)
          resolve(blob)
          return
        }

        // Reduce quality for next attempt
        quality = Math.max(10, quality - 15)
        attempts++
      }

      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to compress image to acceptable size'))
      }
    }

    img.onerror = () => {
      reject(new Error('Failed to load image for compression'))
    }

    // Load the image
    img.src = `data:image/png;base64,${cleanBase64}`
  })
}

/**
 * List all images for a character (for management)
 */
export const listCharacterImages = async (
  userId: string,
  characterId?: string,
): Promise<string[]> => {
  try {
    const { data, error } = await supabaseClient.storage
      .from('yours-brightly-images')
      .list(`character-avatars/${userId}`, {
        limit: 100,
        offset: 0,
      })

    if (error) {
      throw new Error(`Failed to list images: ${error.message}`)
    }

    return data?.map((file) => `character-avatars/${userId}/${file.name}`) || []
  } catch (error) {
    console.error('Error listing character images:', error)
    throw error
  }
}
