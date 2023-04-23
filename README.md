# Yours Brightly AI  

Copyright Equational Applications LLC

## Firestore Data

### Collection: users_public
`${usersPublicCollection}/${user.uid}`
```ts
interface PublicUserData {
  uid: string; // uid from firebase auth
  name: string; // from firebase auth
  avatar: string;
  email: string; // from firebase auth
}
```

### Collection: users_private
`${usersPivateCollection}/${user.uid}`
```ts
interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  hasAcceptedTermsDate: Date | null
}
```

### Collection: characters
`${charactersCollection}/${user.uid}/${userCharactersCollection}/${userPrivate.defaultCharacter}`
```ts
interface Character {
  name: string;
  avatar: string;
  isCharacterPublic: boolean;
  context: string;
  emotions: string;
}

interface PrivateCharacterData {
  [uid: string]: {
    [characterId: string]: Character;
  };
}
```

### Collection: (multiCharacter) user_chats
`${userChatsCollection}/${user.uid}/${usersPublicCollection}/${userOfCharacterId}/${charactersCollection}/${characterId}/${messagesCollection}`
use messages interface like below

### Collection: (defaultCharacter) user_chats
`${userChatsCollection}/${user.uid}/${messagesCollection}`
```ts
interface ChatMessage {
  text: string;
  createdAt: Date | number;
  user: {
    _id: string | number;
    name: string;
    avatar: string;
  };
  image?: string;
  video?: string;
  audio?: string;
  system?: boolean;
  sent?: boolean;
  received?: boolean;
  pending?: boolean;
  quickReplies?: {
    type: "radio" | "checkbox";
    values: {
      title: string;
      value: string;
      messageId?: any;
    }[];
    keepIt?: boolean;
  };
}

interface PrivateChatData {
  [uid: string]: {
    [roomId: string]: {
      messages: {
        [messageId: string]: ChatMessage;
      };
    };
  };
}
```

### Collection: public_chat_rooms
  `${publicChatRoomsCollection}/${publicChatRoomId}/${messagesCollection}`
```ts
interface PublicChatRoomMessage {
  text: string;
  createdAt: Date | number;
  user: {
    _id: string | number;
    name: string;
    avatar: string;
  };
}

Collection: pulic_chat_rooms Document: default_room Collection: messages Document: _id _id: string | number text: string createdAt: Date | number user: _id: _id // of user or character name: string avatar: string

interface PublicChatRoomData {
  default_room: {
    messages: {
      [messageId: string]: PublicChatRoomMessage;
    };
  };
}
```



## Gifted Chat Types  
```ts
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
```