# viquery agent rules

offline, cross-platform electron media gallery that turns images + videos into a semantic, temporally searchable library. see research/BRIEF.md for product + performance targets and docs/ARCHITECTURE.md (once written) for the binding design.

## engineering
- ground decisions in official language/framework/runtime docs; cite url + version in code comments only where the reason is non-obvious.
- before building something, check whether it exists: reference repos in research/, npm, local projects ~/Documents/ChatGPT/mux and ~/Documents/ChatGPT/hibi 2.
- model valid states as variants, not boolean soup. validate at real trust boundaries (ipc from renderer, files on disk, model outputs), not everywhere.
- single writer for the db. indexing jobs are idempotent + resumable, keyed by stable content identity.
- performance claims need baseline, workload, run count, spread.
- smallest working diff; no speculative abstraction, config, or "for later" code.
- content never leaves the device. no runtime network calls except explicit user-initiated model download.

## code style
- do not be overly defensive. no try/catch around everything, no asserting values already guaranteed upstream. catch only where you can recover or must translate an error at a boundary.
- match surrounding code. typescript strict.

## tests
- no redundant tests. if behavior x is already covered, do not re-test every variable of it. test actual functionality through real entrypoints, not implementation details.
- prefer one meaningful check over many shallow ones.

## git
- conventional commits, subject line only, no body.
- commit only files you changed for your task.
