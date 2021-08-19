import type { Table, Schema, Column, Query, SQLFunction, Condition, Check } from "../jsql";
import { openDB } from "./lib/idb";
import Fuse from 'fuse.js';

class JSQLWorker {
    private db:any;
    private tables: Array<Table>;

    constructor(){
        this.db = null;
        this.tables = null;
        self.onmessage = this.inbox.bind(this);
    }

    private async inbox(e:MessageEvent){
        const { type, uid, data } = e.data;
        try {
            let output:any = null;
            switch (type){
                case "init":
                    await this.init(data);
                    break;
                case "query":
                    let customQuery = [];
                    if (!Array.isArray(data)){
                        customQuery = [data];
                    } else {
                        customQuery = data;
                    }
                    output = await this.performQuery(customQuery);
                    break;
                case "sql":
                    const query = await this.buildQueriesFromSQL(data);
                    output = await this.performQuery(query);
                    break;
                default:
                    console.warn(`Invalid JSQL Worker message type: ${type}`);
                    break;
            }
            this.send("response", output, uid);
        } catch (e) {
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
			// @ts-expect-error
			self.postMessage(message);
		}
	}

    private async init(url){
        const request = await fetch(url, {
            method: "GET",
            headers: new Headers({
                Accept: "application/json",
            }),
            credentials: "include",
        });
        if (!request.ok){
            throw `${request.status}: ${request.statusText}`;
        }
        const scheam: Schema = await request.json();
        this.tables = scheam.tables;
        // @ts-expect-error
        this.db = await openDB(scheam.name, scheam.version, {
            upgrade(db, oldVersion, newVersion, transaction) {
                // Purge old stores so we don't brick the JS runtime VM when upgrading
                for (let i = 0; i < db.objectStoreNames.length; i++) {
                    db.deleteObjectStore(db.objectStoreNames[i]);
                }
                for (let i = 0; i < scheam.tables.length; i++) {
                    const table: Table = scheam.tables[i];
                    const options = {
                        keyPath: "id",
                        autoIncrement: false,
                    };
                    if (table?.keyPath) {
                        options.keyPath = table.keyPath;
                    }
                    if (typeof table.autoIncrement !== "undefined") {
                        options.autoIncrement = table.autoIncrement;
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
        return;
    }

    private async performQuery(queries:Array<Query>):Promise<Array<any>>{
        let rows = [];
        for (let i = 0; i < queries.length; i++){
            const query = queries[i];
            let output = [];
            let skipWhere = false;
            if (query.type !== "INSERT" && query.table !== "*"){
                // Optimize IDB query when we are only looking for 1 value from 1 column
                if (query.where !== null && query.where.length === 1 && query.where[0].checks.length === 1 && !Array.isArray(query.where[0].checks[0]) && query.where[0].checks[0].type === "=="){
                    skipWhere = true;
                    // @ts-ignore
                    output = await this.db.getAllFromIndex(query.table, query.where[0].checks[0].column, query.where[0].checks[0].value);
                } else {
                    output = await this.db.getAll(query.table);
                }
            }
            const transactions = [];
            switch(query.type){
                case "RESET":
                    if (query.table === "*"){
                        const clearTransactions = [];
                        for (let t = 0; t < this.tables.length; t++){
                            clearTransactions.push(this.db.clear(this.tables[t].name));
                        }
                        await Promise.all(clearTransactions);
                    } else {
                        await this.db.clear(query.table);
                    }
                    break;
                case "UPDATE":
                    if (query.where !== null && !skipWhere){
                        output = this.handleWhere(query, output);
                    }
                    for (let r = 0; r < output.length; r++){
                        let dirty = false;
                        console.log(query.set, output);
                        for (const column in query.set){
                            if (column in output[r]){
                                output[r][column] = query.set[column];
                                dirty = true;
                            }
                        }
                        if (dirty){
                            transactions.push(this.db.put(query.table, output[r]));
                        }
                    }
                    await Promise.all(transactions);
                    break;
                case "DELETE":
                    if (query.where !== null && !skipWhere){
                        output = this.handleWhere(query, output);
                    }
                    const key = this.getTableKey(query.table);
                    for (let r = 0; r < output.length; r++){
                        transactions.push(this.db.delete(query.table, output[r][key]));
                    }
                    await Promise.all(transactions);
                    break;
                case "SELECT":
                    if (query.where !== null && !skipWhere){
                        output = this.handleWhere(query, output);
                    }
                    break;
                case "INSERT":
                    for (const row of query.values){
                        await this.db.put(query.table, row);
                    }
                    output = query.values;
                    break;
                default:
                    break;
            }
            if (query.type === "SELECT"){
                if (query.function !== null){
                    output = this.handleSelectFunction(query, output);
                } else {
                    if (query.uniqueOnly){
                        output = this.getUnique(output, query.columns);
                    }
                    if (query.columns.length && query.columns[0] !== "*"){
                        output = this.filterColumns(query, output);
                    }
                    if (query.order !== null){
                        this.sort(query, output);
                    }
                    if (query.limit !== null){
                        output = output.splice(query.offset, query.limit);
                    }
                }
            }
            if (query.uniqueOnly){
                const temp = [];
                for (let i = 0; i < output.length; i++){
                    temp.push(output[i][query.columns[0]]);
                }
                output = temp;
            } else if (query.group !== null){
                // @ts-ignore
                output = this.buildGroups(output, query.group);
            }
            if (Array.isArray(output)){
                rows = [...rows, ...output];
            } else {
                rows.push(output);
            }
        }
        if (queries.length === 1 && queries[0].group !== null){
            rows = rows[0];
        }
        return rows;
    }

    private buildGroups(rows:Array<any>, column:string){
        const groups = {};
        for (let r = 0; r < rows.length; r++){
            if (rows[r][column] in groups){
                groups[rows[r][column]].push(rows[r]);
            } else {
                groups[rows[r][column]] = [rows[r]];
            }
        }
        return groups;
    }

    private getUnique(rows:Array<any>, columns:Array<string>){
        let output = [];
        const claimedValues = [];
        for (let r = 0; r < rows.length; r++){
            if (!claimedValues.includes(rows[r][columns[0]])){
                claimedValues.push(rows[r][columns[0]]);
                output.push(rows[r]);
            }
        }
        return output;
    }

    private getTableKey(table: string) {
		let key = "id";
		for (let i = 0; i < this.tables.length; i++) {
			if (this.tables[i].name === table) {
				if (this.tables[i]?.keyPath) {
					key = this.tables[i].keyPath;
				}
				break;
			}
		}
		return key;
	}

    private check(check:Check, row:any):boolean{
        let didPassCheck = false;
        switch (check.type){
            case "LIKE":
                const fuse = new Fuse([row], {
                    keys: [check.column],
                    ignoreLocation: true,
                    threshold: 0.0,
                });
                const results = fuse.search(check.value);
                if (results.length){
                    didPassCheck = true;
                }
                break;
            case "INCLUDES":
                if (Array.isArray(row[check.column]) && row[check.column].includes(check.value)){
                    didPassCheck = true;
                }
                break;
            case "EXCLUDES":
                if (Array.isArray(row[check.column]) && !row[check.column].includes(check.value)){
                    didPassCheck = true;
                }
                break;
            case ">=":
                if (row[check.column] >= check.value){
                    didPassCheck = true;
                }
                break;
            case ">":
                if (row[check.column] > check.value){
                    didPassCheck = true;
                }
                break;
            case "<=":
                if (row[check.column] <= check.value){
                    didPassCheck = true;
                }
                break;
            case "<":
                if (row[check.column] < check.value){
                    didPassCheck = true;
                }
                break;
            case "!>=":
                if (row[check.column] < check.value){
                    didPassCheck = true;
                }
                break;
            case "!>":
                if (row[check.column] <= check.value){
                    didPassCheck = true;
                }
                break;
            case "!==":
                if (row[check.column] !== check.value){
                    didPassCheck = true;
                }
                break;
            case "!=":
                if (row[check.column] != check.value){
                    didPassCheck = true;
                }
                break;
            case "!<=":
                if (row[check.column] > check.value){
                    didPassCheck = true;
                }
                break;
            case "!<":
                if (row[check.column] >= check.value){
                    didPassCheck = true;
                }
                break;
            case "==":
                if (row[check.column] === check.value){
                    didPassCheck = true;
                }
                break;
            case "=":
                if (row[check.column] == check.value){
                    didPassCheck = true;
                }
                break;
            default:
                break;
        }
        return didPassCheck;
    }

    private handleWhere(query:Query, rows:Array<any>):Array<any>{
        let output = [];
        for (let r = 0; r < rows.length; r++){
            const row = rows[r];
            let hasOneValidCondition = false;
            for (let c = 0; c < query.where.length; c++){
                const condition:Condition = query.where[c];
                let passes = 0;
                let passesRequired = condition.checks.length;
                for (let k = 0; k < condition.checks.length; k++){
                    const check = condition.checks[k];
                    if (Array.isArray(check)){
                        let subpasses = 0;
                        let subpassesRequired = check.length;
                        for (let j = 0; j < check.length; j++){
                            if (this.check(check[j], row)){
                                subpasses++;
                            }
                        }
                        if (subpasses === subpassesRequired){
                            passes++;
                        }
                    } else {
                        if (this.check(check, row)){
                            passes++;
                        }
                    }
                    if (passes !== 0 && !condition.requireAll){
                        hasOneValidCondition = true;
                        break;
                    }
                }
                if (hasOneValidCondition || passes === passesRequired){
                    hasOneValidCondition = true;
                    break;
                }
            }
            if (hasOneValidCondition){
                output.push(row);
            }
        }
        return output;
    }

    private handleSelectFunction(query:Query, rows:Array<any>){
        let output;
        switch(query.function){
            case "MIN":
                let min;
                for (let i = 0; i < rows.length; i++){
                    let value = rows[i]?.[query.columns[0]] ?? 0;
                    if (i === 0){
                        min = value;
                    } else {
                        if (value < min){
                            min = value;
                        }
                    }
                }
                output = min;
                break;
            case "MAX":
                let max;
                for (let i = 0; i < rows.length; i++){
                    let value = rows[i]?.[query.columns[0]] ?? 0;
                    if (i === 0){
                        max = value;
                    } else {
                        if (value > max){
                            max = value;
                        }
                    }
                }
                output = max;
                break;
            case "SUM":
                output = 0;
                for (let i = 0; i < rows.length; i++){
                    let value = rows[i]?.[query.columns[0]] ?? 0;
                    if (isNaN(value) || !isFinite(value)){
                        value = 0;
                    }
                    output += value;
                }
                break;
            case "AVG":
                let total = 0;
                for (let i = 0; i < rows.length; i++){
                    let value = rows[i]?.[query.columns[0]] ?? 0;
                    if (isNaN(value) || !isFinite(value)){
                        value = 0;
                    }
                    total += value;
                }
                output = total / rows.length;
                break;
            case "COUNT":
                output = rows.length;
                break;
            default:
                break;
        }
        return output;
    }

    private sort(query:Query, rows:Array<any>){
        if (query.order.by === "ASC"){
            rows.sort((a, b) => {
                const valueA = a?.[query.order.column] ?? 0;
                const valueB = b?.[query.order.column] ?? 0;
                return valueA >= valueB ? 1 : -1;
            });
        } else {
            rows.sort((a, b) => {
                const valueA = a?.[query.order.column] ?? 0;
                const valueB = b?.[query.order.column] ?? 0;
                return valueA >= valueB ? -1 : 1;
            });
        }
    }

    private filterColumns(query:Query, rows:Array<any>):Array<any>{
        let modifiedRows = [];
        for (let j = 0; j < rows.length; j++){
            const row = rows[j];
            const temp = {};
            for (let i = 0; i < query.columns.length; i++){
                temp[query.columns[i]] = row?.[query.columns[i]] ?? null;
            }
            modifiedRows.push(temp);
        }
        return modifiedRows;
    }

    private buildQueryFromStatement(sql, params = {}):Query{
        const segments:Array<Array<string>> = this.parseSegments(sql);
        let query:Query = {
            uniqueOnly: false,
            type: null,
            function: null,
            table: null,
            columns: null,
            offset: 0,
            limit: null,
            where: null,
            values: null,
            order: null,
            set: null,
            group: null,
        };
        for (let i = segments.length - 1; i >= 0; i--){
            const segment = segments[i].join(" ");
            if (segment.indexOf("+") !== -1 || segment.indexOf("/") !== -1 || segment.indexOf("%") !== -1){
                throw `Invalid syntax. Arithmetic operators are not currently supported ${segment}`;
            } else if (segment.indexOf("&") !== -1 || segment.indexOf("|") !== -1 || segment.indexOf("^") !== -1){
                throw `Invalid syntax. Bitwise operators are not currently supported`;
            }
            switch(segments[i][0].toUpperCase()){
                case "SET":
                    query = this.parseSetSegment(segments[i], query, params)
                    break;
                case "VALUES":
                    query = this.parseValues(segments[i], query, params);
                    break;
                case "OFFSET":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.offset = parseInt(segments[i][1]);
                    break;
                case "LIMIT":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.limit = parseInt(segments[i][1]);
                    break;
                case "GROUP":
                    query = this.parseGroupBySegment(segments[i], query);
                    break;
                case "ORDER":
                    query = this.parseOrderBySegment(segments[i], query);
                    break;
                case "WHERE":
                    query = this.parseWhereSegment(segments[i], query, params);
                    break;
                case "FROM":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.table = segments[i][1];
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
                    query = this.parseInsertSegment(segments[i], query);
                    break;
                case "UPDATE":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.table = segments[i][1];
                    query.type = "UPDATE";
                    break;
                case "RESET":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.table = segments[i][1];
                    query.type = "RESET";
                    break;
                default:
                    throw `Invalid syntax at: ${segments[i].join(" ")}`;
            }
        }
        if (query.type === null)
        {
            throw `Invalid syntax: Missing SELECT, UPDATE, INSERT INTO, or DELETE statement.`;
        }
        else if (query.table === null)
        {
            throw `Invalid syntax: Missing FROM.`;
        }
        else if (query.type === "SELECT" && query.columns === null)
        {
            throw `Invalid syntax: Missing columns.`;
        }
        else if (query.type === "INSERT" && query.values === null)
        {
            throw `Invalid syntax: Missing VALUES.`;
        }
        else if (query.type === "UPDATE" && query.set === null)
        {
            throw `Invalid syntax: Missing SET.`;
        }
        else if (query.type === "UPDATE" && query.where === null)
        {
            throw `Invalid syntax: Missing WHERE.`;
        }
        else if (isNaN(query.limit))
        {
            throw `Invalid syntax: LIMIT is not a number.`;
        }
        else if (isNaN(query.offset))
        {
            throw `Invalid syntax: OFFSET is not a number.`;
        }
        query.table = this.injectParameter(query.table, params);
        return query;
    }

    private async buildQueriesFromSQL({ sql, params }):Promise<Array<Query>>{
        sql = sql.replace(/\-\-.*|\;$/g, "").trim();
        const queries:Array<Query> = [];
        const statements = sql.split(/\bUNION\b/i);
        for (let i = 0; i < statements.length; i++){
            queries.push(this.buildQueryFromStatement(statements[i], params));
        }
        return queries;
    }

    private parseSetSegment(segments:Array<string>, query:Query, params:any):Query{
        if (segments.length < 2)
        {
            throw `Invalid syntax at: ${segments.join(" ")}.`
        }
        else
        {
            query.set = {};
            segments.splice(0, 1);
            const groups = segments.join(" ").trim().split(",");
            for (let i = 0; i < groups.length; i++){
                const values = groups[i].trim().split("=");
                if (values.length !== 2){
                    throw `Invalid syntax at: ${groups[i]}`;
                }
                query.set[values[0].trim()] = values[1].trim().replace(/^[\"\']|[\"\']$/g, "");
            }
        }
        for (const column in query.set){
            query.set[column] = this.injectParameter(query.set[column], params);
        }
        return query;
    }

    private buildConditionCheck(statement):Check|Array<Check>{
        let result;
        if (Array.isArray(statement)){
            result = [];
            for (let i = 0; i < statement.length; i++){
                const check:Check = {
                    column: "",
                    type: "=",
                    value: null,
                };
                statement[i] = statement[i].trim().replace(/\'|\"/g, "");
                check.type = statement[i].match(/\=|\=\=|\!\=|\!\=\=|\>|\<|\>\=|\<\=|\!\>\=|\!\<\=|\!\>|\!\<|\bLIKE\b|\bINCLUDES\b|\bEXCLUDES\b/ig).join("").trim();
                const values = statement[i].split(check.type);
                check.column = values[0];
                check.value = values[1];
                result.push(check);
            }
        } else {
            const check:Check = {
                column: "",
                type: "=",
                value: null,
            };
            statement = statement.trim().replace(/\'|\"/g, "");
            check.type = statement.match(/\=|\=\=|\!\=|\!\=\=|\>|\<|\>\=|\<\=|\!\>\=|\!\<\=|\!\>|\!\<|\bLIKE\b|\bINCLUDES\b|\bEXCLUDES\b/ig).join("").trim();
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
    private buildConditions(statement:string):Condition{
        const condition:Condition = {
            requireAll: true,
            checks: []
        };
        let statements = [];
        if (statement.search(/\bOR\b/i) !== -1){
            condition.requireAll = false;
            statements = statement.split(/\bOR\b/i);
            for (let i = 0; i < statements.length; i++){
                if (statements[i].search(/\bAND\b/i) !== -1){
                    statements.splice(i, 1, statements[i].split(/\bAND\b/i));
                }
            }
        } else {
            statements = statement.split(/\bAND\b/i);
        }
        for (let i = 0; i < statements.length; i++){
            condition.checks.push(this.buildConditionCheck(statements[i]));
        }
        return condition;
    }

    private parseWhereSegment(segments:Array<string>, query:Query, params:any):Query{
        if (segments.length < 2)
        {
            throw `Invalid syntax at: ${segments.join(" ")}.`
        }
        else
        {
            query.where = [];
            segments.splice(0, 1);
            const groups = [];
            let openParentheses = 0;
            for (let i = segments.length - 1; i >= 0; i--){
                let index = -1;
                openParentheses += (segments[i].match(/\)/g) || []).length;
                openParentheses -= (segments[i].match(/\(/g) || []).length;
                switch (segments[i].toUpperCase()){
                    case "OR":
                        if (openParentheses === 0){
                            index = i;
                        }
                        break;
                    default:
                        break;
                }
                if (index !== -1){
                    groups.push(segments.splice(index, segments.length));
                } else if (i === 0){
                    groups.push(segments.splice(0, segments.length));
                }
            }

            groups.reverse();

            for (let i = 0; i < groups.length; i++){
                if (groups[i][0].toUpperCase() === "OR"){
                    groups[i].splice(0, 1);
                }
            }

            for (let i = 0; i < groups.length; i++){
                let statement = groups[i].join(" ");
                statement = statement.trim().replace(/^\(|\)$/g, "").trim();
                groups.splice(i, 1, statement);
            }

            const conditions = [];
            for (let i = 0; i < groups.length; i++){
                const condition = this.buildConditions(groups[i]);
                conditions.push(condition);
            }

            query.where = conditions;

            for (let i = 0; i < query.where.length; i++){
                for (let k = 0; k < query.where[i].checks.length; k++){
                    if (Array.isArray(query.where[i].checks[k])){
                        // @ts-ignore
                        for (let c = 0; c < query.where[i].checks[k].length; c++){
                            const check = query.where[i].checks[k][c] as Check;
                            const value = this.injectParameter(check.value, params);
                            query.where[i].checks[k][c].value = value;
                        }
                    } else {
                        const check = query.where[i].checks[k] as Check;
                        const value = this.injectParameter(check.value, params);
                        query.where[i].checks[k] = value;
                    }
                }
            }
            return query;
        }
    }

    private parseGroupBySegment(segments:Array<string>, query:Query):Query{
        if (segments.length !== 3){
            throw `Invalid syntax. GROUP BY only currently supports single column sorting.`;
        }
        if (query.uniqueOnly){
            throw `Invalid syntax. GROUP BY can not be used with UNIQUE or DISTINCT statements.`
        }
        query.group = segments[2];
        return query;
    }

    private parseOrderBySegment(segments:Array<string>, query:Query):Query{
        if (segments.length < 3 || segments[1] !== "BY")
        {
            throw `Invalid syntax at: ${segments.join(" ")}.`
        }
        else
        {
            segments.splice(0, 2);
            if (segments.length > 2 || segments[0].indexOf(",") !== -1)
            {
                throw `Invalid syntax. ORDER BY only currently supports single column sorting.`
            }
            else
            {
                let sort = "ASC";
                if (segments?.[1]){
                    sort = segments[1].toUpperCase();
                    if (sort !== "ASC" && sort !== "DESC"){
                        throw `Invalid syntax. ORDER BY only currently supports ASC or DESC sorting.`
                    }
                }
                query.order = {
                    column: segments[0],
                    // @ts-ignore
                    by: sort,
                }
            }
        }
        return query;
    }

    private parseValues(segments:Array<string>, query:Query, params:any):Query{
        if (segments.length === 1)
        {
            throw `Invalid syntax at: ${segments}.`
        }
        else
        {
            query.values = [];
            segments.splice(0, 1);
            const values = segments.join("").replace(/\(|\)|\s/g, "").split(",");
            for (let i = 0; i < values.length; i++){
                query.values.push(this.injectParameter(values[i], params));
            }
        }
        return query;
    }

    private injectParameter(value:string, params:object){
        if (value.indexOf("$") === 0){
            const key = value.substring(1, value.length);
            if (key in params){
                return params[key];
            } else {
                throw `Invalid params. Missing key: ${key}`;
            }
        }
        return value;
    }

    private parseInsertSegment(segments:Array<string>, query:Query):Query{
        if (segments.length < 3 || segments[1] !== "INTO")
        {
            throw `Invalid syntax at: ${segments.join(" ")}.`
        }
        else if (segments.length === 3)
        {
            query.table = segments[2];
        }
        else
        {
            throw `Invalid syntax. Only 'INSERT INTO table_name' queries are currently supported.`
        }
        return query;
    }

    private parseSelectSegment(segments:Array<string>, query:Query, params):Query{
        if (segments.includes("*"))
        {
            query.columns = ["*"];
        }
        if (segments[1].toUpperCase() === "DISTINCT" || segments[1].toUpperCase() === "UNIQUE")
        {
            if (segments.includes("*")){
                throw `Invalid SELECT statement. DISTINCT or UNIQUE does not currently support the wildcard (*) character.`;
            }
            query.uniqueOnly = true;
            segments.splice(1, 1);
            if (segments.length > 2){
                throw `Invalid SELECT statement. DISTINCT or UNIQUE does not currently support multiple columns.`
            }
        }
        else if (segments[1].toUpperCase().search(/\bCOUNT\b/i) === 0 || segments[1].toUpperCase().search(/\bMIN\b/i) === 0 || segments[1].toUpperCase().search(/\bMAX\b/i) === 0 || segments[1].toUpperCase().search(/\bAVG\b/i) === 0 || segments[1].toUpperCase().search(/\bSUM\b/i) === 0)
        {
            if (segments.includes("*")){
                throw `Invalid SELECT statement. Functions can not be used with the wildcard (*) character.`;
            }
            const type = segments[1].match(/\w+/)[0].trim().toUpperCase();
            const column = segments[1].match(/\(.*?\)/)[0].replace(/\(|\)/g, "").trim();
            query.function = type as SQLFunction;
            query.columns = [column];
        }
        if (query.columns === null){
            if (segments.length === 1)
            {
                throw `Invalid SELECT statement syntax.`;
            }
            query.columns = [];
            for (let i = 1; i < segments.length; i++)
            {
                const cols = segments[i].split(",");
                for (let j = 0; j < cols.length; j++){
                    const col = cols[j].trim();
                    if (col.length){
                        query.columns.push(this.injectParameter(col, params));
                    }
                }
            }
        }
        return query;
    }

    private parseSegments(sql){
        let textNodes:Array<string> = sql.trim().split(/\s+/);
        const segments = [];
        while(textNodes.length > 0){
            let index = -1;
            for (let i = textNodes.length - 1; i >= 0; i--){
                switch(textNodes[i].toUpperCase()){
                    case "HAVING":
                        throw `Invalid syntax: HAVING clause is not currently supported.`
                    case "UNION":
                        throw `Invalid syntax: UNION operator is not currently supported.`
                    case "JOIN":
                        throw `Invalid syntax: JOIN clause is not currently supported.`
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
                if (index !== -1){
                    break;
                }
            }
            if (index === -1 && textNodes.length > 0){
                throw `Invalid syntax: ${sql}`;
            } else {
                segments.push(textNodes.splice(index, textNodes.length));
            }
        }
        return segments;
    }
}
new JSQLWorker();
