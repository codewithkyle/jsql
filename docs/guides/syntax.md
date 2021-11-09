# Syntax

## SQL Statements

Most of the actions you need to perform on a database are done with SQL statements. The following SQL statement selects all the records in the "Customers" table:

```
SELECT * FROM Customers
```

## Supported SQL Commands:

- `SELECT` - extracts data from a database
- `UPDATE` - updates data in a database
- `DELETE` - deletes data from a database
- `INSERT INTO` - inserts new data into a database

## Injecting Parameters

If you need to provide non-string values use parameter injections. In the following SQL statement the number `4` will be injected into the query:

```
SELECT * from Customers WHERE customerId = $id
```

In JavaScript you will provide the parameter to the parameters object after your query:

```typescript
const customer = await db.query("SELECT * from Customers WHERE customerId = $id", { id: 4 });
```

## Reserved Keywords

Some keywords such as `ORDER` are reserved. If you wish to use a reserved keyword as a column name you will need to wrap the column name within square brackets `[ ]` when writing your SQL queries.

```
SELECT [order], name, uid FROM table_name ORDER BY [order] DESC
```