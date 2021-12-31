# JSQL

Access IndexedDB with SQL.

## Installation

Install via NPM

```bash
npm i -S @codewithkyle/jsql
```

Install via CDN

```javascript
import db from "https://unpkg.com/@codewithkyle/jsql@1/jsql.js";
```

## Getting Started

```javascript
import db from "https://unpkg.com/@codewithkyle/jsql@1/jsql.js";
db.start();
```

> **Hint**: read the [setup guide](https://jsql.codewithkyle.com/guides/setup) for additional details and configuration options.

## Writing Queries

Insert data into IndexedDB

```javascript
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

Query data from IndexedDB

```javascript
const users = await db.query("SELECT * FROM users LIMIT 10")
users.map(user => console.log(user));
```
