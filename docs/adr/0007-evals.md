# ADR-0007: Explore options has an offline eval, cached and gated in CI

Status: accepted · Date: 2026-10-21

## Context

The Explore button depends on one Haiku call (ADR-0006) whose prompt, effort and model were tuned by reading a few traces. Nothing showed whether a change made detection better or worse, and the failures that matter are quiet ones: a button on a list of steps, a choice the button missed, a count that disagrees with the sheet, or a prompt that adds details the reply never gave.

## Decision

- **The eval drives the app's own messenger.** `evals/options/` is TypeScript and runs `LiveOptionsMessenger.detect` with a swappable `{ model, system, mode }`, so the prompt, schema, parsing and clamps under test are exactly what production sends. The only change to the app is that optional config.
- **A labeled dataset with a written guide.** `evals/options/data/cases.jsonl` holds 126 replies: real ones from the app's local databases (with anything private left out, since the repo is public), Opus replies to seed questions aimed at each failure mode under the app's system prompt, and hand-written adversarial cases. `GUIDE.md` settles the edge cases. Opus drafts the labels and a person reviews them (`pnpm evals:label cases`); a case the guide doesn't settle is marked ambiguous and left out of the metrics. A third of the cases, chosen by id hash, are held out from prompt tuning.
- **Code grades what code can, a judge the rest.** Whether the button shows, the option count, count/list agreement, titles, parse failures and cost and latency are computed. Whether each prompt is faithful to its option, stands alone and asks for something concrete, and whether the list covers the reply's options, is graded by Claude Sonnet 5.5 with yes/no verdicts, each after its reasoning. The judge is checked against people's verdicts on answers from the shipped config and from a deliberately poor one (`pnpm evals:calibrate`), and reports Cohen's κ per criterion on a split it wasn't tuned on.
- **Three samples per reply.** Haiku isn't deterministic; the flip rate and per-sample spread set the gate's tolerances.
- **Content-addressed cache.** Each answer is stored under a hash of everything that could change it (resolved config and schema, reply, sample index; for the judge, its rubric version, the reply, labels and answer). A rerun of unchanged inputs costs nothing; a prompt change pays only for detection, and the judge re-grades only answers that changed.
- **Committed runs, gated without an API key.** Every run writes a new `evals/runs/<date>-<time>-<config>-<hash>.json`. The config hash covers the detect config and the source of the code that builds the request and reads the answer, so an edit to either means a new run. CI runs `pnpm evals:check`. It fails when the newest production run's config hash or dataset hash doesn't match the checkout, when its summary doesn't follow from its own outputs, or when a gated metric falls past its tolerance in `gate.json`, or can no longer be measured, compared with the baseline run `gate.json` pins. The baseline moves only by editing `gate.json`, so a run of worse numbers can't become the bar by being committed twice.
- **A public, static `/evals` page.** It is built from the run files: production metrics over time, accuracy against cost per config, judge agreement, and per run every case with its samples, judge reasons and the baseline's answers, worse and better first.

## Alternatives rejected

- **A Python harness.** It would have to copy the prompt call and the clamps and would drift from production, and it would add a second toolchain to CI.
- **Running the eval live in CI.** That needs an API key in a public repository's CI and makes each PR cost money and vary with sampling. Committing the run makes its evidence part of the diff.
- **Judging everything, or scoring 1-10.** Counts and flags are exact in code. A single score drifts and can't be checked against people, but a yes/no verdict per criterion can.
- **Fuzzy-matching options to labels.** Wording varies too much; the judge decides coverage against the reference titles instead.

## Consequences

A change to `DETECT_SYSTEM`, the schema's descriptions, the effort, the model or the clamps fails CI until someone runs `pnpm evals` (about $1.20 uncached) and commits the run. A regression beyond the tolerances fails CI too, and so does a run that wasn't made on the committed dataset. Labels are drafts until a person reviews them, and the judge's agreement figures are only as good as the people who labeled the calibration set. The page shows replies from the dataset, so anything added to it is public.
