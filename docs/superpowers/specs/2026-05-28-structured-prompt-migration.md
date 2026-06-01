# Structured Prompt Migration & Legacy Code Deletion — Phase 2 Spec

**Date:** 2026-05-28  
**Status:** Implemented
**Depends on:** `2026-05-28-edge-agent-escalation-handoff.md`  
**Scope:** Migrate Firebase Cloud Agent to structured `Content[]` arrays, enforce a "Soft Break" for old clients, and delete legacy string concatenation.

---

## 1. Problem Statement

The application currently relies on a legacy string concatenation pattern in `buildChatPrompt` inside `src/services/aiChatService.ts` when escalating to the cloud. That legacy path bundles system persona, chat history, and the current message into one massive string.

This implementation causes attention dilution, wastes tokens, and makes the model highly vulnerable to prompt injection. It also prevents Clanker from adopting the new structured prompt contract required by Phase 2.

---

## 2. Goals

- **Backend Soft Break:** Update `functions/src/generateReply.ts` to expect structured `contents` and a `systemInstruction`. If the handler receives only the legacy `prompt` string, it must return a hardcoded update message.
- **Client-Side Builder:** Implement `CharacterPromptBuilder` to build strictly typed `@google/genai` `Content[]` arrays and a clean `systemInstruction` string.
- **Burn the Ships:** Remove `buildChatPrompt` and delete all old string concatenation logic from the local codebase.

---

## 3. Backend Refactor (`functions/src/generateReply.ts`)

### 3.1 Interface Update

Update `GenerateReplyInput` to support new structured fields while keeping the legacy `prompt` field only for soft-break detection.

```typescript
export interface GenerateReplyInput {
  characterId: string;
  // Legacy payload (Triggers Soft Break)
  prompt?: string;

  // New Structured Payload
  contents?: any[]; // Array of structured Content objects
  systemInstruction?: string; // The character's persona and rules

  // Existing Phase 1 Payload
  unsyncedHistory?: SyncMessage[];
}
```

### 3.2 The Soft Break & Generation Logic

At the top of the callable handler, before any Vertex AI generation, implement the Soft Break trap. Then pass structured data into the model.

```typescript
export const generateReply = onCall(async (request) => {
  const data = request.data as GenerateReplyInput;

  // 1. The Soft Break Trap
  if (data.prompt && !data.contents) {
    return {
      text: "🤖 **System Update:** A massive brain upgrade is available! Please update Clanker to the latest version in the App Store to continue chatting.",
      messageId: `system-update-${Date.now()}`,
    };
  }

  // 2. Enforce New Contract
  if (!data.contents || !data.systemInstruction) {
    throw new HttpsError('invalid-argument', 'Structured contents and systemInstruction are required.');
  }

  // ... existing auth, billing, and unsyncedHistory insert logic ...

  // 3. Model Generation
  const response = await model.generateContent({
    contents: data.contents,
    systemInstruction: data.systemInstruction,
    // ... existing generation config ...
  });

  // ... return response ...
});
```

---

## 4. Client-Side Refactor

### 4.1 Create `src/services/CharacterPromptBuilder.ts`

Add a dedicated transformer for converting local character data and SQLite messages into Google GenAI types.

```typescript
import { Character } from '~/types';
import { LocalMessage } from '~/database/messageDatabase';

export class CharacterPromptBuilder {
  /**
   * Compiles the character's personality, traits, and strict directives into a single System Instruction string.
   */
  static buildSystemInstruction(character: Character): string {
    const personality = character.context || character.appearance || 'You are a helpful AI.';
    const traits = character.emotions ? `Traits: ${character.emotions.join(', ')}` : '';

    return [
      `You are ${character.name}.`,
      personality,
      traits,
      `CORE DIRECTIVE: Stay strictly in character. Do not break the fourth wall.`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Maps an array of local SQLite messages into the structured Content format.
   */
  static buildContentHistory(messages: LocalMessage[], userId: string): any[] {
    return messages.map((msg) => ({
      role: msg.sender_user_id === userId ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));
  }
}
```

### 4.2 Update Handoff Payload

Locate where `generateChatReply` is invoked in `src/hooks/useAIChat.ts` or `src/services/chatReplyService.ts`. Replace the legacy prompt builder usage with the structured payload.

Before:

```typescript
const prompt = buildChatPrompt(character, messages, userText);
const reply = await generateChatReply({
  characterId: character.id,
  prompt,
  unsyncedHistory,
});
```

After:

```typescript
import { CharacterPromptBuilder } from '~/services/CharacterPromptBuilder';

const systemInstruction = CharacterPromptBuilder.buildSystemInstruction(character);
const historyContents = CharacterPromptBuilder.buildContentHistory(priorMessages, userId);
const contents = [
  ...historyContents,
  { role: 'user', parts: [{ text: userText }] },
];

const reply = await generateChatReply({
  characterId: character.id,
  systemInstruction,
  contents,
  unsyncedHistory,
});
```

### 4.3 Delete Legacy Code

- Remove the `buildChatPrompt` function from `src/services/aiChatService.ts` entirely.
- Remove any leftover unused imports in `aiChatService.ts` and `chatReplyService.ts`.

---

## 5. Acceptance Criteria

- **Old Client Request:** Sending `prompt` with no `contents` returns the hardcoded update string immediately, and Vertex AI is not invoked.
- **New Client Request:** Sending `contents` + `systemInstruction` correctly passes the structured arrays to Vertex AI and returns an in-character response.
- **Legacy Code Check:** `buildChatPrompt` is fully removed from the local codebase.
