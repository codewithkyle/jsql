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

> **Hint**: read the [setup guide](https://github.com/codewithkyle/jsql/wiki/Setup) for additional details and configuration options.

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
