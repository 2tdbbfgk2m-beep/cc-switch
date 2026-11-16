# Command Code structure optimization implementation plan

> Execute tasks sequentially using test-driven-development and verification-before-completion. Independent review before push.

**Goal:** Correct local Ultra semantics and simplify desktop extension installation/delivery while preserving existing configs, sessions, manual limits and rollback history.

**Approved design:** User-approved audit at outputs/CCS-CMD-结构审查与优化建议.md: phase 1 semantics/dead-code, then installation and delivery. Taste transport replacement and broad form redesign are outside this change.

**Architecture:** API capability checking ignores local execution modes. A shared desktop transaction owns snapshots, signing and failure rollback; feature adapters own transformations. Re-sign on selective removal instead of restoring an old whole-app signature. New reasoning manifests reference prior metadata in immutable backups, with compatibility readers for legacy inline history. Ship Ultra as a separate module and bundle all required extension/install files in a standalone release package.

**Constraints:** No live inference calls. No edits to user providers, credentials, preferences or sessions. Native version/SHA ownership guards remain. Existing backup history is retained. Preserve smaller reasoning/token/concurrency limits. Existing CLI entrypoints remain compatible.

## Tasks

- [x] 1. Add red regressions for high + ultra metadata review and legacy-only Ultra; separate CMD API choices from local mode; remove confirmed unreachable boolean branches and unused helpers. Keep legacy config reads.
- [x] 2. Add shared transaction tests for signing failure, selective removal coexistence and corrupted backup refusal. Reuse the shared primitive in both adapters, retaining old backup readers and wrapper CLIs.
- [x] 3. Add referenced-history and standalone-runtime tests. Emit separate Ultra runtime module, hash its payload, and preserve old version migration/uninstall chains.
- [x] 4. Build standalone extension package with a check/install CLI and component versions, wire it into release CI and public runtime-source offline verification. Verify package outside the repository.
- [ ] 5. Run relevant frontend/scripts/typecheck and native .61/.62 offline integration, independent review, ARM64 build, commit and push. Then update local apps, verify menus and file/DB preservation, report exact scope and limitations.
