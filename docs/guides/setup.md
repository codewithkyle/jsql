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
});
```

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