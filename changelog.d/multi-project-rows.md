### Added

- The Dashboard page shows a Project row per Project under one sticky row of Stage headers. A Project row collapses to one line with its Runs per Stage and a waiting badge, and the choice is remembered per Project. Project rows are in alphabetical order, with the `?project=<id>` row first and expanded. An empty Project says "No Runs", and a missing Project has a Remove button.

### Changed

- Notifications and Run detail name the Project, and the compact view applies one Stage to every Project row. The header pill shows "N Projects" when there are several.
- The collapsed row's Runs per Stage and waiting badge no longer change with the Needs you filter, the **Delete all** button names its Project, and a focused card is no longer hidden under the sticky headers.
