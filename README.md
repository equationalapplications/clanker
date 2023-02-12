# Yours Brightly AI  

Copyright Equational Applications LLC

## Firestore Data  

Collection: users_public
    Document: uid 
        uid: // uid from firebase auth
        name: displayName // from firebase auth
        avatar: string
        email: string // from firebase auth

Collection: users_private
    Document: uid // private data by uid
        uid: uid // from firebase
        credits: number
        isProfilePublic: boolean

Collection: simulated_characters
    Document: uid // private data by uid
        Collection: users_simulated_characters
            Document: _id
                _id: string || number
                name: string
                avatar: string
                isCharacterPublic: boolean

Collection: messages
    Document: _id
        _id: string | number
        text: string
        createdAt: Date | number
        user:
            _id: _id // of user or character
            name: string
            avatar: string


Collection: solo_chat_rooms
    Document: uid // private data by uid
        Collection: messages
            Document: _id
                _id: _id // of message

Collection: social_chat_rooms
    Document: default_room
        Collection: messages



## Gifted Chat Types  

export type Omit<T, K> = Pick<T, Exclude<keyof T, K>>

export interface LeftRightStyle<T> {
  left?: StyleProp<T>
  right?: StyleProp<T>
}

type renderFunction = (x: any) => JSX.Element

export interface User {
  _id: string | number
  name?: string
  avatar?: string | number | renderFunction
}

export interface IMessage {
  _id: string | number
  text: string
  createdAt: Date | number
  user: User
  image?: string
  video?: string
  audio?: string
  system?: boolean
  sent?: boolean
  received?: boolean
  pending?: boolean
  quickReplies?: QuickReplies
}

export interface Reply {
  title: string
  value: string
  messageId?: any
}

export interface QuickReplies {
  type: 'radio' | 'checkbox'
  values: Reply[]
  keepIt?: boolean
}

export type IChatMessage = IMessage

export interface MessageVideoProps<TMessage extends IMessage> {
  currentMessage?: TMessage
  containerStyle?: StyleProp<ViewStyle>
  videoStyle?: StyleProp<ViewStyle>
  videoProps?: object
  lightboxProps?: LightboxProps
}

export interface MessageAudioProps<TMessage extends IMessage> {
  currentMessage?: TMessage
  containerStyle?: StyleProp<ViewStyle>
  audioStyle?: StyleProp<ViewStyle>
  audioProps?: object
}