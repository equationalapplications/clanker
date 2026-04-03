import { useLocalSearchParams } from 'expo-router'
import ChatView from '~/components/ChatView'

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ChatView characterId={id || ''} />
}
