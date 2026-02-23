# Transcript

**Source**: `test/fixtures/pi-coding-agent/with-thinking.input.jsonl`
**Adapter**: pi-coding-agent

---

## User

What's the best sorting algorithm for nearly-sorted data?

## Assistant


<details>
<summary>Thinking...</summary>

The user is asking about sorting algorithms for nearly-sorted data. Insertion sort is O(n) for nearly sorted data, which makes it ideal. Timsort also handles this well since it detects runs.
</details>

For nearly-sorted data, **insertion sort** is excellent — it runs in O(n) time when the data is almost sorted. Python's built-in Timsort also handles this case well since it detects existing sorted runs.
