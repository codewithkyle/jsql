import type { Table, Schema, Column, Query, Condition, Check, FormatType } from "../jsql";
import { openDB } from "./lib/idb";
import Fuse from "fuse.js";
import dayjs from "dayjs";
import SqlQueryParser from "./parser";

class JSQLWorker {
    private db: any;
    private tables: Array<Table>;
    private defaults: {
        [table: string]: {
            [column: string]: any;
        };
    };
    private schema: Schema | null;;

    constructor() {
        this.db = null;
        this.tables = [];
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
                    let customQuery:Array<Query> = [];
                    if (data != null && !Array.isArray(data)) {
                        customQuery = [data];
                    } else {
                        customQuery = data;
                    }
                    output = await this.performQuery(customQuery, debug);
                    break;
                case "sql":
                    const { success, queries, error } = new SqlQueryParser(data.sql, data.params).parse();
                    if (!success) throw error;
                    output = await this.performQuery(queries, debug);
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

    private send(type: string, data: any = null, uid:string = "", origin = null) {
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

    private async init(data:any) {
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
            upgrade(db:any) {
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
                        // @ts-expect-error
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
                // @ts-expect-error
                inserts.push(this.db.put(table, pTables[table][r]));
            }
        }
        await Promise.all(inserts);
        return schema.version;
    }

    private async performQuery(queries: Array<Query>, debug: boolean): Promise<Array<any>> {
        let rows:Array<any> = [];
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            const table = this.getTable(query.table);

            if (table === null){
                throw `Invalid Syntax: missing 'table'.`;
            }

            if (debug) {
                console.log(query);
            }

            let output:Array<any> = [];
            let skipWhere = false;
            let bypass = false;
            let optimized = false;

            // Query optimizer
            if (
                !query.uniqueOnly &&
                query.type === "SELECT" &&
                query.functions?.length === 1 &&
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
                        const results:any = await this.db.countFromIndex(query.table, query.functions[0].key);
                        // Fix output format & handle column alias
                        const value:any = {};
                        if (query.columnAlias !== null && query.functions[0].column in query.columnAlias) {
                            value[query.columnAlias[query.functions[0].column]] = results;
                        } else {
                            value[query.functions[0].column] = results;
                        }
                        if (Object.keys(value)?.length > 0){
                            output = [value];
                        }
                    } else {
                        const results = await this.db.count(query.table);
                        // Fix output format & handle column alias
                        const value = {};
                        if (query.columnAlias?.length) {
                            for (let a = 0; a < query.columnAlias.length; a++) {
                                if (query.columnAlias[a].column === query.functions[0].column) {
                                    value[query.columnAlias[a].alias] = results;
                                }
                            }
                        } else {
                            value[query.functions[0].column] = results;
                        }
                        if (Object.keys(value)?.length > 0){
                            output = [value];
                        }
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
                                // @ts-expect-error
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
                                // @ts-expect-error
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
                            // @ts-expect-error
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
                        if (!query.columns?.includes("*")) {
                            this.formatColumns(query, output);
                        }
                        if (query.functions?.length) {
                            output = this.handleSelectFunction(query, output);
                        } else if (query.columns?.length && query.columns[0] !== "*" && !query.uniqueOnly) {
                            this.filterColumns(query, output);
                        }
                        this.aliasColumns(query, output);
                        if (query.order !== null) {
                            this.sort(query, output);
                        }
                        if (query.limit !== null) {
                            output = output.splice(query?.offset ?? 0, query.limit);
                        }
                        break;
                    case "INSERT":
                        if (query.values?.length){
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
                        }
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

    private getUnique(rows: Array<any>, columns: Array<string>|null) {
        if (columns === null){
            return [];
        }
        let output:Array<any> = [];
        const claimedValues:Array<string> = [];
        const key = columns[0];
        for (let r = 0; r < rows.length; r++) {
            const value = rows[r][key];
            if (Array.isArray(value)){
                for (let v = 0; v < value.length; v++){
                    if (!claimedValues.includes(value[v])) {
                        claimedValues.push(value[v]);
                        output.push(value[v]);
                    }
                }
            } else {
                if (!claimedValues.includes(rows[r][key])) {
                    claimedValues.push(rows[r][key]);
                    output.push(rows[r][key]);
                }
            }
        }
        return output;
    }

    private getTable(name: string|null): Table|null {
        let out:Table|null = null;
        if (!this.schema) {
            return null;
        }
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
        let output:Array<any> = [];
        if (!query.where?.length) {
            return output;
        }
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
        if (!query.functions?.length){
            return [];
        }
        for (let f = 0; f < query.functions.length; f++) {
            const column = query.functions[f].key;
            const outColumn = query.functions[f].column;
            const func = query.functions[f].function;
            let total = 0;
            switch (func) {
                case "MIN":
                    let min = 0;
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (i === 0) {
                                min = value;
                            } else if (value < min) {
                                min = value;
                            }
                        }
                    }
                    output[outColumn] = min;
                    break;
                case "MAX":
                    let max = 0;
                    for (let i = 0; i < rows.length; i++) {
                        if (rows[i]?.[column]) {
                            let value = rows[i][column];
                            if (i === 0) {
                                max = value;
                            } else if (value > max) {
                                max = value;
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
        if (query.order?.column && !(query.order.column in rows[0])) {
            throw `SQL Error: unknown column ${query.order.column} in ORDER BY.`;
        }
        if (query.order?.by && query.order.by === "ASC") {
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
        const blacklist:Array<string> = [];
        for (const key in rows[0]) {
            let canBlacklist = true;
            if (query.columns?.includes(key)) {
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
        if (!rows.length || !query.columnAlias?.length) {
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
                if (query.functions?.length){
                    for (let f = 0; f < query.functions.length; f++) {
                        if (query.functions[f].key === column) {
                            canDelete = false;
                            break;
                        }
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
                if (query.columns !== null && !(column in query.columns) && canDelete) {
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
}
new JSQLWorker();
