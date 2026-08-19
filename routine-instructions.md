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

## Approval-gate pattern (for agents that need human sign-off before deploying)

Routine containers are ephemeral — each fire gets a fresh clone. Uncommitted code
is destroyed when the run ends. If your agent has a "build → wait for approval → deploy"
workflow, the build run **must** persist its work in git before stopping:

### Build run (before posting screenshots / requesting approval):
```
1. git checkout -b claude/thread-{thread_ts}
2. git add -A && git commit -m "feat: {description} [awaiting approval]"
3. git push origin claude/thread-{thread_ts}
4. Post to Slack: "Validated on branch `claude/thread-{thread_ts}`. Reply approved to deploy."
5. Stop — the container will be reclaimed.
```

### Deploy run (after human replies "approved"):
```
1. Read the Slack thread → extract branch name from the approval-request message
2. git fetch origin && git checkout claude/thread-{thread_ts}
3. Verify the code matches what was shown in screenshots
4. git checkout main && git merge claude/thread-{thread_ts} && git push origin main
5. Post confirmation to thread
6. git push origin --delete claude/thread-{thread_ts}   (cleanup)
```

The branch name is deterministic from `thread_ts`, so the deploy run can locate it
even without parsing the message. The `task:` field in the fire payload is context,
not the source of truth — always read the thread.
