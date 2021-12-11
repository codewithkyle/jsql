# Update

The `UPDATE` statement is used to modify the existing records in a table.
```
UPDATE table_name SET column1 = value1, column2 = value2 WHERE condition = value
```

You can also update the entire record by providing the full model.

```
UPDATE tabe_name SET value WHERE condition = value
```

### Example

```typescript
// Partial update
await db.query("UPDATE Customers SET column1 = $value1, column2 = $value2 WHERE customerId = $key", { value1: "new value", value2: false, key: 4, });

// Overwrite
await db.query("UPDATE Customers SET $value WHERE customerId = $key", { value: {/*...snip...*/}, key: 4, });
```