# Context Trees

Context Trees shows search results and backlinks with their heading path and parent list items. Matching lines that share a parent appear in one context tree.

Context Trees is its own view, built on the public Obsidian API. It does not change the core Search and Backlinks panes or depend on their private code.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/demo.gif" alt="Search for pricing, refine the query, fold two notes, then switch to the backlinks of the open note" width="720">

Free: search results and backlinks with heading and list context. Pro: regular expressions, saved queries, unlinked mentions, exports. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=context-trees) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=context-trees).

## Features

### Search with context trees

Type a word or a quoted phrase. Each word of the query must be on the same line. Each result note shows a tree: the headings above the match, then the parent list items, then the matching line with the hit marked. Two matches in the same list share the parents above them. The status line gives the count of matching lines and notes, and the search time. Two hits on one line count as one match.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/search-trees.png" alt="Search results for pricing, each note shown as a tree of headings and parent list items with the word marked" width="720">

### Backlinks with context trees

Open the Backlinks tab to see the notes that link to the open note. Each linking line comes with its heading path and its parent items, so you see why a note links here without opening it. The view follows the open note and updates when links change. Embeds count as links.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/backlinks.png" alt="Backlinks of Project Atlas, each linking line with its headings and parent list items" width="720">

### Fold, unfold and open at the line

Select the arrow of a note or of any branch to fold it. The two buttons above the results fold or unfold all of them. Select a line to open its note with the cursor on that line. Hold Ctrl (Cmd on macOS) to open it in a new tab. Select a note name to open the note at the top.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/fold.png" alt="Search results where four notes are folded to their names and match counts" width="720">

### Readable internal links

Wiki links in headings, parent items and matching lines show their name or alias. For example, `[[Project Atlas|the project]]` shows "the project" as a link. Inline Markdown links to local notes also show their label. For example, `[the project](Project%20Atlas.md)` shows the same label. Select a link to open its target. Heading and block links keep their target. Hold Ctrl (Cmd on macOS) to open the target in a new tab. You can also use Tab to select a link, then press Enter or Space.

Select the text beside a link to open the source line. Search marks stay visible in link labels. If the query matches a hidden path, the visible label is marked. A missing target shows a notice and does not create a note. Code spans, embeds, external links, reference links and other Markdown stay as text. Inline links with a separate title stay as text. This feature is free.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/readable-links.png" alt="Search results with readable link aliases in headings, parent items and matching lines" width="720">

### Regular expressions and saved queries (Pro)

Switch on the regular expression button to search each line with a pattern. A bad pattern shows an error and no results. Select Save to keep a query as a chip above the results. Select a chip to run it again, or its cross to delete it.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/regex-saved.png" alt="A regular expression query with a saved query chip above the results" width="720">

### Unlinked mentions with context (Pro)

The Unlinked mentions tab lists the notes that name the open note, or one of its aliases, as plain text without a link. The name must be a whole word, and text that already is a link does not count. Each mention shows its context tree.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/unlinked-mentions.png" alt="Two notes that mention Atlas as plain text, with their headings and parent items" width="720">

### Export the results (Pro)

The download button, or the command "Export the results as a note", writes the current results to a new Markdown note. Each result note is a heading with a link, and below it the tree as a nested list. The matching lines are highlighted with `==`.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/export.png" alt="A new note with the exported results: a link for each note and its context tree as a nested list" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "Context Trees", then select "Install" and "Enable".

To install by hand, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/context-trees/`. Then enable the plugin. You need Obsidian 1.13.4 or later. The plugin is not marked desktop only and uses no desktop-only API. The tests run on desktop only.

## Usage

1. Select the tree icon in the ribbon, or run "Open the side view". The view opens in the right sidebar.
2. Type in the search box and wait a moment, or press Enter.
3. Select Backlinks to see the links to the open note.
4. Use the command "Search the vault" to open the view with the cursor in the search box.

Context Trees reads headings and list items from the Obsidian metadata cache, so its list items match those of Obsidian. The properties block of a note is not searched. If a note has no cache yet, such as a brand new note, the view reads its headings and lists from the text.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Fold notes at start | Each note starts folded to its name and match count. Default off. |
| Notes per page | How many notes are listed before "Show more", from 10 to 500. Default 50. The count also includes the notes that are not listed yet. |
| Search delay | Milliseconds to wait after you stop typing, from 100 to 1500. Default 250. |

The settings tab also has the Pro section: sign in with GitHub, the status and Refresh.

## FAQ

### Is this a fork of Better Search Views?

No. Context Trees has no code from Better Search Views, and its author did not make it. It solves a similar job differently. Better Search Views changes the core panes by patching private parts of Obsidian. Context Trees uses only the public API.

### Does it change the core Search pane?

No. The core panes work as before. Their syntax, such as `path:` and `tag:`, is not available here. Context Trees searches the text of each line.

### How fast is it?

In the end-to-end test with 2,000 small notes, the first results must show in less than 1 second, and a full search must end in less than 4 seconds. The view reads 48 notes at a time and shows results while it reads. Your time depends on your device and the size of your notes.

### Can I open a link from a result?

Yes, see Readable internal links. The view reads the target relative to the source note, so two notes with the same name follow the normal Obsidian link rules. Export keeps the original link text.

### Does it change my notes?

No. It only reads notes. Export creates a new note.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Context Trees makes no network requests. Sign in uses the GitHub device flow. Context Trees sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Context Trees sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [context-trees](https://notemods.com/plugins/context-trees/).

Report bugs and ask for features in the GitHub issues of this repository, with your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
