# Select

The `SELECT` statement is used to select data from a database. The data returned is stored in a result table, called the result-set.

```
SELECT column1, column2 FROM table_name
```

Here, column1 and column2 are the field names of the table you want to select data from. If you want to select all the fields available in the table, use the following syntax:

```
SELECT * FROM table_name
```

## Unique Values

You can use the `SELECT UNIQUE` or `SELECT DISTINCT` statement to retrieve an array of unique values from the database.

```
SELECT UNIQUE column FROM table_name
```

> **Note:** JSQL only supports selecting unique values from a single column.