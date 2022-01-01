# SQL Functions

## Min

The `MIN()` function returns the smallest value of the selected column.

```
SELECT MIN(column_name) FROM table_name WHERE condition
```

## Max

The `MAX()` function returns the largest value of the selected column.

```
SELECT MAX(column_name) FROM table_name WHERE condition
```

## Count

The `COUNT()` function returns the number of rows that matches a specified criterion.

```
SELECT COUNT(column_name) FROM table_name WHERE condition
```

## Avg

The `AVG()` function returns the average value of a numeric column.

```
SELECT AVG(column_name) FROM table_name WHERE condition
```

## Sum

The `SUM()` function returns the total sum of a numeric column.

```
SELECT SUM(column_name) FROM table_name WHERE condition
```

## Now

The `NOW()` function injects a parameter mapped to the number of milliseconds elapsed since January 1, 1970 00:00:00 UTC.

```
SELECT * FROM table_name WHERE expiresAt >= NOW()
```

You can format the value using the default [day.js formats](https://day.js.org/docs/en/display/format). For your convenience an ISO 8601 date format is available using the custom `c` format and a Unix timestamp is available using the custom `U` format.

```
SELECT * FROM table_name WHERE expiresAt >= NOW('YYYY-MM-DD')
```
