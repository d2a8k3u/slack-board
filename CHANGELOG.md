# Changelog

## 0.1.0

- `/board` opens the board in your browser, served on `127.0.0.1` at the `port` setting (4747 by default). It fills after the first sync, about 5 seconds after Claude Code starts.
- While Claude Code is open, the board collects your DMs, group DMs, @mentions and replies in your threads every `sync_minutes` (5 by default); the first sync looks back `lookback_days` (7 by default). One conversation is one card, and the card leaves the board when you answer in Slack.
- Cards are ranked by what they need from you: Decision, Action, Info or Small talk.
- Write a note in any language and Claude drafts the reply in the conversation's language and your style, from `tone_of_voice_file` or `style_prompt`, together with reactions and Jira steps (comment, status, assignee, fields). Nothing reaches Slack or Jira before you approve it. With `polish_replies` off, your text goes out exactly as you wrote it.
- Every Jira ticket a message mentions shows its status, assignee and priority once `jira_site` and `jira_projects` are set. Claude summarises a ticket only when you ask.
- Reply in the thread of any message, give free instructions through Action, and start new messages to people or channels.
- Typo-tolerant search across people, channels, messages and tickets, with filters, grouping, tiles or list, and light and dark themes.
- Needs Claude Code signed in with a claude.ai account, the Slack connector connected on claude.ai (Atlassian too for Jira) and Node.js 24 or newer on your `PATH`. No `npm install`.
