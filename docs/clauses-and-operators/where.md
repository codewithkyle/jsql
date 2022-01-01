# Where Clause

The `WHERE` clause is used to filter records. It is used to extract only those records that fulfill a specified condition.

```
SELECT * FROM table_name WHERE condition
```

> **Note:** the `WHERE` clause is not only used in `SELECT` statements.

## AND / OR Operators

The `WHERE` clause can be combined with `AND` and `OR` operators. The `AND` and `OR` operators are used to filter records based on more than one condition:

-   The `AND` operator displays a record if all the conditions separated by `AND` are TRUE.
-   The `OR` operator displays a record if any of the conditions separated by `OR` is TRUE.

```
SELECT * FROM table_name WHERE condition = value OR condition = value
```

You can also combine the AND / OR operators along with using parenthesis to form complex expressions:

```
SELECT * FROM table_name WHERE condition = value AND (condition = value OR condition = value)
```

### Known Limitations

Currently JSQL is limited to single top level parenthesis groups and any query preformed with nested groups will result in a `Invalid Syntax` error. For the time being queries will need to be written to work around this limitation. In the example below the top level parenthesis group is only a visual aid for developers, functionally the statement is the same as the one below it.

```
SELECT * FROM table_name WHERE (a=1 OR a=2) AND (b=1 AND (c=1 OR c=2))
SELECT * FROM table_name WHERE (a=1 OR a=2) AND b=1 AND (c=1 OR c=2)
```

Since the `AND` operator requires the values on both sides to return true removing the top level parenthesis doesn't have an effect on the system. In the example below the same type of rewrite is applied to an `OR` operation.

```
SELECT * FROM table_name WHERE (a=1 OR a=2) AND (b=1 OR (c=1 OR c=2))
SELECT * FROM table_name WHERE (a=1 OR a=2) AND (b=1 OR c=1 OR c=2)
```

Again, the top level parenthesis doesn't have an effect on the logic being performed, it's simply a visual aid. However, complex queries do sometimes require nested parenthesis like in the example below where we need to preform several `OR` and `AND` operations.

```
SELECT * FROM table_name WHERE (a=1 OR a=2) AND (b=1 OR (c=1 AND d=1) OR (d=2 AND e=1))
```

We are still able to work around this limitation, however, it requires us to repeat the `(a=1 OR a=2)` check across three separate conditions.

```
SELECT * FROM table_name WHERE (a=1 OR a=2) AND b=1 OR (a=1 OR a=2) AND c=1 AND d=1 OR (a=1 OR a=2) AND d=2 AND e=1)
```

Support for nested groups is currently on the project roadmap with the current goal being the addition of second level groups.

### What if I need support for deeply (3+ layer) nested groups?

Honestly, you have a few options available:

1. Write your queries to work within the current limitations.
1. Perform your complex queries on your actual SQL database.
1. Switch to a proper SQL database implementation such as [sql.js](https://sql.js.org/#/) (SQLite via WASM)
1. Fork this repository, implement this feature, and become the hero we need.

## Logical Operators

When creating `WHERE` clauses you can use the following logical operators beyond the traditional `=` operator.

```typescript
type CheckOperation = "=" | "==" | "!=" | "!==" | ">" | "<" | ">=" | "<=" | "!>=" | "!<=" | "!>" | "!<" | "LIKE" | "INCLUDES" | "EXCLUDES" | "IN" | "!IN";
```

> **Note**: these operators relate to the JavaScript operators where `=` would be `==` and `==` would be `===` so you'll need to keep in mind the [whacky way JavaScript handles equality](https://github.com/denysdovhan/wtfjs#-examples).

## Using `NULL` Values

Use parameter injection to provide the `null` value.

```javascript
await db.query("SELECT * FROM table_name WHERE column_name = $value", { value: null });
```

## Search

The `LIKE` operator is used in a `WHERE` clause to search for a specified pattern in a column.

```
SELECT * FROM table_name WHERE column LIKE value
```

> **Note:** Search uses a modified [Bitap algorithm](https://en.wikipedia.org/wiki/Bitap_algorithm) implemented via [Fuse.js](https://fusejs.io/). Also we've chosen to override the Fuse.js `ignoreLocation` default to true. This means that if the columns value contains the value at any location within the string it will always be included in the output. We also use a strict threshold of `0.0` meaning Fuse must find an exact match in order to return the result.
