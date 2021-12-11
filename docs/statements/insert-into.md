# Insert Into

The `INSERT INTO` statement is used to insert new records in a table.

```
INSERT INTO table_name VALUES (value1, value2, value3)
```

## Known Limitations

Since JSQL runs on top of IndexedDB (a NoSQL database) the use of primary keys is slightly different than what you'd might expect. Let's review an example.

> **Note:** If you haven't familiarized yourself with defining the local database schema please read the [schema setup guide](https://github.com/codewithkyle/jsql/wiki/Setup#schema) first.

```javascript
await db.query("INSERT INTO users VALUES ($user)", { user: /* ...snip... */ });
``` 

In the query above we are inserting a new user into the `users` table. When performing the `INSERT INTO` statement two outcomes are possible.

1. The user model was inserted into the `users` table creating a new record.
1. A record already exists with the users `uid` key and the `INSERT INTO` becomes an `UPDATE` statement.

### How can we prevent this behavior?

We could change our `keyPath` to something else. For example the `products` table (see [schema guide](https://github.com/codewithkyle/jsql/wiki/Setup#schema)) uses a `keyPath` of `id` with the `id` column having `autoIncrement` set as true. If we adjust our schema we can insure that new users are always inserted instead of updated.

```json
{
    "name": "demo",
    "version": 1,
    "tables": [
        {
            "name": "users",
            "keyPath": "id",
            "autoIncrement": true,
            "columns": [
                {
                    "key": "uid",
                    "unique": true
                },
                {
                    "key": "name"
                },
                {
                    "key": "customerId",
                    "unique": true
                }
            ]
        }
    ]
}
```

This doesn't actually solve the underlying problem. For example if you provide a `user` model that contains an `id` key the `INSERT INTO` statement will still perform an `UPDATE` instead. This is simply a limitation of mapping SQL onto NoSQL, however, using an `id` key as your `keyPath` with `autoIncrement` is still your best option for preforming proper `INSERT INTO` statements.