# Union Operator

The `UNION` operator is used to combine the result-set of two or more statements.

```
SELECT * FROM table_name WHERE condition = value UNION SELECT * FROM another_table
```

In JSQL the `UNION` operator can combine different record models and can even be used to join several operations.

```
DELETE FROM table_name WHERE condition = value UNION SELECT * FROM table_name
```