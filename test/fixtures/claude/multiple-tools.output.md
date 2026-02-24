# Transcript

**Source**: `test/fixtures/claude/multiple-tools.input.jsonl`
**Adapter**: claude-code

---

## User

Check the files

**Tools**:
- Read `/src/main.ts` <!-- tool:tool-1 -->
- Glob `**/*.test.ts` <!-- tool:tool-2 -->
- Bash `List files` <!-- tool:tool-3 -->