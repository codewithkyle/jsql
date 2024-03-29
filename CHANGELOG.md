# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2023-04-01

### Optimizations

- improved SQL query parsing performance
- imporoved optimized query performance
    - caching
    - refined single `WHERE` clause query optimizer

### Added

- table caching
- custom IndexedDB wrapper

### Removed

- [idb](https://www.npmjs.com/package/idb) dependency

## [1.2.0] - 2022-02-06

### ⚠ Possible Breaking Changes ⚠

This release fixes several bugs in turn correcting some non-standard outputs. While developing JSQL we try our best to prevent the introduction of breaking changes into minor releases, however, correcting query outputs to match the SQL standard.

One such change is the `COUNT` query output.

#### Old Output

```javascript
[100];
```

#### New Output

```javascript
[{ "COUNT(*)": 100 }];
```

### Noteworthy Changes

The default CDN URLs will no longer automatically redirect to the latest minor version number. Instead, they will only automatically redirect to patch versions. We've implemented this change as a way to minimize future possible breaking changes as we continue to fix non-standard query outputs.

### Fixed

-   `query()` method now has a default response type of `Promise<Array<any>>` instead of `Promise<any>`
-   auto-incremented `INSERT INTO` bug
-   improved error logging format: errors now include the SQL query and the parameters object contained within a collapsed console log group
-   default CDN URLs are now version locked to both major and minor versions [#27](https://github.com/codewithkyle/jsql/issues/27)
-   `204 No Content` stream response [#25](https://github.com/codewithkyle/jsql/issues/25)
-   developers can control the stream request `fetch()` options [#26](https://github.com/codewithkyle/jsql/issues/26)

### Added

-   custom `query()` response types ([#20](https://github.com/codewithkyle/jsql/issues/20))
-   `ORDER BY` support on `UNIQUE` constrained queries
-   [SQL Functions](https://jsql.codewithkyle.com/clauses-and-operators/sql-functions) now support the `UNIQUE` constraint
-   `IN` and `!IN` logical operators ([#21](https://github.com/codewithkyle/jsql/issues/21))
-   [day.js](https://day.js.org/en/) developer dependency
-   `NOW()` function ([#11](https://github.com/codewithkyle/jsql/issues/11))
    -   supports UNIX timestamp with `NOW()`
    -   supports custom formats with `NOW('YYYY-MM-DD')` [see all formatting options](https://jsql.codewithkyle.com/clauses-and-operators/sql-functions#now)
-   `DATE()` function ([#11](https://github.com/codewithkyle/jsql/issues/11))
    -   supports custom formatting [see all formatting options](https://jsql.codewithkyle.com/clauses-and-operators/sql-functions#date)
-   `INT()` function
-   `FLOAT()` function
-   `BOOL()` function
-   `JSON()` function
-   `AS` keyword ([#24](https://github.com/codewithkyle/jsql/issues/24))
-   nested object queries ([#12](https://github.com/codewithkyle/jsql/issues/12))

### Optimizations

-   `SELECT` statements using the `COUNT()` SQL function **without** a `UNIQUE` clause are now 6x faster after switching to the [IDBObjectStore's built in count function](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/count)
-   updated to [idb@7](https://github.com/jakearchibald/idb/releases/tag/v7.0.0)
-   reduced memory footprint for non-wildcard (`*`) queries
-   relocated the `UNIQUE` constraint function

[unreleased]: https://github.com/codewithkyle/jsql/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/codewithkyle/jsql/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/codewithkyle/jsql/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/codewithkyle/jsql/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/codewithkyle/jsql/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/codewithkyle/jsql/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/codewithkyle/jsql/releases/tag/v1.0.2
