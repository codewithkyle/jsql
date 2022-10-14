import type { Table, Schema, Column, Query, SQLFunction, Condition, Check, Format, FormatType } from "../jsql";
import { openDB } from "./lib/idb";
import Fuse from "fuse.js";
import dayjs from "dayjs";

const CONDITIONS = /\=|\=\=|\!\=|\!\=\=|\>|\<|\>\=|\<\=|\!\>\=|\!\<\=|\!\>|\!\<|\bLIKE\b|\bINCLUDES\b|\bEXCLUDES\b|\bIN\b|\!\b\IN\b/gi;

const uuid: () => string = () => {
    // @ts-ignore
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
};

class JSQLWorker {
    private db: any;
    private tables: Array<Table>;
    private defaults: {
        [table: string]: {
            [column: string]: any;
        };
    };
    private schema: Schema;

    constructor() {
        this.db = null;
        this.tables = null;
        this.defaults = {};
        this.schema = null;
        self.onmessage = this.inbox.bind(this);
    }

    private async inbox(e: MessageEvent) {
        const { type, uid, data } = e.data;
        const debug = data?.debug ?? false;
        try {
            let output: any = null;
            switch (type) {
                case "init":
                    output = await this.init(data);
                    break;
                case "query":
                    let customQuery = [];
                    if (!Array.isArray(data)) {
                        customQuery = [data];
                    } else {
                        customQuery = data;
                    }
                    output = await this.performQuery(customQuery, debug);
                    break;
                case "sql":
                    const query = await this.buildQueriesFromSQL(data);
                    output = await this.performQuery(query, debug);
                    break;
                default:
                    console.warn(`Invalid JSQL Worker message type: ${type}`);
                    break;
            }
            this.send("response", output, uid);
        } catch (e) {
            if (data?.sql?.length) {
                console.groupCollapsed();
                console.error("Error: ", e);
                console.log("SQL: ", data.sql);
                console.log("Params:", data.params);
                console.groupEnd();
            }
            this.send("error", e, uid);
        }
    }

    private send(type: string, data: any = null, uid: string = null, origin = null) {
        const message = {
            type: type,
            data: data,
            uid: uid,
        };
        if (origin) {
            self.postMessage(message, origin);
        } else {
            self.postMessage(message);
        }
    }

