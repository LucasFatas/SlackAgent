export interface Env {
	THREADS: KVNamespace;
	SLACK_SIGNING_SECRET: string;
	SLACK_BOT_TOKEN: string;
	AGENTS: string; // JSON: { "prefix": { "trigger_id": "...", "token": "..." }, ... }
	ALLOWED_USERS: string; // comma-separated Slack user IDs
}

// ─── Agent routing ───────────────────────────────────────────────────────────

interface AgentConfig {
	trigger_id: string;
	token: string;
}

interface AgentsMap {
	[prefix: string]: AgentConfig;
}

function resolveAgent(
	text: string,
	agents: AgentsMap,
): { agent: AgentConfig; taskText: string } | null {
	// Try to match "prefix: rest of message" or "prefix rest of message"
	const match = text.match(/^(\w+)[:\s]\s*(.*)/s);
	if (match) {
		const prefix = match[1].toLowerCase();
		if (agents[prefix]) {
			return { agent: agents[prefix], taskText: match[2].trim() };
		}
	}

	// No prefix matched — use default agent (keyed as "_default")
	if (agents["_default"]) {
		return { agent: agents["_default"], taskText: text.trim() };
	}

	return null;
}

// ─── Slack signature verification ────────────────────────────────────────────

async function verifySlackSignature(
	request: Request,
	signingSecret: string,
): Promise<{ valid: boolean; body: string }> {
	const body = await request.text();
	const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
	const signature = request.headers.get("x-slack-signature") ?? "";

	// Reject requests older than 5 minutes (replay protection)
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - parseInt(timestamp)) > 300) {
		return { valid: false, body };
	}

	const baseString = `v0:${timestamp}:${body}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(signingSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
	const hex = "v0=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

	return { valid: hex === signature, body };
}

// ─── Routine firing ──────────────────────────────────────────────────────────

interface RoutineFireResponse {
	type: string;
	claude_code_session_id: string;
	claude_code_session_url: string;
}

async function fireRoutine(
	triggerId: string,
	token: string,
	text: string,
): Promise<RoutineFireResponse> {
	const resp = await fetch(
		`https://api.anthropic.com/v1/claude_code/routines/${triggerId}/fire`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "experimental-cc-routine-2026-04-01",
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ text }),
		},
	);

	if (!resp.ok) {
		const err = await resp.text();
		throw new Error(`Routine fire failed (${resp.status}): ${err}`);
	}

	return resp.json();
}

// ─── Slack API helpers ───────────────────────────────────────────────────────

async function slackPost(method: string, token: string, body: Record<string, unknown>) {
	const resp = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	return resp.json() as Promise<Record<string, unknown>>;
}

async function postToThread(token: string, channel: string, threadTs: string, text: string) {
	return slackPost("chat.postMessage", token, {
		channel,
		thread_ts: threadTs,
		text,
	});
}

async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
	return slackPost("reactions.add", token, {
		channel,
		timestamp,
		name: emoji,
	});
}

// ─── Event handling ──────────────────────────────────────────────────────────

interface SlackEvent {
	type: string;
	subtype?: string;
	user?: string;
	text?: string;
	channel?: string;
	ts?: string;
	thread_ts?: string;
	bot_id?: string;
	files?: Array<{ url_private: string; name: string; mimetype: string }>;
}

async function handleEvent(event: SlackEvent, env: Env, ctx: ExecutionContext) {
	// Ignore bot messages
	if (event.bot_id || event.subtype === "bot_message") return;

	// Check allowed users
	const allowedUsers = new Set(env.ALLOWED_USERS.split(",").map((u) => u.trim()));
	if (!event.user || !allowedUsers.has(event.user)) return;

	const channel = event.channel;
	const messageTs = event.ts;
	if (!channel || !messageTs) return;

	// The thread key: thread_ts for replies, ts for root messages
	const threadTs = event.thread_ts ?? messageTs;

	const isAppMention = event.type === "app_mention";
	const isThreadReply = event.type === "message" && event.thread_ts;

	// For thread replies without @mention, only respond if this thread is tracked
	let trackedAgent: string | null = null;
	if (isThreadReply && !isAppMention) {
		trackedAgent = await env.THREADS.get(`thread:${channel}:${threadTs}`);
		if (!trackedAgent) return;
	}

	// For non-threaded messages, require @mention — don't react to every message in the channel
	if (!isAppMention && !isThreadReply) return;

	// Strip bot mention, get clean text
	const cleanText = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
	if (!cleanText) return;

	// Parse agents config
	const agents: AgentsMap = JSON.parse(env.AGENTS);

	// Resolve which agent to use
	let agent: AgentConfig;
	let taskText: string;

	if (trackedAgent && trackedAgent !== "active") {
		// Follow-up in a tracked thread — use the same agent as the original
		const parsed = JSON.parse(trackedAgent) as { prefix: string };
		agent = agents[parsed.prefix] ?? agents["_default"];
		taskText = cleanText;
	} else {
		// New mention — route by prefix
		const resolved = resolveAgent(cleanText, agents);
		if (!resolved) return;
		agent = resolved.agent;
		taskText = resolved.taskText;

		// Find which prefix matched for thread tracking
		const matchedPrefix = Object.keys(agents).find((k) => agents[k] === agent) ?? "_default";
		await env.THREADS.put(
			`thread:${channel}:${threadTs}`,
			JSON.stringify({ prefix: matchedPrefix }),
			{ expirationTtl: 7 * 24 * 60 * 60 },
		);
	}

	// React with eyes to acknowledge
	ctx.waitUntil(addReaction(env.SLACK_BOT_TOKEN, channel, messageTs, "eyes"));

	// Build the fire payload
	const fireText = [
		`channel:${channel}`,
		`thread_ts:${threadTs}`,
		`user:${event.user}`,
		`task: ${taskText}`,
	].join("\n");

	try {
		await fireRoutine(agent.trigger_id, agent.token, fireText);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		ctx.waitUntil(
			postToThread(env.SLACK_BOT_TOKEN, channel, threadTs, `Failed to start agent: ${message}`),
		);
	}
}

// ─── Worker entry point ──────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		// Verify Slack signature
		const { valid, body } = await verifySlackSignature(request, env.SLACK_SIGNING_SECRET);
		if (!valid) {
			return new Response("Invalid signature", { status: 401 });
		}

		const payload = JSON.parse(body);

		// Handle Slack URL verification challenge
		if (payload.type === "url_verification") {
			return new Response(JSON.stringify({ challenge: payload.challenge }), {
				headers: { "Content-Type": "application/json" },
			});
		}

		// Handle event callbacks
		if (payload.type === "event_callback") {
			const event = payload.event as SlackEvent;

			// Dedup: Slack may retry. Use event ID + KV to prevent double-fires
			const eventId = payload.event_id as string;
			if (eventId) {
				const seen = await env.THREADS.get(`event:${eventId}`);
				if (seen) return new Response("ok");
				await env.THREADS.put(`event:${eventId}`, "1", { expirationTtl: 3600 });
			}

			// Handle the event in the background
			ctx.waitUntil(handleEvent(event, env, ctx));
		}

		// Always return 200 within 3 seconds
		return new Response("ok");
	},
} satisfies ExportedHandler<Env>;
