# Setup Steps

## What's already done
- [x] Cloudflare Worker deployed at `https://slack-agent.slack-agent-worker.workers.dev`
- [x] KV namespace created for thread tracking
- [x] ALLOWED_USERS secret set (your Slack ID: U08TBTZ17MX)
- [x] Routine instructions drafted

## Manual steps needed

### Step 1: Create the Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From a manifest**
3. Select your Workwize workspace
4. Paste the contents of `slack-app-manifest.yaml`
5. Click **Create**
6. Go to **Basic Information** → copy the **Signing Secret**
7. Go to **OAuth & Permissions** → click **Install to Workspace** → copy the **Bot User OAuth Token** (starts with `xoxb-`)

Then set the secrets:
```bash
cd ~/Desktop/SlackAgent
echo "YOUR_SIGNING_SECRET" | npx wrangler secret put SLACK_SIGNING_SECRET
echo "xoxb-YOUR-BOT-TOKEN" | npx wrangler secret put SLACK_BOT_TOKEN
```

### Step 2: Create the Claude Routine

1. Go to https://claude.ai/code/routines
2. Click **New routine**
3. **Name**: `Slack Agent`
4. **Instructions**: Copy from `routine-instructions.md` (the section after the heading, not the heading itself)
5. **Repository**: Select this repo (SlackAgent) once it's pushed to GitHub
6. **Trigger**: Select **Call via API** → save → copy the URL and generate a token
7. **Connectors**: Keep Slack + add whatever else you want (PostHog, Weld, etc.)
8. **Create**

Then set the secrets:
```bash
# The trigger ID from the routine URL (trig_01XXXX...)
echo "trig_01XXXX" | npx wrangler secret put ROUTINE_TRIGGER_ID

# The API token generated in the routine form
echo "sk-ant-oat01-XXXX" | npx wrangler secret put ROUTINE_API_TOKEN
```

### Step 3: Push this repo to GitHub

```bash
cd ~/Desktop/SlackAgent
gh repo create SlackAgent --public --source=. --push
```

(The routine needs this repo on GitHub to clone it for the logs directory.)

### Step 4: Redeploy

After setting all secrets:
```bash
npx wrangler deploy
```

### Step 5: Test

1. Go to a Slack channel where the bot is installed
2. Type: `@claude-agent hello, can you read this thread?`
3. You should see:
   - 👀 reaction on your message
   - "Working on it → [session URL]" reply
   - The routine runs and posts a result to the thread
