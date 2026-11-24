# Changelog

## 0.4.2

- A bot's message that mentions you, such as a daily digest of pull requests, becomes a card. Until now it landed in Other messages. A bot's `@here`, `@channel` or `@everyone` stays in Other messages.

## 0.4.1

- A new reply in a thread where you were only mentioned, also by `@here`, `@channel` or `@everyone`, comes to the board while the thread's card is open and for 30 days after you handle it. Until now such replies never showed up; only threads you wrote in brought theirs.

## 0.4.0

- Type `@` or `#` at the start of a word in a reply box, a thread reply box or the reply text of a proposal to mention someone or link a channel. The list shows the people in the conversation first, then people and channels from your other conversations and earlier searches, then what a Slack search finds; on a channel card it also offers `@here`, `@channel` and `@everyone`. The line under the box says who your text notifies and which channels it links.
- With Draft, Claude keeps every mention and channel link of your note and adds none; a draft that changes them fails with an error. Mention syntax you type by hand, such as `<@U123>`, goes out as text and notifies nobody.
- Other messages at the end of the board collects what people and bots post in your public and private channels, grouped by channel, until you mark it read on the board. A message leaves the section after `lookback_days`. A sync reads at most 100 channel messages; when Slack has more, the section says some are missing.
- A person's `@here`, `@channel` or `@everyone` in one of your channels becomes a card.
- Steps Claude proposes in Actions wait in Actions under its answer, with their own Approve and Discard, and no longer replace the draft from the reply box. Claude gets the waiting steps with your next prompt and revises them. Steps an earlier version put above the reply box stay there.
- When approved steps from Actions fail, the error shows in Actions and only the steps that did not run stay under the answer.
- After a failed run, approving the steps that did not run replies in the thread of the message you picked, not in the card's thread.
- A user group mention as Slack search returns it shows as `@group` instead of its raw code.

## 0.3.0

- The board notifies you when someone writes to you, when Claude's draft is ready or Claude answered a prompt in Actions, when a reply, reaction or approved step did not go out, and when checking Slack starts failing. While you use the board, a notification shows in its top right corner and opens the card on click. While the board tab is in the background, it comes from your browser. Notifications come only while the board tab is open.
- The bell in the header shows whether your browser allows the board's notifications, and asks again if you dismissed the request.
- `notify_new_messages`, `notify_claude_done`, `notify_send_failed` and `notify_sync_failed` turn each kind of notification off. All are on by default.
- On a wider screen, a long conversation and a long Actions history scroll in their own box and open at the newest message. If you scrolled up to read, new messages leave your place as it is.
- Sync now, Draft, Send as written, Approve, Discard, Run and the reaction buttons spin while their work runs. Sync now spins until the check is done.
- Send as written sends your text without first showing it as a proposal to approve. If the send fails, your text comes back on the card with the error.
- `/board` right after Claude Code starts opens the board instead of saying `Slack Board: The slack-board MCP server is not connected in this session`.
- The board tab has an icon.

## 0.2.2

- The board works with the official Slack plugin `slack@claude-plugins-official` as well as the claude.ai Slack connector. A session where Claude Code loads the plugin instead of the connector syncs again instead of showing `Slack Board sync failed: Connect Slack on claude.ai (Settings, Connectors)`.

## 0.2.1

- The status line no longer shows `Slack Board: JSON Parse error: Unexpected identifier "ok"` after the board finishes a draft, a send, a sync or any other request. The request itself always went through.

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
