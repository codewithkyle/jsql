# JSQL

Access IndexedDB data using SQL queries.

## Installation

Install via NPM

```bash
npm i -S @codewithkyle/jsql
```

Install via CDN

```javascript
import db from "https://cdn.jsdelivr.net/npm/@codewithkyle/jsql@1/jsql.js";
```

## Getting Started

```javascript
import db from "https://cdn.jsdelivr.net/npm/@codewithkyle/jsql@1/jsql.js";

// Start the database
db.start();

// Custom `scheam.json` file URL
db.start("/path/to/scheam/file.json");

// Self hosted worker script
db.start("/scheam.json", "/js/jsql.worker.js");

db.query("SELECT * FROM users LIMIT 10")
    .then(users => {
        users.map(user => { console.log(user) });
    })
    .catch(error => {
        console.error(error);
    })
```

## Interaces

```typescript
interface Schema {
    name: string;
    version: number;
    tables: Array<Table>;
}

interface Table {
    name: string;
    columns: Array<Column>;
    keyPath?: string;
    autoIncrement?: boolean;
}

interface Column {
    key: string;
    unique?: boolean;
}

interface Query {
    type: SQLStatement,
    function: SQLFunction,
    table: string,
    columns: Array<string>,
    where: {
        [column:string]: any,
    },
    limit: number,
    offset: number,
    order: {
        column: string,
        by: "ASC" | "DESC",
    },
    values: Array<any>,
}
```
