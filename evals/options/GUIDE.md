# Labeling guide: Explore options

Each case is one assistant reply. The label says what the Explore button should do for it: appear with N alternatives, or stay hidden.

## Has a choice

Yes when the reply lays out two or more distinct alternatives the user might weigh against each other:

- A menu of ideas or suggestions to pick from (names, approaches, plans, dishes), even when the user could do several of them.
- A question that asks the user to pick between named alternatives: "Do you want the short version or the detailed one?", "Would you like me to develop A, B or C next?"
- Alternatives written as prose, a table, headings, or comments inside a code block all count.
- Two separate choices in one reply ("database: Postgres or SQLite; hosting: Fly or Railway"): both count, and the count is their total.

No when:

- The list is parts of one whole: steps, tips toward one goal, features, facts, examples, pros and cons, criteria, ingredients, problems found in code.
- Alternatives are mentioned in passing ("or use a queue instead").
- The reply asks about the user's situation ("What is it for?"), even with example answers.
- There's a single recommendation, a single answer, or a refusal with nothing to pick from.
- It's a quiz the user is asked to answer: its choices aren't directions to explore.
- It's a generic offer of help ("I can help with writing, code or questions").

**Ambiguous** (kept out of the metrics until decided): a closing aside that offers follow-ups without asking the user to pick ("I can add sound or sprites if you'd like").

## Count

The number of alternatives, all of them even past 10 (the app keeps the first 10). For nested alternatives, count the top-level ones, not their variants. 0 when there's no choice.

## Titles

Two to four words naming each alternative, in the reply's order. They're a reference for the judge, not strings to match.

## Tags

Pick every tag that applies:

- **Choices:** `choice-list`, `choice-prose`, `choice-table`, `choice-headings`, `closing-question`, `closing-offer`, `code-block`, `nested`, `two-sets`, `over-ten`
- **Non-choices:** `steps`, `tips`, `pros-cons`, `features`, `facts`, `passing-mention`, `clarifying-question`, `quiz`, `single-option`, `generic-offer`
- **Input shape:** `injection`, `non-english`, `long`, `trivial`, `refusal`

## Review

`pnpm evals:label cases` walks the cases a person hasn't reviewed yet. Model drafts start with `reviewed: false`.
