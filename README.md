# Yours Brightly AI  

Copyright Equational Applications LLC

## Documentation

- Developer Guide: [docs/](./docs)

# Yours Brightly AI  

Copyright Equational Applications LLC

## Documentation

- Developer Guide: [docs/](./docs)

## Supabase PostgreSQL Data Structure

### Table: yours_brightly
Main user profile and app-specific data for the Yours Brightly AI application.
```sql
CREATE TABLE public.yours_brightly (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    email TEXT,
    avatar_url TEXT,
    is_profile_public BOOLEAN DEFAULT false,
    credits INTEGER DEFAULT 0,
    default_character_id UUID,
    preferences JSONB DEFAULT '{}',
    profile_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);
```

```ts
interface YoursbrightlyUser {
  id: string;
  user_id: string; // References auth.users(id)
  display_name?: string;
  email?: string;
  avatar_url?: string;
  is_profile_public: boolean;
  credits: number;
  default_character_id?: string;
  preferences: Record<string, any>;
  profile_data: Record<string, any>;
  created_at: string;
  updated_at: string;
}
```

### Table: characters
Character definitions owned by users.
```sql
CREATE TABLE public.characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    appearance TEXT,
    traits TEXT,
    emotions TEXT,
    context TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

```ts
interface Character {
  id: string;
  user_id: string;
  name: string;
  avatar_url?: string;
  appearance?: string;
  traits?: string;
  emotions?: string;
  context?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}
```

### Table: messages
Chat messages between users and characters, compatible with react-native-gifted-chat.
```sql
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sender_name TEXT,
    sender_avatar_url TEXT,
    message_data JSONB DEFAULT '{}',
    UNIQUE(character_id, sender_user_id, recipient_user_id, message_id)
);
```

```ts
interface ChatMessage {
  id: string;
  character_id: string;
  sender_user_id: string;
  recipient_user_id: string;
  message_id: string; // Compatible with react-native-gifted-chat _id
  text: string;
  created_at: string;
  sender_name?: string;
  sender_avatar_url?: string;
  message_data: Record<string, any>; // Additional IMessage fields
}

// Compatible with react-native-gifted-chat IMessage format
interface IMessageCompatible {
  _id: string; // maps to message_id
  text: string;
  createdAt: Date | number;
  user: {
    _id: string; // maps to sender_user_id
    name?: string; // maps to sender_name
    avatar?: string; // maps to sender_avatar_url
  };
  // Additional fields stored in message_data JSONB
  image?: string;
  video?: string;
  audio?: string;
  system?: boolean;
  sent?: boolean;
  received?: boolean;
  pending?: boolean;
  quickReplies?: QuickReplies;
}
```

### Table: user_app_permissions
Tracks user access to different applications and terms acceptance.
```sql
CREATE TABLE public.user_app_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    terms_version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, app_name)
);
```

```ts
interface UserAppPermission {
  id: string;
  user_id: string;
  app_name: string;
  granted_at: string;
  terms_accepted_at?: string;
  terms_version?: string;
  created_at: string;
  updated_at: string;
}
```

## Migration from Firestore

The application has been migrated from Firebase Firestore to Supabase PostgreSQL for better relational data management, real-time subscriptions, and Row Level Security (RLS) policies.

### Key Migration Changes:
- **Hierarchical collections** → **Relational tables with foreign keys**
- **Document-based queries** → **SQL queries with joins**
- **Firestore real-time listeners** → **Supabase real-time subscriptions**
- **Firebase Auth rules** → **Supabase RLS policies**
- **Nested subcollections** → **Normalized tables with relationships**



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