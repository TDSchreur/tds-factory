### Fixed

- Token usage now finds a Run whose id appears only at the start of a line inside a session log string (after an escaped newline, tab or carriage return), so such a session is no longer undercounted.
