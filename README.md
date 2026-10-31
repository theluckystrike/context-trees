# Context Trees

Context Trees shows search results, backlinks and unlinked mentions with their heading path and parent list items. Matching lines that share a parent appear in one context tree.

Context Trees is its own view, built on the public Obsidian API. It does not change the core Search and Backlinks panes or depend on their private code.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/demo.gif" alt="Search for pricing, refine the query, fold two notes, then switch to the backlinks of the open note" width="720">

Free: search results, backlinks and unlinked mentions with heading and list context, mention filters, sort and a remembered view state. Pro: regular expressions, saved queries, exports, a view state for each note. $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=context-trees) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=context-trees).

## Quick start

1. Paste this text into a note:

```markdown
## Pricing

- Plans for 2027
  - The team plan costs more.
```

2. Run the command "Search the vault". Type `team plan` in the search box.
3. Read the tree: the heading Pricing, the parent item "Plans for 2027" and the line.

## Features

### Search with context trees

Type a word or a quoted phrase. Each word of the query must be on the same line. Each result note shows a tree: the headings above the match, then the parent list items, then the matching line with the hit marked. Two matches in the same list share their parents.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/search-trees.png" alt="Search results for pricing, each note shown as a tree of headings and parent list items with the word marked" width="720">

### Backlinks with context trees

The Backlinks tab shows the notes that link to the open note. Each linking line comes with its heading path and its parent items. The view follows the open note. Embeds count as links.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/backlinks.png" alt="Backlinks of Project Atlas, each linking line with its headings and parent list items" width="720">

### Fold, unfold and open at the line

Select the arrow of a note or a branch to fold it. Two buttons fold or unfold all. Select a line to open its note at that line. Hold Ctrl (Cmd on macOS) to open it in a new tab.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/fold.png" alt="Search results where four notes are folded to their names and match counts" width="720">

### Readable internal links

Wiki links and inline Markdown links to local notes show their label, such as "the project" for `[[Project Atlas|the project]]`. Select a link to open its target. Search marks stay on the label. Code spans, embeds and external links stay as text.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/readable-links.png" alt="Search results with readable link aliases in headings, parent items and matching lines" width="720">

### Regular expressions and saved queries (Pro)

Switch on the regular expression button to search each line with a pattern. A bad pattern shows an error. Select Save to keep a query as a chip above the results.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/regex-saved.png" alt="A regular expression query with a saved query chip above the results" width="720">

### Unlinked mentions without links, URLs, tags or code

The Unlinked mentions tab lists the notes that name the open note, or an alias, as a whole word without a link. Each mention shows its context tree. This tab is free from version 1.4.0. A name does not count inside:

- a wiki link or embed, such as `[[Atlas Copco]]`
- a Markdown link (inline or reference), its label or its address
- a URL, such as `https://example.com/atlas` or `www.atlas.com`
- a tag, such as `#project/atlas`
- inline code, a code block (also in a callout or a list item) or the language name of a code block

Comments in `%%`, also over more lines, inline math and footnote references do not count either. The text of a footnote counts. Chinese, Japanese and Thai names count inside a sentence, because these scripts have no spaces between words. The properties block is not searched. Turn on "Count mentions in code blocks" if you keep prose in code blocks.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/unlinked-mentions.png" alt="Unlinked mentions of Project Atlas: three notes, and the Atlas sources note shows only its heading and one plain line" width="720">

### Ignore terms, folders and notes

Put a word or phrase on each line of "Ignored terms". A mention inside it does not count: `Atlas Copco` hides "Atlas Copco makes tools", but "Atlas ships soon" still counts. Notes in "Ignored folders" are not searched. A note can opt out with the property `context-trees-mentions`: `false` (both ways), `source` (its text is not searched) or `target` (its mentions are hidden).

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/mention-ignore.png" alt="Unlinked mentions of Project Atlas with two ignored terms: the mentions inside those terms are gone" width="720">

### Sort and remember the view state

The sort button orders notes by name or by modified time. Set "Remember the view state" to "For all notes" to keep the tab, query, sort order and folds when you open another note, reopen the view or restart. With Pro, "For each note" keeps a state for each note, up to 300 notes. The default, Off, works as in version 1.3.0.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/remember-view.png" alt="The Backlinks tab opened again with the sort order Name, Z to A and the first note still folded" width="720">

### Export the results (Pro)

The download button, or the command "Export the results as a note", writes the results to a new note. Each note is a heading with a link and its tree as a nested list. Hits are highlighted with `==`.

<img src="https://raw.githubusercontent.com/theluckystrike/context-trees/HEAD/docs/export.png" alt="A new note with the exported results: a link for each note and its context tree as a nested list" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "Context Trees", then select "Install" and "Enable".

To install by hand, copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/context-trees/`. You need Obsidian 1.13.4 or later. The tests run on desktop only.

## Usage

1. Select the tree icon in the ribbon, or run "Open the side view".
2. Type in the search box, or select Backlinks or Unlinked mentions.
3. Run "Search the vault" to open the view with the cursor in the search box.

Headings and list items come from the Obsidian metadata cache. A new note without a cache is read from its text.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | What it does |
| --- | --- |
| Remember the view state | Off, For all notes, or For each note (Pro). Default Off. |
| Ignored terms | Terms that unlinked mentions skip. |
| Ignored folders | Folders that unlinked mentions skip. |
| Count mentions in code blocks | Default off. |
| Fold notes at start | Each note starts folded to its name and match count. Default off. |
| Notes per page | How many notes are listed before "Show more", from 10 to 500. Default 50. The count also includes the notes that are not listed yet. |
| Search delay | Milliseconds to wait after you stop typing, from 100 to 1500. Default 250. |

The settings tab also has the Pro section: sign in with GitHub, the status and Refresh.

## FAQ

### Is this a fork of Better Search Views?

No. It has no code from Better Search Views. Context Trees is its own view on the public API, and the core Search and Backlinks panes do not change.

### How fast is it?

In the end-to-end test with 2,000 small notes, first results must show in less than 1 second and a full search must end in less than 4 seconds. In an unlinked mention scan of those notes, the scan's own work must stop for the editor within 50 ms (5 to 33 ms in five CI runs). A 4 ms timer that also waits for the work of Obsidian waited 23 to 51 ms. The test fails at 100 ms.

### Does it change my notes?

No. It only reads notes. Export creates a new note.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=context-trees. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Context Trees makes no network requests. Sign in uses the GitHub device flow. Context Trees sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Context Trees sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [context-trees](https://notemods.com/plugins/context-trees/).

Report bugs and ask for features in the GitHub issues of this repository, with your Obsidian version and a small sample note.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
