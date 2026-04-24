import { Tabs, router, useNavigation } from 'expo-router'
import React from 'react'
import { Alert } from 'react-native'
import { TabBarIcon } from '~/components/navigation/TabBarIcon'
import { editDirtyRef, setEditDirty } from '~/hooks/useEditDirtyState'

export default function TabLayout() {
  const parentNavigation = useNavigation()

  // Override the drawer header title so the route-group name "(tabs)" never leaks through
  React.useLayoutEffect(() => {
    parentNavigation.setOptions({ headerTitle: 'Chat' })
  }, [parentNavigation])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
            <TabBarIcon name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} />
          ),
        }}
      />
        <Tabs.Screen
          name="talk"
          options={{
            title: 'Talk',
            tabBarIcon: ({ color, focused }: { color: string; focused: boolean }) => (
              <TabBarIcon name={focused ? 'mic' : 'mic-outline'} color={color} />
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
                Alert.alert('Unsaved Changes', 'You have unsaved changes. Discard them?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => {
                      setEditDirty(false)
                      router.navigate('/characters/list')
                    },
                  },
                ])
              }
            },
          }}
        />
    </Tabs>
  )
}
