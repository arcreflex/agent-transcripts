# Transcript

**Source**: `test/fixtures/pi-coding-agent/basic-conversation.input.jsonl`
**Adapter**: pi-coding-agent

---

## User

Hello, can you help me with TypeScript?

## Assistant

Of course! I'd be happy to help with TypeScript. What do you need?

## User

How do I define a generic type?

## Assistant

You can define a generic type using angle brackets:

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
```

The `T` is a type parameter that gets filled in when you use the type.
