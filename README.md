# Course Overview CIS (Tilburg University)

Interactive, mobile-first visual of all MSc Communication and Information Sciences (CIS) courses (Tilburg University). Explore by Track or Block, filter by theme or individual courses, and tap hexagons for details. Includes a short guided tour for users and print/export.

# Who this is for

This README and documentation are tailored to non-technical staff (e.g., programme board) who will use this course overview with students. You can download, open, modify and host the app without prior coding experience.

# Two ways to use the app

1. Standalone (everything in one file)
2. Regular (files split by type)

# Quick start

**Option A — Standalone (easiest to open)**

1. Download the repo as ZIP (Code → Download ZIP).
2. Open `standalone/create_cis_overview.html` in your browser.
3. Share `create_cis_overview.html` with students or host it on your server.

**Option B — Regular (more intuitive to edit)**
Use one of the following from the `regular/` folder:

```
cd regular
python -m http.server 5500
```
Then open [http://localhost:5500/](http://localhost:5500/) in your browser.


or use VS Code’s “Live Server” to open `regular/index.html`.

or directly upload all files (in the same folder structure) to your own website. Users should automatically arrive at `index.html`.

Why a server? Browsers block `fetch()` for `file://` URLs. Serving over `http://` allows the app to load `data/*.json`.

# Project structure

```
cis-course-map/
├─ standalone/
│  └─ create_cis_overview.html
├─ regular/
│  ├─ index.html
│  ├─ assets/
│  │  ├─ css/style.css
│  │  └─ js/script.js
│  └─ data/
│     ├─ courses.json
│     ├─ themes.json
│     ├─ overview.json
│     └─ tips.json
├─ README.md
├─ LICENSE
└─ .gitignore
```

# Editing the content

You can choose the simple “one file” route or the modular JSON route. The data fields are the same in both.

**A) Standalone**
Open `standalone/create_cis_overview.html` in a text editor. Scroll to the DATA section at the end and edit:

* `coursesData` — list of courses to display
* `themesData` — list of theme names (and optional order)
* `overviewData` — optional fixed layouts per total number of courses
* `tipsData` — short guided tour texts

**B) Regular**
Edit the JSON files under `regular/data/`:

* `courses.json` — list of courses to display
* `themes.json` — list of theme names (and optional order)
* `overview.json` — optional fixed layouts per total number of courses
* `tips.json` — short guided tour texts

Minimal example for `courses.json`:

```
[
    {
        "title": "Data Visualisation",
        "code": "CIS-123",
        "tracks": ["BDM", "CC"],
        "block": ["2"],
        "themes": ["Data", "Design"],
        "description": "Design and critique visualisations; project-based."
    }
]
```

**Field notes**

* `tracks`: any of `"BDM"`, `"CC"`, `"NMD"`
* `block`: one of `"1"`, `"2"`, `"3"`, `"4"`
* `themes`: free labels that must also exist in `themes.json`


# Course ordering (`courses.json`)

The grid uses the order of items in `courses.json` (or `coursesData` in the standalone file).

* The **first** course in the JSON list becomes the **top hexagon of the leftmost column**.
* The **last** course becomes the **bottom hexagon of the rightmost column**.
* Everything in between fills **top-to-bottom, then left-to-right** across the grid.

This ordering holds both for **auto-layout** and when an **overview pattern** is provided.

**Reordering**
To change positions, simply move course objects up/down in `courses.json`. You do not need to edit IDs or any other fields.

**Mini example**

```json
[
  { "title": "A – first in list",  "tracks": ["BDM"], "block": ["1"], "themes": [] },
  { "title": "B – second",         "tracks": ["CC"],  "block": ["1"], "themes": [] },
  { "title": "… more courses …" },
  { "title": "Z – last in list",   "tracks": ["NMD"], "block": ["4"], "themes": [] }
]
```

* “A – first in list” will appear at the **top of the leftmost column**.
* “Z – last in list” will appear at the **bottom of the rightmost column**.

Tip: keep related courses adjacent in the JSON to keep them visually close on the grid.

