import { Tabs, router } from 'expo-router'
import { Alert } from 'react-native'
import { TabBarIcon } from '~/components/navigation/TabBarIcon'
import { editDirtyRef, setEditDirty } from '~/hooks/useEditDirtyState'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="characters"
        options={{
          title: 'Characters',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'people' : 'people-outline'} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            if (editDirtyRef.current) {
              e.preventDefault()
              Alert.alert(
                'Unsaved Changes',
                'You have unsaved changes. Discard them?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => {
                      setEditDirty(false)
                      if (e.target) {
                        const routeName = e.target.split('-')[0] as Parameters<typeof router.navigate>[0]
                        router.navigate(routeName)
                      }
                    },
                  },
                ],
              )
            }
          },
        }}
      />
    </Tabs>
  )
}
