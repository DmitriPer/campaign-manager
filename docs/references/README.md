# Supporting references

Imported on 2026-11-19 from user-supplied accessible attachments. Original machine paths are intentionally omitted. These files are historical source material, not current agent instructions or proof that the new product is implemented. Later conversation decisions, summarized in [DECISIONS.md](../DECISIONS.md), supersede conflicting assumptions.

## Files and provenance

| File | Source / purpose | Handling |
| --- | --- | --- |
| [Adisdas_NPC_Codex.html](Adisdas_NPC_Codex.html) | User-supplied legacy application; original filename retained. Visual/logical reference and embedded migration seed. | Exact byte-for-byte copy; do not modify as part of the new application. |
| [ORIGINAL_BRIEF_HE.md](ORIGINAL_BRIEF_HE.md) | User's pasted Hebrew brief originally supplied as `Pasted text.txt`. Describes the legacy app and initial Angular rebuild request. | Filename changed for clarity; file bytes preserved. Several scope/ordering assumptions were superseded. |
| [../PRODUCT_SPEC.md](../PRODUCT_SPEC.md) | Hebrew specification created during this conversation after the multi-user scope discussion. | Maintained planning document, not an immutable attachment. Local-path reference replaced and a continuity note added during the knowledge-base task. |

The chat itself is summarized in the knowledge-base documents rather than copied verbatim, to avoid carrying local configuration/authentication details and redundant tool logs. The legacy `secrets` fields are fictional DM-only story content, not service credentials; preserve them for migration while respecting the eventual application's player visibility boundaries. These references are not public application assets.

## Checksums for immutable copies

SHA-256, original bytes and copied bytes matched at import:

```text
cf3a5a4c88f5572916c910e3a41a904fb116391f70485b238a4e5b79d11c11c9  Adisdas_NPC_Codex.html
b4c4e46cb74b17992ec6c169ea9e3bf003a0a0417e9f6d0f3734d51841ed49ca  ORIGINAL_BRIEF_HE.md
```

## Verified seed inventory

`schemaVersion: 1`, `dataRevision: 4`, `currentEncounterId: null`.

| Collection | Count |
| --- | ---: |
| Locations | 9 |
| NPC records | 21 (18 NPCs, 3 templates) |
| Players | 4 |
| Encounters | 0 |
| Saved encounters | 0 |

| Player | Legacy ID | Max HP | AC | Current HP |
| --- | --- | ---: | ---: | --- |
| Nabu The Forsaken | pc-nabu | 26 | 11 | null / unknown |
| Alexandra | pc-alex | 58 | 17 | null / unknown |
| Johnny Woods | pc-johny | 45 | 13 | null / unknown |
| Aidon Terstand | pc-aidon | 52 | 15 | null / unknown |

Preserve the spelling of legacy IDs when mapping imports, including `pc-johny`. Named locations and all narratives remain in the copied HTML rather than being duplicated into multiple authoritative seed files.

## Missing and superseded material

- No actual D&D Beyond PDF, map asset, current JSON backup, prior failed project source, or additional campaign document was supplied in this conversation.
- The original HTML's localStorage may have held more recent edits on the user's browser. It is not included in the HTML file and was not accessed.
- Initial assumptions of an Adisdas-branded app, a fixed four-player roster, and the original feature order are superseded. See the decision record.
- Do not treat the legacy snapshot restore (which modifies current player HP) as the target history-view behavior.

## Previously consulted technical documentation

These were reference links in the planning discussion, not vendored specifications or pinned dependencies. Consult current official documentation when making actual version/implementation choices; no fresh dependency research was needed for this documentation-only task.

- [Angular components](https://angular.dev/guide/components)
- [Angular routing](https://angular.dev/guide/routing)
- [Angular signals](https://angular.dev/guide/signals)
- [NgRx SignalStore](https://ngrx.io/guide/signals/signal-store)
- [NestJS modules](https://docs.nestjs.com/modules)
- [Prisma supported databases](https://www.prisma.io/docs/orm/supported-databases) — ORM/provider choice is still open.
