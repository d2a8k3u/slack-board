# How it works

## What runs where

The plugin has three parts, all on your machine and all started by Claude Code:

- A hooks module inside Claude Code. It syncs Slack through the claude.ai Slack connector or the official Slack plugin, asks Claude for drafts, rankings and summaries, runs your prompts from Actions as a Claude agent, and runs the steps you approve through your connectors.
- A small server that Claude Code starts as the plugin's MCP server. It keeps the board in a SQLite file and serves the board page on 127.0.0.1.
- The board page in your browser. It shows the notifications.

The hooks module and the server talk over MCP. When several Claude Code sessions are open, each starts its own copy; they share one database, only one of them syncs at a time, and each request you make is handled by exactly one of them.

## What Claude is asked

All model calls run on the Claude account Claude Code is signed in with.

| Call | Model | When |
| --- | --- | --- |
| Draft a reply | Sonnet | when you press Draft or Draft thread reply |
| Work on a prompt from Actions | Sonnet agent, at most 20 turns and 10 minutes | when you press Run |
| Rank cards by priority | Haiku | after a sync, for new cards and cards with new messages, up to 20 cards per call |
| Summarise a ticket | Haiku | when you press Summarize with Claude |

Ticket details and the conversation history come straight from Jira and Slack without a model call. Send as written and the React now buttons send without Claude.

A prompt from Actions runs as a background agent in the Claude Code session that picks it up. It gets the tools of your claude.ai connectors and the official Slack plugin, and nothing else: no files, no shell, not the board's own tools. A call runs only when the connector marks the tool as read-only; every other call is refused, and the agent puts it in its proposal instead. Its final answer goes to the card, not into your Claude Code chat.

Slack messages, tickets and tool results are passed to Claude as data; Claude is told never to follow instructions inside them. Every proposal is checked before you see it and again when you approve it: Slack and Jira steps against a fixed list, and a call of another tool only when it belongs to one of your claude.ai connectors or the official Slack plugin.

## What is stored

The database lives in the plugin's data folder under `~/.claude/plugins/data/`. It holds the open cards with their messages, the last 30 messages of each opened conversation, the messages in Other messages for up to `lookback_days` and, per channel, the latest message you marked read, your prompts and Claude's answers, ticket details and summaries, the people and channels you can write to (names and IDs only), the IDs of handled conversations for 30 days so they do not come back, and the requests waiting for Claude. A card, its conversation and its prompts are deleted once you handle it. Email addresses and profile details are never stored.

## Security

The board page listens on 127.0.0.1 only. Every API request needs a random secret that `/board` puts in the link and the page keeps in the tab's session storage. Requests with another host name or from another site are refused, which blocks other web pages and DNS rebinding from reaching the board. Nothing is sent to Slack, Jira or any other connector without your click on the exact text, reaction or steps shown.

## Limits

- The board syncs only while a Claude Code session is open.
- While Claude works on a prompt, the card takes no reply, reaction or other prompt until the answer is in.
- Avatars show initials: the Slack connector does not return profile photos.
- A thread you once wrote in keeps bringing its new replies to the board; Ignore a busy thread to quiet it until the next message.
- A sync loads at most 100 channel messages, thread replies included. When a sync finds more, Other messages says some are missing, and an `@here`, `@channel` or `@everyone` among the missing ones gets no card.
- A mention of a user group you belong to, such as `@backend`, brings no card: the Slack connector does not say which groups you are in.
- The board cannot tell what you already read in Slack or which channels you muted, so Other messages shows them all until you mark them read on the board.