# Themes (`themes.json`)

Use a short, single-word `id` (no spaces) as the internal identifier, and put the human-readable name in `label`. Courses must reference the `id` values.

* `id`: single word (e.g., `HumanAI`).
* `label`: what users see (e.g., `Human–AI Interaction`).
* `order`: optional integer for sorting.

Example: If your courses can be divided into the themes "Data Visualisation", "Human–AI Interaction", and "Language Technology", `themes.json` (or `themesData` at the bottom of the standalone version) should look like this:

```
[
    {"id":"DataVisualisation","label":"Data Visualisation","order":1},
    {"id":"HumanAI","label":"Human–AI Interaction","order":2},
    {"id":"LanguageTechnology","label":"Language Technology","order":3}
]
```

Referencing themes in a course (in `courses.json`):

```
{
    "title": "Advanced UX Research",
    "code": "CIS-402",
    "tracks": ["CC"],
    "block": ["2"],
    "themes": ["HumanAI", "DataVisualisation"],  // use ids here
    "description": "Mixed-methods UX studies focusing on AI-supported tools."
}
```

Of course, a course can belong to one theme, multiple themes, or no theme at all.


# Overview patterns (optional; `overview.json`)

Lets you pin a pleasing layout for a given total number of courses. Use compact strings:

* Hyphens separate columns: `"3-4-{5}-4-3"`
* Curly braces `{x}` = middle column must be ODD (visually offset)
* Square brackets `[x]` = middle column must be EVEN
* Add `^t` to skip the top slot or `^b` to skip the bottom (e.g., `"5^b"`)

Example:

```
{
    "19": "3-4-{5}-4-3",
    "20": "3-4-[6]-4-3",
    "21": "3-4-{5}-4-5"
}
```

If no pattern is set for the current number of courses, the app auto-layouts.

# Appearance

* `regular/assets/css/style.css` — change colours, spacing, and fonts.
* The top of the stylesheet defines all theme colours as CSS variables under “0) THEME & COLOR TOKENS”; edit those tokens to restyle the app quickly. Make matching updates in the Dark overrides under `body[data-ui-theme="dark"]`. 
* The app supports light/dark theme toggle.
* Printing uses a clean A4-landscape layout.

# Using the interface (quick recap)

* Switch Tracks vs Blocks via the segmented control.
* Filter by Theme or toggle individual courses.
* Click a hex for details; click again or press Esc to close.
* Use “Center” to reset the view.
* Use Download/Print for a printable page.

# Troubleshooting

* **I opened `regular/index.html` by double-click and nothing loads.**
  Serve the folder via a local server (see “Regular” in Quick start). Browsers block JSON fetches from `file://`.

* **404 for JSON or JS files.**
  Start the server in the `regular/` directory, and ensure the paths exist: `assets/css/style.css`, `assets/js/script.js`, `data/*.json`.

* **The grid looks odd after editing courses.**
  Check that every course has `title`, `tracks`, `block`; run with a pattern in `overview.json` or let auto-layout handle it.

* **Screen stays blue and nothing appears.**
  That means the intro animation did not start because of a JavaScript error.

  * Open the browser’s developer tools → **Console** (right-click → Inspect / Inspect element).
  * Read the error message; it usually points to the exact file and line (e.g., a JSON typo).
  * Fix the issue and refresh.
  * A common issue is not adhering to JSON syntax rules (see below)

* **FYI: JSON syntax rules.**

  * No trailing commas: `["A", "B"]` (not `["A", "B",]`).
  * Keys and string values must be in double quotes: `"title": "My Course"` (not `'title': 'My Course'`).
  * Use `true`/`false`/`null` (all lowercase).
  * Arrays use square brackets `[...]`; objects use curly braces `{...}`.
    If the JSON is invalid, the app will not start. Validate with an online JSON checker if unsure.



# Maintenance

Please update `courses.json` (or the standalone DATA section) each academic year, and optionally adjust `overview.json` if you want a fixed layout for the current course count.
