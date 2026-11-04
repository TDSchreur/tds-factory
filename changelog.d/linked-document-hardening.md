### Fixed

- The Markdown parser behind every Dashboard Markdown view follows CommonMark for fenced code and headings: `~~~` fences are recognised and close only on a fence of the same character that is at least as long, a line indented four or more spaces is not a heading, a closing `#` sequence is removed from a heading, and a tab after `#` stays valid.
- A Linked document title skips an empty first `# ` heading for the next non-empty level 1 heading, and the number taken from a file name has at most 6 digits.
