---
"@agentskillmania/colts": minor
---

Skill instructions now persist as load_skill tool results in conversation history (A-skill-calls-B no longer loses A). Breaking changes: removed the return_skill tool and RETURN_SKILL signal; SkillState slimmed to { current } (dropped loadedInstructions and stack); load_skill tool result now returns the instruction text instead of "Skill 'X' loaded"; context compressor exempts load_skill results from prune/truncate; DefaultMessageAssembler no longer injects active skill into the reminder.
