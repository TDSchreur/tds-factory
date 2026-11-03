### Changed

- Define puts a size estimate in the Spec (a row per Ticket, the Define artifacts and a total, in files and KB) and judges it
  against two thirds of the size limit, 10 files and 27 KB. Above that it proposes a split with a suggested cut in the
  confirmation and you decide. After a split, Tickets are cut only for the first Run; each later Run gets one issue with its
  scope. On the Fast track, an estimate above the limit makes the single confirmation propose the Full track.
