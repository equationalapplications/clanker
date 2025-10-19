import { useState } from 'react'
import { StyleSheet, ScrollView, View } from 'react-native'
import { FAB } from 'react-native-paper'
import { router } from 'expo-router'

import Button from '~/components/Button'
import LoadingIndicator from '~/components/LoadingIndicator'
import { useCharacterList } from '~/hooks/useCharacterList'
import { createNewCharacter } from '~/utilities/createNewCharacter'
import { useAuth } from '~/auth/useAuth'

interface CharacterButtonProps {
  id: string
  name: string
}

export default function Characters() {
  const characterList = useCharacterList()
  const [loading, setLoading] = useState(false)
  const { user } = useAuth()

  const onPressEditCharacter = (id: string) => {
    router.push(`/characters/${id}`)
  }

  const CharacterButton = ({ id, name }: CharacterButtonProps) => (
    <Button onPress={() => onPressEditCharacter(id)} mode="contained">
      {name}
    </Button>
  )

  const onPressAddCharacter = async () => {
    if (!user) {
      return
    }

    setLoading(true)
    const result = await createNewCharacter(user.uid)
    setLoading(false)
    router.push(`/characters/${result.id}`)
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ marginTop: 30, width: '100%' }}
        contentContainerStyle={styles.scrollContentContainer}
      >
        {characterList.map((character) => (
          <CharacterButton
            key={character.id}
            id={character.id}
            name={character.name || 'Unnamed Character'}
          />
        ))}
        <LoadingIndicator disabled={!loading} />
      </ScrollView>
      <FAB style={styles.fab} icon="plus" onPress={onPressAddCharacter} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContentContainer: {
    gap: 10,
    paddingBottom: 100,
    paddingHorizontal: 20,
  },
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 0,
  },
})
