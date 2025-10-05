# Navigation

✅ Drawer Navigator (main navigation):

- Home (the tabs)
- Settings
- Profile

✅ Bottom Tab Navigator (inside Home):

- Chats
- Characters

✅ Stack Navigation (inside Characters):

- Characters list (`index.tsx`)
- Character Details (`details/[id].tsx`) - unified screen for both editing and chatting

### Navigation Tree

```plaintext
app/
├── _layout.tsx
├── accept-terms.tsx
├── index.tsx
├── privacy.tsx
├── sign-in.tsx
├── subscribe.tsx
├── terms.tsx
├── (app)/  protected routes
│   ├── _layout.tsx
│   ├── (drawer)/
│   │   ├── profile/
│   │   └── settings/
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── characters/
│   │   │   └── details/
│   │   └── chats.tsx
```



