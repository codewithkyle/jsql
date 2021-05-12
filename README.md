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
```

## Roadmap

- [x] Basic SQL queries
    - [x] `SELECT`
    - [x] `DELETE`
    - [x] `INSERT INTO`
    - [x] `UPDATE`
- [x] Simple `WHERE` (column = value, AND, OR, single layer parentheses groups)
- [x] `LIMIT`
- [x] `OFFSET`
- [x] Functions
    - [x] `COUNT()`
    - [x] `MIN()`
    - [x] `MAX()`
    - [x] `AVG()`
    - [x] `SUM()`
- [x] Parameter injection
- [ ] Advanced `WHERE` (greater than (or equal to), less than (or equal to))
- [x] `LIKE` (`SELECT name FROM users WHERE name LIKE $query LIMIT 10`)
- [x] `RESET` (`RESET *` to clear all tables or `RESET users` to clear one table)
- [ ] `SELECT DISTINCT` and `SELECT UNIQUE` statements
- [ ] Nested parentheses support
- [ ] `JOIN` clause