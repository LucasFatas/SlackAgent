# Routine Instructions

## For the "Slack → Monday Backlog" routine

Paste this into the Instructions field:

```
Follow your CLAUDE.md instructions. The routine-fire-payload contains the Slack channel, thread, and task to process.
```

That's it. The full agent logic lives in `CLAUDE.md` in the `slack-agent-backlog` repo, which Claude Code reads automatically when it clones the repo.

### Routine config:
- **Name**: Slack → Monday Backlog
- **Repo**: LucasFatas/slack-agent-backlog
- **Trigger**: Call via API
- **Connectors**: Slack + monday.com (remove everything else)

## Adding new agents

Each agent gets its own repo:

```
slack-agent-{name}/
  CLAUDE.md                 ← Agent instructions (auto-loaded by Claude Code)
  .claude/commands/         ← Custom slash commands / skills
  scripts/                  ← Helper scripts if needed
  logs/                     ← Agent-specific logs
```

1. Create the repo with a CLAUDE.md
2. Create a routine pointing at that repo + API trigger
3. Add the routine's trigger ID + token to the Worker config
4. Add routing logic to the Worker (parse @agent:{name} prefix)
