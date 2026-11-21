# Settings

Change these in Claude Code's config menu under slack-board. A changed setting applies when the plugin reloads; restart Claude Code if the board keeps the old value.

| Setting | Default | What it does |
| --- | --- | --- |
| `port` | `4747` | Port of the board page on 127.0.0.1. Change it when another program uses 4747. |
| `jira_site` | empty | Atlassian site for ticket details and Jira steps, for example `yourteam.atlassian.net`. Empty turns the Jira features off. |
| `jira_projects` | empty | Comma-separated Jira project keys that count as tickets in messages, for example `PROJ,OPS`. Empty finds no tickets. |
| `polish_replies` | on | On: Claude turns your note into a reply in your style and you approve it. Off: replies, thread replies and quick reactions go out exactly as you write them, without a Claude step; an emoji code alone such as `:+1:` becomes a reaction. Action instructions always go through Claude. |
| `style_prompt` | empty | How Claude should write your replies and Jira comments, for example "Short and warm, first names, no jargon". When set, it is used instead of the tone of voice file. |
| `tone_of_voice_file` | `~/.claude/skills/tone-of-voice/SKILL.md` | Markdown file with your writing style, used while `style_prompt` is empty. When the file does not exist, a built-in plain and friendly style is used. |
| `sync_minutes` | `5` | Minutes between Slack checks. At least 1. |
| `lookback_days` | `7` | How many days back the first check looks for messages. At least 1. |
