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

## Interaces

```typescript
type Schema = {
    name: string;
	version: number;
	tables: Array<Table>;
};

type Table = {
	name: string;
	columns: Array<Column>;
	keyPath?: string;
	autoIncrement?: boolean;
};

type Column = {
	key: string;
	unique?: boolean;
};
```
