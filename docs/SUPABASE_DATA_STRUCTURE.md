# Supabase PostgreSQL Data Structure

This document contains the primary Supabase/Postgres table definitions and TypeScript types used by the Yours Brightly application. Implementation-level SQL and type information lives here (moved from the root README to keep the repository root concise).

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

### Table: user_app_subscriptions
Subscription management for multi-tenant access control.
```sql
CREATE TABLE public.user_app_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    plan_tier TEXT NOT NULL CHECK (plan_tier IN ('free', 'monthly_20', 'monthly_50', 'payg')),
    plan_status TEXT NOT NULL DEFAULT 'active' CHECK (plan_status IN ('active', 'cancelled', 'expired')),
    plan_start_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    plan_renewal_at TIMESTAMP WITH TIME ZONE,
    credits_remaining INTEGER DEFAULT 0,
    billing_provider TEXT,
    billing_provider_id TEXT,
    billing_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, app_name)
);
```

```ts
interface UserAppSubscription {
  id: string;
  user_id: string; // References auth.users(id)
  app_name: string;
  plan_tier: 'free' | 'monthly_20' | 'monthly_50' | 'payg';
  plan_status: 'active' | 'cancelled' | 'expired';
  plan_start_at: string;
  plan_renewal_at?: string;
  credits_remaining: number;
  billing_provider?: string;
  billing_provider_id?: string;
  billing_metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}
```

If you need a specific implementation reference or example queries, search the `docs/` folder or open an issue to request additional examples.
