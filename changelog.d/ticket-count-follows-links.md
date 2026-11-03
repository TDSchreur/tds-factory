### Changed

- `tds-factory run update` keeps `tickets_total` equal to the number of Ticket links: setting `tickets` sets the
  count, and a count that does not match the list, or a list shorter than `tickets_done`, is refused.
