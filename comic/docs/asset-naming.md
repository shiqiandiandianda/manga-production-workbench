# Asset naming contract, version 1

An asset belongs to a project and a subject. Keep the project title, subject name,
variant and immutable image revision in separate fields. The canonical label is
`subject__variant`; omit the separator when no variant is known. File extensions
describe the actual file format. A server-generated `project-subject-variant`
display label must never be fed back into the subject or variant fields.

Characters use their identity name as subject and their declared costume or form
as variant. Scenes identify a specific location, floor and room. Camera direction
and time of day are variants; a different room is a different space. Props and
pets use their object/identity name and declared form or state. Unknown costumes
stay unresolved; do not invent a default costume to make a reference match.

The shared pure implementation is `public/asset-naming.js`. It removes only
known, bounded work/subject prefixes. It preserves location qualifiers, source
labels and distinct immutable IDs. Technical card labels, generation record IDs
and file version suffixes are not costumes. Name normalization is idempotent.

The classified reader resolves subject metadata for characters, scenes, props
and pets. It exposes canonical labels and retains `sourceName` and the raw remote
`variantName` for audit and legacy file references. A disabled source label stays
disabled after display cleanup. A specific scene search prefers full-name
matches over sibling rooms. Explicit cross-category browsing remains available.
Search ranking does not relax automatic binding: project, type, declared state,
an unambiguous candidate and a complete query still matter.

All new classified uploads use this same contract at the shared upload boundary.
Known subjects are reused only when the normalized identity is unique. Ambiguous
subject collisions fail instead of creating or merging identities. Existing
pre-contract upload receipts retain their original payload semantics so a retry
can resume the original upload. Image hashes and fixed revision IDs do not change.

`tools/normalize-cached-asset-names.mjs` produces a preview by default. Applying a
local cache metadata migration requires the editor to be stopped, a complete
read-only catalogue snapshot and a new backup. It checks asset IDs, paths,
fixed revision IDs, hashes and every non-asset store field. It makes no Moku
requests that mutate remote data. This is separate from a reviewed Moku rename
plan; it is never an automatic remote migration.

Regression coverage includes repeated prefixes, subject/variant separation,
distinct rooms, incomplete states, fixed references, source-label compatibility,
disabled assets, ambiguous versions, classified uploads and legacy receipt retry.
