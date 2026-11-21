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

A card leaves the board when you answer in Slack, approve a proposal, or press Ignore (the × on the card or the button in the opened card). An ignored conversation comes back only when someone writes in it again.

A mention in a message shows the person's name. Click it to start a new message to them.

## Reply

1. Open a card. The conversation, any Jira ticket it mentions and the reply box are in the window that opens.
2. Write what you want to say in the reply box, in any language and as roughly as you like, then press Draft or Ctrl+Enter. An emoji alone becomes a reaction; the quick reaction buttons do the same in one click.
3. Claude shows its proposal: the reply in your voice and in the conversation's language, plus any other steps. Edit the reply text if you want.
4. Press Approve and send. The steps run in order. If one fails, the card says which, and only the steps that did not run stay in the proposal, so approving again never sends anything twice.

Press Discard to drop a proposal and write a new note.

With `polish_replies` turned off in the [settings](settings.md), the button says Send and your text goes out exactly as written, with no proposal in between.

## Reply in a thread

Click any message in the conversation. A box opens under it: write your note and press Draft thread reply. The reply goes into that message's thread, and a reaction goes on that message.

## Act on a ticket

Press Action in the card's header and write an instruction, for example "move PROJ-123 to review and comment that the fix is on staging". Claude turns it into Jira steps (comment, status change, assignee, summary, labels, priority) and Slack steps, and you approve them like a reply.

Ticket details (status, assignee, priority, last update) load on their own. Press Summarize with Claude when you want Claude to read the ticket and its latest comments; Summarize again refreshes it.

## Start a new message

Press New message, type a name or channel, and pick one. People and channels from your conversations and earlier searches show instantly; a Slack search adds the rest. A new card opens for that person or channel: write, draft, approve.

## Sync

The board checks Slack every 5 minutes while any Claude Code session is open, and 30 seconds after a failed check. Sync now checks right away. The header shows when the last check ran and any error.
