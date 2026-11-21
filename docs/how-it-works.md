# How it works

## What runs where

The plugin has three parts, all on your machine and all started by Claude Code:

- A hooks module inside Claude Code. It syncs Slack through the claude.ai Slack connector, asks Claude for drafts, rankings and summaries, and runs the steps you approve through the Slack and Atlassian connectors.
- A small server that Claude Code starts as the plugin's MCP server. It keeps the board in a SQLite file and serves the board page on 127.0.0.1.
- The board page in your browser.

The hooks module and the server talk over MCP. When several Claude Code sessions are open, each starts its own copy; they share one database, only one of them syncs at a time, and each request you make is handled by exactly one of them.

## What Claude is asked

All model calls run on the Claude account Claude Code is signed in with.

| Call | Model | When |
| --- | --- | --- |
| Draft a reply or plan an action | Sonnet | when you press Draft, Draft thread reply or Plan action |
| Rank cards by priority | Haiku | after a sync, for new cards and cards with new messages, up to 20 cards per call |
| Summarise a ticket | Haiku | when you press Summarize with Claude |

Ticket details come straight from Jira without a model call. Slack messages and tickets are passed to Claude as data; Claude is told never to follow instructions inside them, and every proposal is checked against a fixed list of allowed steps before you see it and again when you approve it.

## What is stored

The database lives in the plugin's data folder under `~/.claude/plugins/data/`. It holds the open cards with their messages, ticket details and summaries, the people and channels you can write to (names and IDs only), the IDs of handled conversations for 30 days so they do not come back, and the requests waiting for Claude. A card and its messages are deleted once you handle it. Email addresses and profile details are never stored.

## Security

The board page listens on 127.0.0.1 only. Every API request needs a random secret that `/board` puts in the link and the page keeps in the tab's session storage. Requests with another host name or from another site are refused, which blocks other web pages and DNS rebinding from reaching the board. Nothing is sent to Slack or Jira without your click on the exact text and steps shown.

## Limits

- The board syncs only while a Claude Code session is open.
- Avatars show initials: the Slack connector does not return profile photos.
- A thread you once wrote in keeps bringing its new replies to the board; Ignore a busy thread to quiet it until the next message.