    private async init(data) {
        let schema = data.schema;
        let currentVersion = data.currentVersion;
        if (typeof schema === "string") {
            const request = await fetch(schema, {
                method: "GET",
                headers: new Headers({
                    Accept: "application/json",
                }),
            });
            if (!request.ok) {
                throw `${request.status}: ${request.statusText}`;
            }
            schema = await request.json();
        }
        this.schema = schema;
        this.tables = schema.tables;
        for (let i = 0; i < this.tables.length; i++) {
            const table = this.tables[i];
            const columns = {};
            for (let c = 0; c < table.columns.length; c++) {
                columns[table.columns[c].key] = table.columns[c]?.default ?? null;
            }
            this.defaults[table.name] = columns;
        }
        const pTables = {};
        if (currentVersion !== null && parseInt(currentVersion) !== schema.version) {
            for (let i = 0; i < this.tables.length; i++) {
                if (this.tables[i]?.persist) {
                    pTables[this.tables[i].name] = [];
                }
            }
            await new Promise<void>((resolve) => {
                try {
                    const open = indexedDB.open(schema.name, parseInt(currentVersion));
                    open.onsuccess = async () => {
                        const oldDB = open.result;
                        for (const table in pTables) {
                            pTables[table] = await new Promise((tableResolve) => {
                                const tx = oldDB.transaction(table, "readonly").objectStore(table).getAll();
                                tx.onsuccess = () => {
                                    tableResolve(tx.result);
                                };
                            });
                        }
                        oldDB.close();
                        resolve();
                    };
                } catch (e) {
                    console.error(e);
                    resolve();
                }
            });
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 300);
        });
        // @ts-expect-error
        this.db = await openDB(schema.name, schema.version, {
            upgrade(db, oldVersion, newVersion, transaction) {
                // Purge old stores so we don't brick the JS runtime VM when upgrading
                for (const table of db.objectStoreNames) {
                    db.deleteObjectStore(table);
                }
                for (let i = 0; i < schema.tables.length; i++) {
                    const table: Table = schema.tables[i];
                    const options = {
                        keyPath: "id",
                        autoIncrement: false,
                    };
                    if (table?.keyPath) {
                        options.keyPath = table.keyPath;
                    }
                    if (typeof table.autoIncrement !== "undefined") {
                        options.autoIncrement = table.autoIncrement;
                        delete options["keyPath"]; // auto incremented keys must be out-of-line keys
                    }
                    const store = db.createObjectStore(table.name, options);
                    for (let k = 0; k < table.columns.length; k++) {
                        const column: Column = table.columns[k];
                        store.createIndex(column.key, column.key, {
                            unique: column?.unique ?? false,
                        });
                    }
                }
            },
            blocked() {
                console.error("This app needs to restart. Close all tabs for this app and before relaunching.");
            },
            blocking() {
                console.error("This app needs to restart. Close all tabs for this app and before relaunching.");
            },
        });
        const inserts = [];
        for (const table in pTables) {
            for (let r = 0; r < pTables[table].length; r++) {
                inserts.push(this.db.put(table, pTables[table][r]));
            }
        }
        await Promise.all(inserts);
        return schema.version;
    }

    private async performQuery(queries: Array<Query>, debug: boolean): Promise<Array<any>> {
        let rows = [];
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            const table = this.getTable(query.table);

            if (debug) {
                console.log(query);
            }

            let output = [];
            let skipWhere = false;
            let bypass = false;
            let optimized = false;

            // Query optimizer
            if (
                !query.uniqueOnly &&
                query.type === "SELECT" &&
                query.functions.length === 1 &&
                query.functions[0].function === "COUNT" &&
                query.functions[0].key.indexOf(".") === -1 &&
                (query.where === null ||
                    (query.where !== null &&
                        query.where.length === 1 &&
                        query.where[0].checks.length === 1 &&
                        !Array.isArray(query.where[0].checks[0]) &&
                        query.where[0].checks[0].type === "==" &&
                        !query.uniqueOnly))
            ) {
                // Optimize IDB query when we are only looking to count rows
                if (query.where === null) {
                    bypass = true;
                    optimized = true;
                    if (query.functions[0].key !== "*") {
                        output = await this.db.countFromIndex(query.table, query.functions[0].key);
                        // Fix output format & handle column alias
                        const value = {};
                        if (query.functions[0].column in query.columnAlias) {
                            value[query.columnAlias[query.functions[0].column]] = output;
                        } else {
                            value[query.functions[0].column] = output;
                        }
                        output = [value];
                    } else {
                        output = await this.db.count(query.table);
                        // Fix output format & handle column alias
                        const value = {};
                        if (query.columnAlias.length) {
                            for (let a = 0; a < query.columnAlias.length; a++) {
                                if (query.columnAlias[a].column === query.functions[0].column) {
                                    value[query.columnAlias[a].alias] = output;
                                }
                            }
                        } else {
                            value[query.functions[0].column] = output;
                        }
                        output = [value];
                    }
                } else {
                    optimized = true;
                    bypass = true;
                    // @ts-expect-error
                    output = await this.db.countFromIndex(query.table, query.where[0].checks[0].column, query.where[0].checks[0].value);
                }
            } else if (query.type === "SELECT") {
                // Optimize IDB query when we are only looking for 1 value from 1 column
                if (
                    query.where !== null &&
                    query.where.length === 1 &&
                    query.where[0].checks.length === 1 &&
                    !Array.isArray(query.where[0].checks[0]) &&
                    query.where[0].checks[0].type === "==" &&
                    query.where[0].checks[0].format === null &&
                    query.where[0].checks[0].column.indexOf(".") !== -1
                ) {
                    skipWhere = true;
                    optimized = true;
                    output = await this.db.getAllFromIndex(query.table, query.where[0].checks[0].column, query.where[0].checks[0].value);
                }
            }

            if (!optimized) {
                output = await this.db.getAll(query.table);
            }

            if (!bypass) {
                const transactions = [];
                switch (query.type) {
                    case "RESET":
                        if (query.table === "*") {
                            const clearTransactions = [];
                            for (let t = 0; t < this.tables.length; t++) {
                                clearTransactions.push(this.db.clear(this.tables[t].name));
                            }
                            await Promise.all(clearTransactions);
                        } else {
                            await this.db.clear(query.table);
                        }
                        break;
                    case "UPDATE":
                        if (query.where !== null && !skipWhere) {
                            output = this.handleWhere(query, output);
                        }
                        for (let r = 0; r < output.length; r++) {
                            let dirty = false;
                            for (const column in query.set) {
                                if (column === "*") {
                                    output[r] = query.set[column];
                                    dirty = true;
                                } else {
                                    if (column in output[r]) {
                                        output[r][column] = query.set[column];
                                        dirty = true;
                                    }
                                }
                            }
                            if (dirty) {
                                transactions.push(this.db.put(query.table, output[r]));
                            }
                        }
                        await Promise.all(transactions);
                        break;
                    case "DELETE":
                        if (query.where !== null && !skipWhere) {
                            output = this.handleWhere(query, output);
                        }
                        for (let r = 0; r < output.length; r++) {
                            transactions.push(this.db.delete(query.table, output[r][table.keyPath]));
                        }
                        await Promise.all(transactions);
                        break;
                    case "SELECT":
                        if (query.where !== null && !skipWhere) {
                            output = this.handleWhere(query, output);
                        }
                        if (query.uniqueOnly) {
                            output = this.getUnique(output, query.columns);
                        }
                        if (!query.columns.includes("*")) {
                            this.formatColumns(query, output);
                        }
                        if (query.functions.length) {
                            output = this.handleSelectFunction(query, output);
                        } else if (query.columns.length && query.columns[0] !== "*" && !query.uniqueOnly) {
                            this.filterColumns(query, output);
                        }
                        this.aliasColumns(query, output);
                        if (query.order !== null) {
                            this.sort(query, output);
                        }
                        if (query.limit !== null) {
                            output = output.splice(query.offset, query.limit);
                        }
                        break;
                    case "INSERT":
                        for (const row of query.values) {
                            const a = { ...this.defaults[query.table] };
                            const b = Object.assign(a, row);
                            if (table?.autoIncrement) {
                                await this.db.add(query.table, b);
                            } else {
                                await this.db.put(query.table, b);
                            }
                        }
                        output = query.values;
                        break;
                    default:
                        break;
                }
                if (query.group !== null) {
                    // @ts-ignore
                    output = this.buildGroups(output, query.group);
                }
            }
            if (Array.isArray(output)) {
                rows = [...rows, ...output];
            } else {
                rows.push(output);
            }
        }
        if (queries.length === 1 && queries[0].group !== null) {
            rows = rows[0];
        }
        return rows;
    }

    private buildGroups(rows: Array<any>, column: string) {
        const groups = {};
        for (let r = 0; r < rows.length; r++) {
            if (rows[r][column] in groups) {
                groups[rows[r][column]].push(rows[r]);
            } else {
                groups[rows[r][column]] = [rows[r]];
            }
        }
        return groups;
    }

    private getUnique(rows: Array<any>, columns: Array<string>) {
        let output = [];
        const claimedValues = [];
        const key = columns[0];
        for (let r = 0; r < rows.length; r++) {
            if (!claimedValues.includes(rows[r][key])) {
                claimedValues.push(rows[r][key]);
                output.push(rows[r][key]);
            }
        }
        return output;
    }

    private getTable(name: string): Table {
        let out = null;
        for (let i = 0; i < this.schema.tables.length; i++) {
            if (this.schema.tables[i].name === name) {
                out = this.schema.tables[i];
                break;
            }
        }
        return out;
    }

    private getValueFromKeyArray(keys: string[], obj: any): any {
        if (!keys.length) {
            throw "No object query keys.";
        }
        const key = keys[0];
        keys.splice(0, 1);
        if (!(key in obj)) {
            throw `${key} not found in column value.`;
        }
        if (keys.length) {
            return this.getValueFromKeyArray(keys, obj[key]);
        } else {
            return obj[key];
        }
    }

    private getCheckValue(check: Check, row: any): any {
        try {
            const columnInRow = check.column in row;
            let value = row?.[check.column] ?? null;
            if (value === null && !columnInRow) {
                if (check.column.indexOf(".") !== -1) {
                    const keys = check.column.split(".");
                    value = this.getValueFromKeyArray(keys, row);
                } else {
                    throw "Invalid column.";
                }
            }
            return value;
        } catch (e) {
            throw `SQL Error: unknown column '${check.column}' in WHERE clause.`;
        }
    }

    private check(check: Check, row: any): boolean {
        let didPassCheck = false;
        let value = this.getCheckValue(check, row);
        if (check.format !== null) {
            value = this.formatValue(check.format.type, value, check.format?.args);
        }
        switch (check.type) {
            case "LIKE":
                const fuse = new Fuse([row], {
                    keys: [check.column],
                    ignoreLocation: true,
                    threshold: 0.0,
                });
                const results = fuse.search(check.value);
                if (results.length) {
                    didPassCheck = true;
                }
                break;
            case "INCLUDES":
                if (Array.isArray(row[check.column]) && row[check.column].includes(check.value)) {
                    didPassCheck = true;
                }
                break;
            case "EXCLUDES":
                if (Array.isArray(row[check.column]) && !row[check.column].includes(check.value)) {
                    didPassCheck = true;
                }
                break;
            case ">=":
                if (value >= check.value) {
                    didPassCheck = true;
                }
                break;
            case ">":
                if (value > check.value) {
                    didPassCheck = true;
                }
                break;
            case "<=":
                if (value <= check.value) {
                    didPassCheck = true;
                }
                break;
            case "<":
                if (value < check.value) {
                    didPassCheck = true;
                }
                break;
            case "!>=":
                if (value < check.value) {
                    didPassCheck = true;
                }
                break;
            case "!>":
                if (value <= check.value) {
                    didPassCheck = true;
                }
                break;
            case "!==":
                if (value !== check.value) {
                    didPassCheck = true;
                }
                break;
            case "!=":
                if (value != check.value) {
                    didPassCheck = true;
                }
                break;
            case "!<=":
                if (value > check.value) {
                    didPassCheck = true;
                }
                break;
            case "!<":
                if (value >= check.value) {
                    didPassCheck = true;
                }
                break;
            case "==":
                if (value === check.value) {
                    didPassCheck = true;
                }
                break;
            case "=":
                if (value == check.value) {
                    didPassCheck = true;
                }
                break;
            case "IN":
                if (Array.isArray(check.value) && check.value.includes(row[check.column])) {
                    didPassCheck = true;
                }
                break;
            case "!IN":
                if (Array.isArray(check.value) && !check.value.includes(row[check.column])) {
                    didPassCheck = true;
                }
                break;
            default:
                break;
        }
        return didPassCheck;
    }

    private handleWhere(query: Query, rows: Array<any>): Array<any> {
        let output = [];
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            let hasOneValidCondition = false;
            for (let c = 0; c < query.where.length; c++) {
                const condition: Condition = query.where[c];
                let passes = 0;
                let passesRequired = condition.checks.length;
                for (let k = 0; k < condition.checks.length; k++) {
                    const check = condition.checks[k];
                    if (Array.isArray(check)) {
                        let subpasses = 0;
                        let subpassesRequired = check.length;
                        for (let j = 0; j < check.length; j++) {
                            if (this.check(check[j], row)) {
                                subpasses++;
                            }
                        }
                        if (subpasses === subpassesRequired) {
                            passes++;
                        }
                    } else {
                        if (this.check(check, row)) {
                            passes++;
                        }
                    }
                    if (passes !== 0 && !condition.requireAll) {
                        hasOneValidCondition = true;
                        break;
                    }
                }
                if (hasOneValidCondition || passes === passesRequired) {
                    hasOneValidCondition = true;
                    break;
                }
            }
            if (hasOneValidCondition) {
                output.push(row);
            }
        }
        return output;
    }

    private handleSelectFunction(query: Query, rows: Array<any>) {
        let output = {};
        for (let f = 0; f < query.functions.length; f++) {
            const column = query.functions[f].key;
            const outColumn = query.functions[f].column;
            const func = query.functions[f].function;
            let total = 0;
            switch (func) {
                case "MIN":
                    let min = null;
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (i === 0) {
                                min = value;
                            } else {
                                if (value < min) {
                                    min = value;
                                }
                            }
                        }
                    }
                    output[outColumn] = min;
                    break;
                case "MAX":
                    let max = null;
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (i === 0) {
                                max = value;
                            } else {
                                if (value > max) {
                                    max = value;
                                }
                            }
                        }
                    }
                    output[outColumn] = max;
                    break;
                case "SUM":
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (isNaN(value) || !isFinite(value)) {
                                value = 0;
                            }
                            total += value;
                        }
                    }
                    output[outColumn] = total;
                    break;
                case "AVG":
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (isNaN(value) || !isFinite(value)) {
                                value = 0;
                            }
                            total += value;
                        }
                    }
                    output[outColumn] = total / rows.length;
                    break;
                case "COUNT":
                    output[outColumn] = rows.length;
                    break;
                default:
                    break;
            }
        }
        return [output];
    }

    private sort(query: Query, rows: Array<any>): void {
        if (!rows.length) {
            return;
        }
        if (!(query.order.column in rows[0])) {
            throw `SQL Error: unknown column ${query.order.column} in ORDER BY.`;
        }
        if (query.order.by === "ASC") {
            rows.sort((a, b) => {
                const valueA = a[query.order.column];
                const valueB = b[query.order.column];
                return valueA >= valueB ? 1 : -1;
            });
        } else {
            rows.sort((a, b) => {
                const valueA = a[query.order.column];
                const valueB = b[query.order.column];
                return valueA >= valueB ? -1 : 1;
            });
        }
    }

    private filterColumns(query: Query, rows: Array<any>): void {
        if (!rows.length) {
            return;
        }
        const blacklist = [];
        for (const key in rows[0]) {
            let canBlacklist = true;
            if (query.columns.includes(key)) {
                canBlacklist = false;
            }
            // } else {
            //     let passedDeepCheck = false;
            //     for (let c = 0; c < query.columns.length; c++) {
            //         if (query.columns[c].indexOf(".") !== -1) {
            //             const keys = query.columns[c].split(".");
            //             if (keys[0] === key) {
            //                 try {
            //                     const value = this.getValueFromKeyArray(keys, rows[0]);
            //                     passedDeepCheck = true;
            //                     break;
            //                 } catch (e) {}
            //             }
            //         }
            //     }
            //     if (passedDeepCheck) {
            //         canBlacklist = false;
            //     }
            // }
            if (canBlacklist) {
                blacklist.push(key);
            }
        }
        for (let i = 0; i < blacklist.length; i++) {
            for (let j = 0; j < rows.length; j++) {
                delete rows[j]?.[blacklist[i]];
            }
        }
    }

    private formatValue(type: FormatType, value: any, args: any = null): any {
        let out = value;
        switch (type) {
            case "BOOL":
                switch (typeof value) {
                    case "string":
                        if (value.toLowerCase() === "true" || value === "1") {
                            out = true;
                        } else {
                            out = false;
                        }
                        break;
                    case "number":
                        out = value === 1 ? true : false;
                        break;
                    case "boolean":
                        break;
                    default:
                        out = false;
                        break;
                }
                break;
            case "DATE":
                const dateFormat = args || "u";
                if (dateFormat === "U") {
                    out = dayjs(value).unix();
                } else if (dateFormat === "u") {
                    out = dayjs(value).valueOf();
                } else if (dateFormat === "c") {
                    out = dayjs(value).toISOString();
                } else {
                    out = dayjs(value).format(args);
                }
                break;
            case "FLOAT":
                if (typeof value !== "number") {
                    out = parseFloat(value);
                }
                break;
            case "INT":
                if (typeof value !== "number") {
                    out = parseInt(value);
                }
                break;
            case "JSON":
                if (typeof value !== "object") {
                    out = JSON.parse(value);
                }
                break;
            default:
                break;
        }
        return out;
    }

    private aliasColumns(query: Query, rows: Array<any>): void {
        if (!rows.length) {
            return;
        }
        for (let i = 0; i < rows.length; i++) {
            for (let a = 0; a < query.columnAlias.length; a++) {
                const column = query.columnAlias[a].column;
                const alias = query.columnAlias[a].alias;
                if (!(column in rows[i])) {
                    throw `SQL Error: unknown column '${column}' in SELECT statement.`;
                }
                rows[i][alias] = rows[i][column];
                let canDelete = true;
                for (let f = 0; f < query.functions.length; f++) {
                    if (query.functions[f].key === column) {
                        canDelete = false;
                        break;
                    }
                }
                if (canDelete) {
                    for (let aa = a + 1; aa < query.columnAlias.length; aa++) {
                        if (query.columnAlias[aa].column === column) {
                            canDelete = false;
                            break;
                        }
                    }
                }
                if (!(column in query.columns) && canDelete) {
                    delete rows[i][column];
                }
            }
        }
    }

    private formatColumns(query: Query, rows: Array<any>): void {
        if (!rows.length) {
            return;
        }
        try {
            for (let i = 0; i < rows.length; i++) {
                // Handle deeply nested columns
                for (let c = 0; c < query.columns.length; c++) {
                    if (query.columns[c].indexOf(".") !== -1) {
                        try {
                            const keys = query.columns[c].split(".");
                            const value = this.getValueFromKeyArray(keys, rows[i]);
                            rows[i][query.columns[c]] = value;
                        } catch (e) {
                            throw query.columns[c];
                        }
                    }
                }
                // Handle deeply nested functions
                for (let c = 0; c < query.functions.length; c++) {
                    if (query.functions[c].key.indexOf(".") !== -1) {
                        try {
                            const keys = query.functions[c].key.split(".");
                            const value = this.getValueFromKeyArray(keys, rows[i]);
                            rows[i][query.functions[c].key] = value;
                        } catch (e) {
                            throw query.functions[c].key;
                        }
                    }
                }
                for (const column in query.columnFormats) {
                    if (column in rows[i]) {
                        rows[i][column] = this.formatValue(query.columnFormats[column].type, rows[i][column], query.columnFormats[column].args);
                    } else {
                        throw column;
                    }
                }
            }
        } catch (e) {
            throw `SQL Error: unknown column '${e}' in SELECT statement.`;
        }
    }

    private washStatement(sql, params): string {
        // Replace NOW() functions
        const nowFunctions: Array<string> = sql.match(/\bNOW\b\(.*?\)/gi) || [];
        for (let i = 0; i < nowFunctions.length; i++) {
            const format =
                nowFunctions[i]
                    .replace(/\'|\"/g, "")
                    .trim()
                    .match(/(?<=\().*(?=\))/g)?.[0] || null;
            const uid = uuid().replace(/\-/g, "");
            sql = sql.replace(nowFunctions[i], `$${uid}`);
            if (format === null || format === "u") {
                params[uid] = Date.now();
            } else if (format === "U") {
                params[uid] = dayjs().unix();
            } else if (format === "c") {
                params[uid] = dayjs().toISOString();
            } else {
                params[uid] = dayjs().format(format);
            }
        }

        // Replace DATE() functions
        const dateFunctions = sql.match(/\bDATE\b\(.*?\)/gi) || [];
        for (let i = 0; i < dateFunctions.length; i++) {
            const cleanValue = dateFunctions[i].replace(/\(|\)/g, "~").replace(/\'|\"/g, "").replace(/\s+/g, "").replace(/\,/g, ">");
            sql = sql.replace(dateFunctions[i], cleanValue);
        }

        // Replace INT() functions
        const intFunctions = sql.match(/\bINT\b\(.*?\)/gi) || [];
        for (let i = 0; i < intFunctions.length; i++) {
            const cleanValue = intFunctions[i].replace(/\(|\)/g, "~");
            sql = sql.replace(intFunctions[i], cleanValue);
        }

        // Repalce FLOAT() functions
        const floatFunctions = sql.match(/\bFLOAT\b\(.*?\)/gi) || [];
        for (let i = 0; i < floatFunctions.length; i++) {
            const cleanValue = floatFunctions[i].replace(/\(|\)/g, "~");
            sql = sql.replace(floatFunctions[i], cleanValue);
        }

        // Replace BOOL() functions
        const boolFunctions = sql.match(/\bBOOL\b\(.*?\)/gi) || [];
        for (let i = 0; i < boolFunctions.length; i++) {
            const cleanValue = boolFunctions[i].replace(/\(|\)/g, "~");
            sql = sql.replace(boolFunctions[i], cleanValue);
        }

        // Replace JSON() functions
        const jsonFunctions = sql.match(/\bJSON\b\(.*?\)/gi) || [];
        for (let i = 0; i < jsonFunctions.length; i++) {
            const cleanValue = jsonFunctions[i].replace(/\(|\)/g, "~");
            sql = sql.replace(jsonFunctions[i], cleanValue);
        }

        return sql;
    }

    private buildQueryFromStatement(sql, params = {}): Query {
        sql = this.washStatement(sql, params);
        const segments: Array<Array<string>> = this.parseSegments(sql);
        let query: Query = {
            uniqueOnly: false,
            type: null,
            functions: [],
            table: null,
            columns: [],
            offset: 0,
            limit: null,
            where: null,
            values: null,
            order: null,
            set: null,
            group: null,
            columnFormats: null,
            columnAlias: [],
        };
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i].join(" ");
            if (segment.indexOf("+") !== -1 || segment.indexOf("/") !== -1 || segment.indexOf("%") !== -1) {
                throw `Invalid syntax. Arithmetic operators are not currently supported.`;
            } else if (segment.indexOf("&") !== -1 || segment.indexOf("|") !== -1 || segment.indexOf("^") !== -1) {
                throw `Invalid syntax. Bitwise operators are not currently supported.`;
            }
            switch (segments[i][0].toUpperCase()) {
                case "SET":
                    query = this.parseSetSegment(segments[i], query, params);
                    break;
                case "VALUES":
                    query = this.parseValues(segments[i], query, params);
                    break;
                case "OFFSET":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.offset = parseInt(this.injectParameter(segments[i][1], params));
                    break;
                case "LIMIT":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.limit = parseInt(this.injectParameter(segments[i][1], params));
                    break;
                case "GROUP":
                    query = this.parseGroupBySegment(segments[i], query, params);
                    break;
                case "ORDER":
                    query = this.parseOrderBySegment(segments[i], query, params);
                    break;
                case "WHERE":
                    query = this.parseWhereSegment(segments[i], query, params);
                    break;
                case "FROM":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = this.injectParameter(segments[i][1], params);
                    break;
                case "SELECT":
                    query.type = "SELECT";
                    query = this.parseSelectSegment(segments[i], query, params);
                    break;
                case "DELETE":
                    query.type = "DELETE";
                    break;
                case "INSERT":
                    query.type = "INSERT";
                    query = this.parseInsertSegment(segments[i], query, params);
                    break;
                case "UPDATE":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = this.injectParameter(segments[i][1], params);
                    query.type = "UPDATE";
                    break;
                case "RESET":
                    if (segments[i].length !== 2) {
                        throw `Invalid syntax at: ${segments[i].join(" ")}`;
                    }
                    query.table = this.injectParameter(segments[i][1], params);
                    query.type = "RESET";
                    break;
                default:
                    throw `Invalid syntax at: ${segments[i].join(" ")}`;
            }
        }
        if (query.type === null) {
            throw `Invalid syntax: Missing SELECT, UPDATE, INSERT INTO, or DELETE statement.`;
        } else if (query.table === null) {
            throw `Invalid syntax: Missing FROM.`;
        } else if (query.type === "SELECT" && !query.columns.length && !query.functions.length) {
            throw `Invalid syntax: Missing columns.`;
        } else if (query.type === "INSERT" && query.values === null) {
            throw `Invalid syntax: Missing VALUES.`;
        } else if (query.type === "UPDATE" && query.set === null) {
            throw `Invalid syntax: Missing SET.`;
        } else if (query.type === "UPDATE" && query.where === null) {
            throw `Invalid syntax: Missing WHERE.`;
        } else if (isNaN(query.limit)) {
            throw `Invalid syntax: LIMIT is not a number.`;
        } else if (isNaN(query.offset)) {
            throw `Invalid syntax: OFFSET is not a number.`;
        }
        query.table = this.injectParameter(query.table, params);
        return query;
    }

    private async buildQueriesFromSQL({ sql, params }): Promise<Array<Query>> {
        sql = sql.replace(/\-\-.*|\;$/g, "").trim();
        const queries: Array<Query> = [];
        const statements = sql.split(/\bUNION\b/i);
        for (let i = 0; i < statements.length; i++) {
            queries.push(this.buildQueryFromStatement(statements[i], params));
        }
        return queries;
    }

    private parseSetSegment(segments: Array<string>, query: Query, params: any): Query {
        const columns = {};
        if (segments.length < 2) {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            query.set = {};
            segments.splice(0, 1);
            const groups = segments.join(" ").trim().split(",");
            for (let i = 0; i < groups.length; i++) {
                const values = groups[i].trim().split("=");
                if (values.length === 2) {
                    columns[values[0].trim()] = values[1].trim().replace(/^[\"\']|[\"\']$/g, "");
                } else if (values.length === 1) {
                    columns["*"] = values[0].trim().replace(/^[\"\']|[\"\']$/g, "");
                } else {
                    throw `Invalid syntax at: SET ${values.join(" ")}`;
                }
            }
        }
        for (const column in columns) {
            query.set[this.injectParameter(column, params)] = this.injectParameter(columns[column], params);
        }
        return query;
    }

    private buildConditionCheckFormat(statement: string): {
        format: Format | null;
        statement: string;
    } {
        let format = null;
        if (statement.indexOf("~") !== -1) {
            const type = statement
                .match(/\bDATE\b|\bBOOL\b|\bINT\b|\bJSON\b/i)[0]
                .trim()
                .toUpperCase() as FormatType;
            const column = statement
                .match(/\~.*?(\~|\>)/)[0]
                .replace(/\~|\>/g, "")
                .trim();
            let args = null;
            if (type === "DATE") {
                args =
                    statement
                        .match(/\>.*?\~/)?.[0]
                        ?.replace(/\~|\+|\>|\'|\"/g, "")
                        ?.trim() || null;
                if (args === null) {
                    throw `Invalid DATE function syntax. You must provide a format string.`;
                }
            }
            statement = statement.replace(/(\bDATE\b|\bBOOL\b|\bINT\b|\bJSON\b).*\~/i, column);
            format = {
                type: type,
                args: args,
            };
        }
        return {
            format: format,
            statement: statement,
        };
    }

    private buildConditionCheck(statement): Check | Array<Check> {
        let result;
        if (Array.isArray(statement)) {
            result = [];
            for (let i = 0; i < statement.length; i++) {
                const check: Check = {
                    column: "",
                    type: "=",
                    value: null,
                    format: null,
                };
                statement[i] = statement[i].trim().replace(/\'|\"/g, "");
                const { format, statement: s } = this.buildConditionCheckFormat(statement[i]);
                statement[i] = s;
                check.format = format;
                check.type = statement[i].match(CONDITIONS).join("").trim();
                const values = statement[i].split(check.type);
                check.column = values[0];
                check.value = values[1];
                result.push(check);
            }
        } else {
            const check: Check = {
                column: "",
                type: "=",
                value: null,
                format: null,
            };
            statement = statement.trim().replace(/\'|\"/g, "");
            const { format, statement: s } = this.buildConditionCheckFormat(statement);
            statement = s;
            check.format = format;
            check.type = statement.match(CONDITIONS).join("").trim();
            const values = statement.split(check.type);
            check.column = values[0].trim();
            check.value = values[1].trim();
            result = check;
        }
        return result;
    }

    /**
     * Build an array of Check objects.
     */
    private buildConditions(statement: string): Condition {
        const condition: Condition = {
            requireAll: true,
            checks: [],
        };
        let statements = [];
        if (statement.search(/\bOR\b/i) !== -1) {
            condition.requireAll = false;
            statements = statement.split(/\bOR\b/i);
            for (let i = 0; i < statements.length; i++) {
                if (statements[i].search(/\bAND\b/i) !== -1) {
                    statements.splice(i, 1, statements[i].split(/\bAND\b/i));
                }
            }
        } else {
            statements = statement.split(/\bAND\b/i);
        }
        for (let i = 0; i < statements.length; i++) {
            condition.checks.push(this.buildConditionCheck(statements[i]));
        }
        return condition;
    }

    private parseWhereSegment(segments: Array<string>, query: Query, params: any): Query {
        if (segments.length < 2) {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            query.where = [];
            segments.splice(0, 1);
            const groups = [];
            let openParentheses = 0;
            for (let i = segments.length - 1; i >= 0; i--) {
                let index = -1;
                openParentheses += (segments[i].match(/\)/g) || []).length;
                openParentheses -= (segments[i].match(/\(/g) || []).length;
                switch (segments[i].toUpperCase()) {
                    case "OR":
                        if (openParentheses === 0) {
                            index = i;
                        }
                        break;
                    default:
                        break;
                }
                if (index !== -1) {
                    groups.push(segments.splice(index, segments.length));
                } else if (i === 0) {
                    groups.push(segments.splice(0, segments.length));
                }
            }

            groups.reverse();

            for (let i = 0; i < groups.length; i++) {
                if (groups[i][0].toUpperCase() === "OR") {
                    groups[i].splice(0, 1);
                }
            }

            for (let i = 0; i < groups.length; i++) {
                let statement = groups[i].join(" ");
                statement = statement
                    .trim()
                    .replace(/^\(|\)$/g, "")
                    .trim();
                groups.splice(i, 1, statement);
            }

            const conditions = [];
            for (let i = 0; i < groups.length; i++) {
                const condition = this.buildConditions(groups[i]);
                conditions.push(condition);
            }

            query.where = conditions;

            for (let i = 0; i < query.where.length; i++) {
                for (let k = 0; k < query.where[i].checks.length; k++) {
                    if (Array.isArray(query.where[i].checks[k])) {
                        for (
                            let c = 0;
                            // @ts-ignore
                            c < query.where[i].checks[k].length;
                            c++
                        ) {
                            const check = query.where[i].checks[k][c] as Check;
                            query.where[i].checks[k][c].value = this.injectParameter(check.value, params);
                            query.where[i].checks[k][c].column = this.injectParameter(check.column, params);
                        }
                    } else {
                        const check = query.where[i].checks[k] as Check;
                        // @ts-ignore
                        query.where[i].checks[k].value = this.injectParameter(check.value, params);
                        // @ts-ignore
                        query.where[i].checks[k].column = this.injectParameter(check.column, params);
                    }
                }
            }
            return query;
        }
    }

    private parseGroupBySegment(segments: Array<string>, query: Query, params): Query {
        if (segments.length !== 3) {
            throw `Invalid syntax. GROUP BY only currently supports single column sorting.`;
        }
        if (query.uniqueOnly) {
            throw `Invalid syntax. GROUP BY can not be used with UNIQUE or DISTINCT statements.`;
        }
        query.group = this.injectParameter(segments[2], params);
        return query;
    }

    private parseOrderBySegment(segments: Array<string>, query: Query, params): Query {
        if (segments.length < 3 || segments[1] !== "BY") {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else {
            segments.splice(0, 2);
            if (segments.length > 2 || segments[0].indexOf(",") !== -1) {
                throw `Invalid syntax. ORDER BY only currently supports single column sorting.`;
            } else {
                let sort = "ASC";
                if (segments?.[1]) {
                    sort = segments[1].toUpperCase();
                    if (sort !== "ASC" && sort !== "DESC") {
                        throw `Invalid syntax. ORDER BY only currently supports ASC or DESC sorting.`;
                    }
                }
                query.order = {
                    column: this.injectParameter(segments[0], params),
                    // @ts-ignore
                    by: sort,
                };
            }
        }
        return query;
    }

    private parseValues(segments: Array<string>, query: Query, params: any): Query {
        if (segments.length === 1) {
            throw `Invalid syntax at: ${segments}.`;
        } else {
            query.values = [];
            segments.splice(0, 1);
            const objects = segments.join("").match(/(?<=\().*?(?=\))/g) || [];
            for (let i = 0; i < objects.length; i++) {
                const values = objects[i].split(",");
                for (let v = 0; v < values.length; v++){
                    let obj = { ...this.defaults[query.table] };
                    if (values[0].trim().indexOf("$") === 0){
                        obj = Object.assign(obj, this.injectParameter(values[v], params));
                        query.values.push(obj);
                    } else {
                        throw `Invalid syntax. VALUE error at ${objects[i]}`;
                    }
                }
            }
        }
        return query;
    }

    private injectParameter(value: string, params: object) {
        if (value.toString().indexOf("$") === 0) {
            const key = value.substring(1, value.length);
            if (key in params) {
                return params[key];
            } else {
                throw `Invalid params. Missing key: ${key}`;
            }
        } else if (typeof value === "string") {
            value = value.replace(/\bcount\b|\bmin\b|\bmax\b|\bavg\b|\bsum\b|\(|\)|\[|\]/gi, "").trim();
        }
        return value;
    }

    private parseInsertSegment(segments: Array<string>, query: Query, params): Query {
        if (segments.length < 3 || segments[1] !== "INTO") {
            throw `Invalid syntax at: ${segments.join(" ")}.`;
        } else if (segments.length === 3) {
            query.table = this.injectParameter(segments[2], params);
        } else {
            throw `Invalid syntax. Only 'INSERT INTO table_name' queries are currently supported.`;
        }
        return query;
    }

    private parseSelectSegment(segments: Array<string>, query: Query, params): Query {
        if (segments.includes("*")) {
            query.columns = ["*"];
        }

        // Removes SELECT string
        segments.splice(0, 1);

        if (segments[0].toUpperCase() === "DISTINCT" || segments[0].toUpperCase() === "UNIQUE") {
            if (segments.includes("*")) {
                throw `Invalid SELECT statement. DISTINCT or UNIQUE does not currently support the wildcard (*) character.`;
            }
            query.uniqueOnly = true;
            segments.splice(0, 1);
        }

        if (segments.length === 0) {
            throw `Invalid SELECT statement syntax.`;
        }

        // Clean segments
        const statement = segments
            .join(" ")
            .replace(/(?<=\~.*?)\s+(?=.*?\~)/g, "")
            .trim();
        segments = statement.split(",");

        let containsNonaggregatedData = false;
        let containsAggregatedData = false;
        for (let i = 0; i < segments.length; i++) {
            let seg = segments[i].trim();
            let alias = null;
            if (seg.search(/\bAS\b/i) !== -1) {
                alias = seg
                    .match(/\bAS.*\b/i)[0]
                    .replace(/\bAS\b/i, "")
                    .trim();
                alias = this.injectParameter(alias, params);
                seg = seg.replace(/\bAS.*\b/i, "").trim();
            }
            if (seg.length) {
                if (
                    seg.search(/\bCOUNT\b/i) === 0 ||
                    seg.search(/\bMIN\b/i) === 0 ||
                    seg.search(/\bMAX\b/i) === 0 ||
                    seg.search(/\bAVG\b/i) === 0 ||
                    seg.search(/\bSUM\b/i) === 0
                ) {
                    containsNonaggregatedData = true;
                    const type = seg.match(/\w+/)[0].trim().toUpperCase() as SQLFunction;
                    const column = seg
                        .match(/\(.*?\)/)[0]
                        .replace(/\(|\)/g, "")
                        .trim();
                    if (column === "*" && type !== "COUNT") {
                        throw `Invalid SELECT statement. Only the COUNT function be used with the wildcard (*) character.`;
                    }
                    query.functions.push({
                        column: seg,
                        key: column,
                        function: type,
                    });
                    if (alias !== null) {
                        query.columnAlias.push({
                            column: seg,
                            alias: alias,
                        });
                    }
                } else {
                    containsAggregatedData = true;
                    if (
                        seg.toUpperCase().search(/\bDATE\b/i) === 0 ||
                        seg.toUpperCase().search(/\bJSON\b/i) === 0 ||
                        seg.toUpperCase().search(/\bINT\b/i) === 0 ||
                        seg.toUpperCase().search(/\bBOOL\b/i) === 0 ||
                        seg.toUpperCase().search(/\bFLOAT\b/i) === 0
                    ) {
                        const type = seg.match(/\w+/)[0].trim().toUpperCase() as FormatType;
                        let column = seg
                            .match(/\~.*?(\~|\>)/)[0]
                            .replace(/\~|\>/g, "")
                            .trim();
                        column = this.injectParameter(column, params);
                        let args = null;
                        if (type === "DATE") {
                            args =
                                seg
                                    .match(/\>.*?\~/)?.[0]
                                    ?.replace(/\~|\+|\>|\'|\"/g, "")
                                    ?.trim() || null;
                            if (args === null) {
                                throw `Invalid DATE function syntax. You must provide a format string.`;
                            }
                        }
                        if (query.columnFormats === null) {
                            query.columnFormats = {};
                        }
                        query.columns.push(column);
                        query.columnFormats[column] = {
                            type: type,
                            args: args,
                        };
                        if (alias !== null) {
                            query.columnAlias.push({
                                column: column,
                                alias: alias,
                            });
                        }
                    } else {
                        const column = this.injectParameter(seg, params);
                        query.columns.push(column);
                        if (alias !== null) {
                            query.columnAlias.push({
                                column: column,
                                alias: alias,
                            });
                        }
                    }
                }
            }
        }
        if (containsAggregatedData && containsNonaggregatedData) {
            throw `Invalid SELECT syntax. SELECT list contains both aggergated and nonaggergated data.`;
        }
        return query;
    }

    private parseSegments(sql) {
        let textNodes: Array<string> = sql.trim().split(/\s+/);
        const segments = [];
        while (textNodes.length > 0) {
            let index = -1;
            for (let i = textNodes.length - 1; i >= 0; i--) {
                switch (textNodes[i].toUpperCase()) {
                    case "HAVING":
                        throw `Invalid syntax: HAVING clause is not currently supported.`;
                    case "UNION":
                        throw `Invalid syntax: UNION operator is not currently supported.`;
                    case "JOIN":
                        throw `Invalid syntax: JOIN clause is not currently supported.`;
                    case "SET":
                        index = i;
                        break;
                    case "VALUES":
                        index = i;
                        break;
                    case "OFFSET":
                        index = i;
                        break;
                    case "LIMIT":
                        index = i;
                        break;
                    case "ORDER":
                        index = i;
                        break;
                    case "WHERE":
                        index = i;
                        break;
                    case "FROM":
                        index = i;
                        break;
                    case "SELECT":
                        index = i;
                        break;
                    case "DELETE":
                        index = i;
                        break;
                    case "INSERT":
                        index = i;
                        break;
                    case "UPDATE":
                        index = i;
                        break;
                    case "RESET":
                        index = i;
                        break;
                    case "GROUP":
                        index = i;
                        break;
                    default:
                        break;
                }
                if (index !== -1) {
                    break;
                }
            }
            if (index === -1 && textNodes.length > 0) {
                throw `Invalid syntax: ${sql}`;
            } else {
                segments.push(textNodes.splice(index, textNodes.length));
            }
        }
        return segments;
    }
}
new JSQLWorker();
