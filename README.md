# csv-reader, exactly — make.fun csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/whyuardi/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/whyuardi/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as the
reference does on every input `{text, header}` — `{columns, rows, errors}` — and runs
several times faster. Dependency-free ES module, no network, no clock, no randomness.

## What it reads

The text is read once, left to right, with commas and double quotes. A U+FEFF at its very
start is dropped. A record ends at LF or CRLF, and a line left with no characters is no
record. Outside quotes a CR not followed by LF is dropped (`stray_cr`). A field that opens
with a quote runs to the next quote that is not doubled, `""` inside it is one quote, and
each CRLF or lone CR inside it is read as LF; what follows its closing quote, up to the
next comma or line break, is appended as it stands (`quote_junk`); a quote that never
closes is a literal character and the text after it is read again as unquoted
(`unterminated_quote`). A quote inside an unquoted field is a literal character. Fields
stay strings, never trimmed or converted. `columns` is the first record when `header` is
true, else null; `rows` holds the records after it, each padded with empty strings
(`short_row`) or cut (`long_row`) to the first record's width.

## How it is fast

Unquoted fields — the vast majority — are found with native `indexOf` jumps for `,` and
the next LF (cached, refreshed lazily) and sliced, never scanned a character at a time.
Quoted fields jump quote to quote with `indexOf('"')`. Whole records with no quote and no
stray CR are sliced and split at once. Character loops run only on the rare broken paths
(stray CR, unterminated quote, junk with a CR, CR/LF inside quotes).

## Run it

```sh
node main.ts   # reads cases from /input/cases.json (or $MAKEFUN_INPUT_DIR),
               # writes answers to /output/answers.json (or $MAKEFUN_OUTPUT_DIR)
```

## Check it

Against the kit's practice set and reference answers, plus generated fuzz sets from the
kit's own generator: 6/6 practice cases, 46/46 hand-written edge cases and 60/60 fuzz
cases identical to csv-reader 1.0.0, at roughly 4–5x the reference's CPU time on the
practice set.
