# JSQL

Access IndexedDB with SQL.

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
import db from "@codewithkyle/jsql";

// Start the database
db.start();

// Override file URLs
db.start({
    scheam: "/scheam.json", // default
    dbWorker: "/js/jsql.worker.js", // defaults to CDN
    streamWorker: "/js/stream.worker.js", // defaults to CDN
});
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
    where: [
        [
            type: 1,
            columns: {
                name: ["Frank"],
            },
        ],
    ],
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
    streamWorker: string,
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

type SQLFunction = "COUNT" | "AVG" | "MIN" | "MAX" | "SUM";
type SQLStatement = "SELECT" | "UPDATE" | "DELETE" | "INSERT";

interface Check {
    type: number, // 0 = exclude, 1 = include
    columns: {
        [column:string]: Array<any>,
    },
};
export type Condition = Array<Check>;

interface Query {
    type: SQLStatement,
    function: SQLFunction,
    table: string,
    columns: Array<string>,
    where: Array<Condition>,
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

## Roadmap

- [x] Basic SQL queries
    - [x] SELECT
    - [x] DELETE
    - [x] INSERT INTO
    - [x] UPDATE
- [x] Simple WHERE (column = value, AND, OR, single layer parentheses groups)
- [x] LIMIT
- [x] OFFSET
- [x] Functions
    - [x] COUNT
    - [x] MIN
    - [x] MAX
    - [x] AVG
    - [x] SUM
- [x] Parameter injection
- [ ] JOIN
- [ ] Advanced WHERE (nested parentheses, greater than (or equal to), less than (or equal to))
- [ ] LIKE (`SELECT name FROM users WHERE name LIKE $query LIMIT 10`)
- [ ] RESET (`RESET *` to clear all tables or `RESET users` to clear one table)
