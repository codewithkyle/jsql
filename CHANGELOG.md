# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

-   `query()` method now has a default response type of `Promise<Array<any>>` instead of `Promise<any>`
-   [SQL Functions](https://jsql.codewithkyle.com/clauses-and-operators/sql-functions) now support the `UNIQUE` constraint
-   auto incremented `INSERT INTO` bug

### Added

-   custom `query()` response types ([#20](https://github.com/codewithkyle/jsql/issues/20))

### Optimizations

-   Select Statements using the `COUNT()` SQL function **without** a `WHERE` clause or `UNIQUE` constraint are now 6x faster because they are performed using the [IDBObjectStore's built in count function](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/count)
-   updated to [idb@7](https://github.com/jakearchibald/idb/releases/tag/v7.0.0)

[unreleased]: https://github.com/codewithkyle/jsql/compare/v1.1.2...HEAD
[1.1.2]: https://github.com/codewithkyle/jsql/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/codewithkyle/jsql/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/codewithkyle/jsql/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/codewithkyle/jsql/releases/tag/v1.0.2
