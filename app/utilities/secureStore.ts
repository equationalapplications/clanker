import * as SecureStore from "expo-secure-store"

export const refreshTokenKey = "refresh_token"

export async function save(key: string, value: string) {
  await SecureStore.setItemAsync(key, value)
}

export async function getValueFor(key: string): Promise<string | null> {
  const result = await SecureStore.getItemAsync(key)
  return result
}
