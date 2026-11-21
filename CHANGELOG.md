# Changelog

## 0.2.0

- Actions replaces the Action button. Write a prompt the way you would in Claude Code: Claude looks things up with your claude.ai connectors, answers on the card and keeps the history there. Tools that only read run on their own; any change comes back as steps you approve, including calls of other connectors' tools with their exact input.
- Conversation shows the last 30 messages of the thread or DM from Slack, your own messages on the right, with a line where the messages waiting for you start. You can reply in the thread of any of them.
- Send as written next to Draft sends your text as you typed it, in the reply box and in thread replies.
- The reaction buttons, now React now, send the reaction at once without a proposal.
- Approving steps that only change tickets or other tools keeps the card open; a reply or reaction still closes it.
- The New message list keeps a fixed height and scrolls.

## 0.1.1

- `/board` opens the board even when the Slack connector is not connected.
- When `/board` cannot open the board, it says why instead of "no command.run hook answered it".

## 0.1.0

- `/board` opens the board in your browser, served on `127.0.0.1` at the `port` setting (4747 by default). It fills after the first sync, about 5 seconds after Claude Code starts.
- While Claude Code is open, the board collects your DMs, group DMs, @mentions and replies in your threads every `sync_minutes` (5 by default); the first sync looks back `lookback_days` (7 by default). One conversation is one card, and the card leaves the board when you answer in Slack.
- Cards are ranked by what they need from you: Decision, Action, Info or Small talk.
- Write a note in any language and Claude drafts the reply in the conversation's language and your style, from `tone_of_voice_file` or `style_prompt`, together with reactions and Jira steps (comment, status, assignee, fields). Nothing reaches Slack or Jira before you approve it. With `polish_replies` off, your text goes out exactly as you wrote it.
- Every Jira ticket a message mentions shows its status, assignee and priority once `jira_site` and `jira_projects` are set. Claude summarises a ticket only when you ask.
- Reply in the thread of any message, give free instructions through Action, and start new messages to people or channels.
- Typo-tolerant search across people, channels, messages and tickets, with filters, grouping, tiles or list, and light and dark themes.
- Needs Claude Code signed in with a claude.ai account, the Slack connector connected on claude.ai (Atlassian too for Jira) and Node.js 24 or newer on your `PATH`. No `npm install`.
