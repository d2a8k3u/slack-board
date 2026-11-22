# Use the board

Run `/board` in Claude Code. The board opens in your browser at `http://127.0.0.1:4747` with a private link; keep that tab open as long as you like. Run `/board` again to open it in a new tab.

## Read what is waiting

Each card is one conversation: a DM, a group DM, a thread, or a channel message that mentions you. The badge says what it needs from you:

| Badge | Meaning |
| --- | --- |
| Decision | someone needs your call or approval to go on |
| Action | someone asks you to do, check or answer something |
| Info | work news with nothing to decide |
| Small talk | greetings, thanks, lunch |

Cards are sorted by priority, newest first within one priority. The bar above the cards holds everything else:

- Search finds people, channels, message text and tickets and tolerates typos: `bacnked` finds `#backend`. Matches are highlighted and the best match comes first. Press `/` to jump to search and Esc to clear it.
- Filters narrows the board by type, channel, person and priority. Active filters show as chips under the bar; click one to remove it.
- Group splits the board into sections by priority, type, channel, person or status. Click a section header to collapse it. The board remembers the grouping and the collapsed sections in your browser.
- Sort orders the cards inside each section; the arrow next to it reverses the order.
- Tiles and List switch the layout.

A red dot marks a card with messages you have not opened yet.

A card leaves the board when you answer in Slack, when a reply or reaction you approved goes out, or when you press Ignore (the × on the card or the button in the opened card). Steps that only change tickets or other tools keep the card open. An ignored conversation comes back only when someone writes in it again.

A mention in a message shows the person's name. Click it to start a new message to them.

## Read the conversation

Open a card. Conversation shows the whole thread or DM as Slack has it, up to its last 30 messages: other people on the left, your own messages on the right, and a "New since your last reply" line where the messages waiting for you start. The board reads it from Slack when you open the card and again when a new message arrives. Until that read is done, you see only the messages waiting for you.

On a wider screen a long conversation scrolls in its own box and opens at the newest message. If you scroll up to read, new messages leave your place as it is. On a phone the whole card scrolls as one page.

## Reply

1. Write what you want to say in the reply box, in any language and as roughly as you like.
2. Press Draft or Ctrl+Enter. Claude shows its proposal: the reply in your voice and in the conversation's language, plus any other steps. Edit the reply text if you want.
3. Press Approve and send. The steps run in order. If one fails, the card says which, and only the steps that did not run stay in the proposal, so approving again never sends anything twice.

Press Send as written to send your text exactly as you typed it, without Claude. The React now buttons put that reaction on the latest message at once. Press Discard to drop a proposal and write a new note.

With `polish_replies` turned off in the [settings](settings.md), Draft and Send as written become one Send button and your text always goes out exactly as written.

## Reply in a thread

Click any message in the conversation, yours included. A box opens under it: press Draft thread reply to have Claude write it, or Send as written to send your text as it is. The reply goes into that message's thread, and a reaction goes on that message.

## Ask Claude about a conversation

Open Actions at the top of the card and write a prompt the way you would in Claude Code, for example "find the ticket related to the one in this message" or "move PROJ-123 to review and comment that the fix is on staging". Press Run or Ctrl+Enter.

Claude works on it with the conversation, the tickets on the card and the earlier prompts, using your claude.ai connectors and, when installed, the official Slack plugin. It answers in Actions and names the tools it read from. Tools that only read run right away. Anything that would change something (a Slack message, a Jira comment, a page in another tool) comes back as steps in Claude's proposal, and nothing runs until you approve them. A step that calls another connector's tool shows the exact input it will send.

A long list of prompts and answers scrolls the same way as the conversation.

Your prompts and Claude's answers stay on the card until it leaves the board.

Ticket details (status, assignee, priority, last update) load on their own. Press Summarize with Claude when you want Claude to read the ticket and its latest comments; Summarize again refreshes it.

## Start a new message

Press New message, type a name or channel, and pick one. People and channels from your conversations and earlier searches show instantly; a Slack search adds the rest. A long list scrolls, and the arrow keys move through it. A new card opens for that person or channel: write, draft, approve.

## Sync

The board checks Slack every 5 minutes while any Claude Code session is open, and 30 seconds after a failed check. Sync now checks right away and spins until the check is done. The header shows when the last check ran and any error.

## Notifications

The board notifies you when someone writes to you, when Claude's proposal is ready or Claude answered a prompt, when a reply or approved step did not go out, and when checking Slack starts failing. While you use the board, a notification shows in its top right corner; click it to open the card. While the board tab is in the background, it comes as a system notification from your browser, once you press Turn on notifications in the header and allow it. Notifications come only while the board tab is open.

A new message shows who wrote, where, and the start of the text. When more than three conversations have news at once, one notification sums them up. The first sync of a new board stays quiet. Each kind can be turned off in the [settings](settings.md).
