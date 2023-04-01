# Setup

We recommend downloading the Web Worker JavaScript files from the unpkg CDN and hosting the files yourself. Ideally from your own server or CDN.

### JSQL Database Worker

- [v1.x.x](https://unpkg.com/@codewithkyle/jsql@1/jsql.worker.js)

### Stream Parser Worker

- [v1.x.x](https://unpkg.com/@codewithkyle/jsql@1/stream.worker.js)

## JavaScript

```javascript
import db from "https://unpkg.com/@codewithkyle/jsql@1/jsql.js";

// Start the database
db.start();

// Override file URLs
db.start({
    scheam: `https://example.com/scheam.json`, // default - also supports an object
    dbWorker: `https://example.com/js/jsql.worker.js`, // defaults to CDN
    streamWorker: `https://example.com/js/stream.worker.js`, // defaults to CDN
    cache: ["table_1"], // defaults to false
});
```

## Caching

Caching is disabled by default.

```typescript
// Default
db.start({
    cache: false,
});

// Caches all tables
db.start({
    cache: true,
});

// Caches specificied tables
db.start({
    cache: ["table_1", "table_3"],
});
```

Not all tables need caching. We've found that tables that contain 0 - 1000 records provide fast queries without caching. However, in our testing when querying data from a 25,000+ table IndexedDB queries can take anywhere from 0.5 to 1.5 seconds. After caching the large tables can be queried within a few milliseconds.

Cached tables will be held in memory.

Auto Incremented tables cannot be cached.

## Schema

You can control the IndexedDB schema through a JSON file, API response, or hard code a schema object. Database changes are triggered by changing the `version` integer.

```json
{
    "name": "demo",
    "version": 1,
    "tables": [
        {
            "name": "users",
            "keyPath": "uid",
            "persist": true,
            "columns": [
                {
                    "key": "uid",
                    "unique": true
                },
                {
                    "key": "name",
                    "default": "John Smith"
                },
                {
                    "key": "customerId"
                }
            ]
        },
        {
            "name": "orders",
            "keyPath": "id",
            "columns": [
                {
                    "key": "id",
                    "unique": true,
                    "autoIncrement": true
                },
                {
                    "key": "name"
                },
                {
                    "key": "products"
                }
            ]
        }
    ]
}
```
