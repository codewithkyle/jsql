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
```

## Writing Queries

```javascript
// Query data from IndexedDB
db.query("SELECT * FROM users LIMIT 10")
    .then(users => {
        users.map(user => { console.log(user) });
    })
    .catch(error => {
        console.error(error);
    });

// Insert data into IndexedDB
db.query("INSERT INTO users VALUES ($user1, $user2)", {
    user1: {
        name: "Frank",
        email: "franky123@example.com",
    },
    user2: {
        name: "April Summers",
        email: "popartfan18@example.com",
    }
});

// Build your own query object
db.raw({
    type: "SELECT",
    function: null,
    table: "users",
    columns: ["*"],
    offset: 0,
    limit: null,
    where: [{
        type: "INCLUDE",
        column: "nanme",
        values: ["Frank"],
    }],
    values: null,
    order: null,
    set: null,
});
```

## Interaces

```typescript
interface Settings {
    schema: string,
    dbWorker: string,
    streamParserWorker: string,
}

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
    where: Array<{
        type: "INCLUDE" | "EXCLUDE",
        column: string,
        values: Array<any>,
    }>,
    limit: number,
    offset: number,
    order: {
        column: string,
        by: "ASC" | "DESC",
    },
    values: Array<any>,
    set: {
        [column:string]: any,
    },
}
```
