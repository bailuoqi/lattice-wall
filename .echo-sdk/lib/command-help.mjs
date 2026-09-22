export const usage = `ECHO Workshop SDK

Commands:
  init|new <directory> [--kind <kind>] [--preset <preset>] [--recipe <recipe>] [--id <id>] [--title <title>] [--holder <holder>] [--license <id>]
  add <directory> [--slot <slot>|--capability <cap>|--color <#rrggbb>|--permission <perm>]
  set <directory> [--title <title>] [--description <text>] [--style <style>] [--background <bg>] [--preamp <db>] [--bars <n>] [--mirror <true|false>] [--page-style <style>] [--license <id>]
  next <directory> [--json]
  guide [list|topic]
  snippet [list|<name>] [--json]
  api [method|action|errors] [--json]
  recipes [--json]
  sync <directory>
  validate <directory> [--json]
  check <directory> [--json] [--warn-only]
  quality <directory> [--json]
  test <directory> [--json]
  inspect <directory>
  explain <directory>
  scaffold <directory> --preset <preset>
  fix <directory>
  upgrade <directory>
  example [list|<name> <directory>] [--json]
  kinds [--json]
  version [--json]
  watch <directory>
  dev <directory> [--port <port>]
  doctor [--json]
  help [command]

id / title / holder can be omitted; the folder name is enough.
Run help <command> (or any command with --help) for focused usage.
These commands never upload to Steam.
`;

const helpPages = {
  init: `init|new <directory> — create a Workshop project
  --kind      theme | lyrics-style | animation-library | visualizer-preset | dsp-preset | audio-plugin-profile | locale-pack | plugin-package | native-shell
  --preset    kind-specific starter (run kinds for the lists)
  --recipe    outcome-oriented starter (run recipes for the list)
  --id/--title/--holder  optional; inferred from the folder name
  --license   your content license id, default All-Rights-Reserved
Example: init ./harbor --recipe css-theme`,
  add: `add <directory> — append one host-allowed item without rewriting JSON
  --slot        lyrics-style scene slot, e.g. spectrum
  --capability  theme UI runtime capability, e.g. playback:control
  --color       visualizer palette color, e.g. #f0b35b
  --permission  plug-in permission, e.g. library:read
Run next <directory> to see what the host still allows.`,
  set: `set <directory> — update common fields in place
  --title / --description   listing text
  --style <bars|wave|radial> and --bars <8-128> and --mirror <true|false>   visualizer-preset only
  --background <bg> and --page-style <style>                               lyrics-style only
  --preamp <-12..6>                                                        dsp-preset only
  --license <id>            content license in the manifest`,
  scaffold: `scaffold <directory> --preset <preset> — switch starters in place
Themes stack layers (colors -> skin -> stylesheet -> runtime); other kinds
swap the starter shape while keeping id and title.`,
  next: `next <directory> [--json] — personalized follow-up moves
Starts with "fix first" items derived from this project's current quality
report (each with the command that clears it), then lists which slots,
capabilities, colors, permissions or presets the host still allows.`,
  guide: `guide [list|topic] — Chinese authoring cookbook
guide          prints every topic
guide list     prints the topic index
guide <topic>  prints one topic, e.g. guide plugin or guide troubleshoot`,
  snippet: `snippet [list|<name>] [--json] — copy-paste starters for common moves
snippet list            names every snippet with its target file
snippet plugin-command  prints one snippet with required permissions and notes
Generated projects also ship the same set as .vscode/echo-workshop.code-snippets.`,
  api: `api [method|action|errors] [--json] — inspect the public plug-in API contract
api                     all methods with their permissions
api echo.queue.moveItem one method
api errors              common errors and whether retrying is allowed`,
  recipes: `recipes [--json] — outcome-oriented starters for init --recipe`,
  sync: `sync <directory> — regenerate the packaged plug-in files and manifest hashes
Run it after adding or editing files under content/ or src/.`,
  validate: `validate <directory> [--json] — fail-closed structural validation
Checks the project file, manifest, hashes, package limits, network hosts and preview.`,
  check: `check <directory> [--json] [--warn-only] — the complete local gate
Sync + validation + quality report + deterministic fixtures, with a final
one-line gate summary. --warn-only keeps a passing exit code while iterating;
publication still requires a clean check.`,
  quality: `quality <directory> [--json] — publication-readiness report
Preview size, listing copy, tags, compatibility, placeholders and kind-specific rules.`,
  test: `test <directory> [--json] — run deterministic fixtures in the local mock host
The mock enforces declared permissions, network hosts and ports. It is not the
production sandbox.`,
  inspect: `inspect <directory> — machine-readable project summary (always JSON)`,
  explain: `explain <directory> [--json] — human-readable description of the project`,
  fix: `fix <directory> — repair common problems
Creates or replaces an unusable preview, bumps stylesheet/runtime
minEchoVersion, restores a missing README.md / CUSTOMIZE.md / .gitignore and
resyncs hashes. It never overwrites files you already wrote.`,
  upgrade: `upgrade <directory> — refresh the portable .echo-sdk copy inside a project`,
  example: `example [list|<name> <directory>] [--json] — copy a complete official example
example list             names every example
example stylesheet-theme ./my-theme   copies one into an empty folder`,
  kinds: `kinds [--json] — the nine content kinds with entry files, Steam tags and presets`,
  version: `version [--json] — the supported schema, API, protocol and limit surface
--json additionally reports per-kind entry/tag mappings, recipes and guide topics.`,
  watch: `watch <directory> — rerun the gate on every source change
Debounces editor save bursts, ignores the generated manifest write and ends
every rerun with the same one-line gate summary as check.`,
  dev: `dev <directory> [--port <port>] — live author console and fixture preview
Defaults to port 41783 and automatically tries the next free ports when it is
busy; an explicit --port fails instead of falling back. Local only, never uploads.`,
  doctor: `doctor [--json] — self-check that the SDK installation is complete`,
  help: `help [command] — this overview, or focused usage for one command`,
};

export const commandHelpTopics = Object.keys(helpPages);

export const formatCommandHelp = (command) => {
  const normalized = command === 'new' ? 'init' : command;
  const page = helpPages[normalized];
  if (!page) {
    throw new Error(`Unknown help topic ${command}. Use: ${commandHelpTopics.join(', ')}`);
  }
  return `${page}\nThese commands never upload to Steam.`;
};
