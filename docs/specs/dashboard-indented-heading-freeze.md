# Dashboard indented heading freeze

Opening Run detail must remain responsive and display saved Markdown files, including diffs containing headings preceded by whitespace. The Markdown parser currently recognizes such a line as a paragraph boundary but not as a heading, so it never advances and freezes the Dashboard. Align the heading recognition with the paragraph boundary, preserve surrounding content, and add regression coverage for the triggering input and continued parsing.
