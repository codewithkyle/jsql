import type { Table, Schema, Column, Query, SQLFunction, Condition, Check } from "../jsql";
import { openDB, deleteDB } from "./lib/idb";

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
                if (query.where !== null && query.where.length === 1 && query.where[0].length === 1 && Object.keys(query.where[0][0].columns).length === 1 && query.where[0][0].columns[Object.keys(query.where[0][0].columns)[0]].length === 1){
                    skipWhere = true;
                    output = await this.db.getAllFromIndex(query.table, Object.keys(query.where[0][0].columns)[0], query.where[0][0].columns[Object.keys(query.where[0][0].columns)[0]][0]);
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
                        for (const column in query.set){
                            if (column in output[r]){
                                output[r][column] = query.set[column];
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
            if (output.length){
                rows = [...rows, ...output];
            }
        }
        return rows;
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

    private handleWhere(query:Query, rows:Array<any>):Array<any>{
        let output = [];
        for (let r = 0; r < rows.length; r++){
            const row = rows[r];
            let hasOneValidCondition = false;
            for (let c = 0; c < query.where.length; c++){
                const condition = query.where[c];
                let passes = 0;
                for (let k = 0; k < condition.length; k++){
                    const check = condition[k];
                    let checksPassed = 0;
                    let checksNeeded = 0;
                    for (const column in check.columns){
                        let match = false;
                        if (check.type === 0){
                            checksNeeded += check.columns[column].length;
                        }
                        for (let v = 0; v < check.columns[column].length; v++){
                            const value = check.columns[column][v];
                            if (check.type){
                                switch(typeof row[column]){
                                    case "object":
                                        if (Array.isArray(row[column])){
                                            if (row[column].includes(value)){
                                                passes++;
                                                match = true;
                                            }
                                        } else if (value in row[column]){
                                            passes++;
                                            match = true;
                                        }
                                        break;
                                    case "undefined":
                                        throw `Invalid query. ${query.table} does not contain column ${column}`;
                                    default:
                                        if (row[column] === value){
                                            passes++;
                                            match = true;
                                        }
                                        break;
                                }
                            } else {
                                switch(typeof row[column]){
                                    case "object":
                                        if (Array.isArray(row[column])){
                                            if (!row[column].includes(value)){
                                                checksPassed++;
                                            }
                                        } else if (value === null && typeof row[column] === "undefined"){
                                            checksPassed++;
                                        }
                                        break;
                                    case "undefined":
                                        throw `Invalid query. ${query.table} does not contain column ${column}`;
                                    default:
                                        if (row[column] !== value){
                                            checksPassed++;
                                        }
                                        break;
                                }
                            }
                            if (match){
                                break;
                            }
                        }
                        if (match){
                            break;
                        }
                    }
                    if (check.type === 0 && checksPassed === checksNeeded){
                        passes++;
                    }
                }
                if (passes === condition.length){
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

    private buildQueryFromStatement(sql, params):Query{
        const segments:Array<Array<string>> = this.parseSegments(sql);
        let query:Query = {
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
        };
        for (let i = segments.length - 1; i >= 0; i--){
            const segment = segments[i].join(" ");
            if (segment.indexOf("+") !== -1 || segment.indexOf("/") !== -1 || segment.indexOf("%") !== -1){
                throw `Invalid syntax. Arithmetic operators are not currently supported ${segment}`;
            } else if (segment.indexOf("&") !== -1 || segment.indexOf("|") !== -1 || segment.indexOf("^") !== -1){
                throw `Invalid syntax. Bitwise operators are not currently supported`;
            } else if (segment.indexOf(">") !== -1 || segment.indexOf("<") !== -1 || segment.indexOf("<>") !== -1 || segment.indexOf(">=") !== -1 || segment.indexOf("<=") !== -1){
                throw `Invalid syntax. Only the 'equal to' operator is currently supported`;
            }
            switch(segments[i][0]){
                case "SET":
                    query = this.parseSetSegment(segments[i], query, params ?? {})
                    break;
                case "VALUES":
                    query = this.parseValues(segments[i], query, params ?? {});
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
                case "ORDER":
                    query = this.parseOrderBySegment(segments[i], query);
                    break;
                case "WHERE":
                    query = this.parseWhereSegment(segments[i], query, params ?? {});
                    break;
                case "FROM":
                    if (segments[i].length !== 2){
                        throw `Invalid syntax at: ${segments[i].join(" ")}`
                    }
                    query.table = segments[i][1];
                    break;
                case "SELECT":
                    query.type = "SELECT";
                    query = this.parseSelectSegment(segments[i], query);
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
        return query;
    }

    private async buildQueriesFromSQL({ sql, params }):Promise<Array<Query>>{
        sql = sql.replace(/\-\-.*|\;$/g, "").trim();
        const queries:Array<Query> = [];
        const statements = sql.split(" UNION ");
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
            if (query.set[column].indexOf("$") === 0){
                const key = query.set[column].substring(1, query.set[column].length);
                if (key in params){
                    query.set[column] = params[key];
                } else {
                    throw `Invalid params. Missing key: ${key}`;
                }
            }
        }
        return query;
    }

    private breakSubgroups(statement:string, output = []){
        let openAt = -1;
        let closeAt = -1;
        let totalOpen = 0;
        for (let c = statement.length - 1; c >= 0; c--){
            switch (statement[c]){
                case "(":
                    totalOpen--;
                    if (totalOpen === 0){
                        openAt = c;
                    }
                    break;
                case ")":
                    totalOpen++;
                    if (closeAt === -1){
                        closeAt = c;
                    }
                    break;
                default:
                    break;
            }
            if (openAt !== -1){
                const snippet = statement.slice(openAt, closeAt + 1);
                statement = statement.replace(snippet, "").trim();
                output.push(snippet.replace(/^\(|\)$/g, "").trim());
                break;
            }
        }
        if (statement.indexOf("(") !== -1){
            output = this.breakSubgroups(statement, output);
        }
        return output;
    }

    private buildConditionCheck(check:Check, statement):Check{
        if (statement.indexOf("NOT ") === 0){
            check.type = 0;
            statement = statement.replace(/^(NOT)/, "").trim();
        }
        if (statement.indexOf(" OR ") === -1)
        {
            if (statement.indexOf("NOT ") === 0)
            {
                const values = statement.split("=");
                if (values.length !== 2){
                    throw `Invalid syntax at: ${check}`;
                }
                const column = values[0].trim();
                const value = values[1].trim();
                if (column in check.columns){
                    check.columns[column].push(value);
                } else {
                    check.columns[column] = [value];
                }
            } 
            else if (statement.indexOf("IS NOT NULL") !== -1)
            {
                const column = statement.replace("IS NOT NULL", "").trim();
                const value = null;
                if (column in check.columns){
                    check.columns[column].push(value);
                } else {
                    check.columns[column] = [value];
                }
            }
            else
            {
                const values = statement.trim().replace(/\'|\"/g, "").split("=");
                if (values.length !== 2){
                    throw `Invalid syntax at: ${check}`;
                }
                const column = values[0].trim();
                const value = values[1].trim();
                if (column in check.columns){
                    check.columns[column].push(value);
                } else {
                    check.columns[column] = [value];
                }
            }
        }
        else
        {
            const conditionSegments = statement.split(" OR ");
            for (let i = 0; i < conditionSegments.length; i++){
                const values = conditionSegments[i].trim().replace(/\'|\"/g, "").split("=");
                if (values.length !== 2){
                    throw `Invalid syntax at: ${check}`;
                }
                const column = values[0].trim();
                const value = values[1].trim();
                if (column in check.columns){
                    check.columns[column].push(value);
                } else {
                    check.columns[column] = [value];
                }
            }
        }
        return check;
    }

    private buildConditions(conditions):Condition{
        const condition:Condition = [];
        for (let i = 0; i < conditions.length; i++){
            let check:Check = {
                type: 1,
                columns: {},
            };
            if (Array.isArray(conditions[i])){
                for (let c = 0; c < conditions[i].length; c++){
                    check = this.buildConditionCheck(check, conditions[i][c]);
                }
            } else {
                check = this.buildConditionCheck(check, conditions[i]);
            }
            condition.push(check);
        }
        return condition;
    }

    private parseConditions(statement:string, groups:Array<string>, conditions = []):Array<any>{
        if (statement.indexOf(" AND ") !== -1){
            const checks = statement.split(" AND ");
            for (let c = 0; c < checks.length; c++){
                if (checks[c].indexOf("(") === -1){
                    conditions.push(checks[c]);
                } else {
                    const subgroupIndex = checks[c].match(/\d+/)[0];
                    statement = checks[c].replace(`(${subgroupIndex})`, groups[subgroupIndex]).trim();
                    conditions = this.parseConditions(statement, groups, conditions);
                }
            }
        } else {
            conditions.push(statement);
        }
        return conditions;
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
                switch (segments[i]){
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
                let statement = groups[i].join(" ").trim();
                const subgroups = this.breakSubgroups(statement);
                if (subgroups.length){
                    for (let s = 0; s < subgroups.length; s++){
                        statement = statement.replace(subgroups[s], `${s}`).trim();
                        if (subgroups[s].indexOf("(") !== -1){
                            throw `Invalid syntax at: ${subgroups[s]}. Nested parenthesis are not currently supported.`;
                        }
                    }
                    groups.splice(i, 1, {
                        statement: statement,
                        groups: subgroups,
                    });
                } else {
                    groups.splice(i, 1, {
                        statement: statement.replace(/^(OR)/, "").trim(),
                        groups: [],
                    });
                }
            }

            const conditions = [];
            for (let i = 0; i < groups.length; i++){
                const condition = this.parseConditions(groups[i].statement, groups[i].groups);
                conditions.push(condition);
            }
            for (let i = 0; i < conditions.length; i++){
                const condition = this.buildConditions(conditions[i]);
                query.where.push(condition);
            }

            for (let i = 0; i < query.where.length; i++){
                for (let j = 0; j < query.where[i].length; j++){
                    for (const column in query.where[i][j].columns){
                        for (let v = 0; v < query.where[i][j].columns[column].length; v++){
                            const value = query.where[i][j].columns[column][v];
                            if (value.indexOf("$") !== -1){
                                const key = query.where[i][j].columns[column][v].slice(1);
                                if (key in params){
                                    query.where[i][j].columns[column][v] = params[key];
                                } else {
                                    throw `Invalid params. Missing key: ${key}`;
                                }
                            }
                        }
                    }
                }
            }
            
            return query;
        }
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
                throw `Invalid syntax. ORDER BY currently supports single column sorting.`
            }
            else
            {
                let sort = "ASC";
                if (segments?.[1]){
                    sort = segments[1].toUpperCase();
                    if (sort !== "ASC" && sort !== "DESC"){
                        throw `Invalid syntax. ORDER BY currently supports ASC or DESC sorting.`
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
                if (values[i].indexOf("$") === 0){
                    const key = values[i].substring(1, values[i].length);
                    if (key in params){
                        query.values.push(params[key]);
                    } else {
                        throw `Invalid params. Missing key: ${key}`;
                    }
                } else {
                    query.values.push(values[i]);
                }
            }
        }
        return query;
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

    private parseSelectSegment(segments:Array<string>, query:Query):Query{
        if (segments.length === 1)
        {
            throw `Invalid syntax at: ${segments}.`
        }
        else if (segments[1].toUpperCase() === "DISTINCT")
        {
            throw `Invalid syntax: DISTINCT selects are not currently supported.`
        }
        else if (segments.includes("*"))
        {
            query.columns = ["*"];
        }
        else if (segments[1].toUpperCase().indexOf("COUNT") === 0 || segments[1].toUpperCase().indexOf("MIN") === 0 || segments[1].toUpperCase().indexOf("MAX") === 0 || segments[1].toUpperCase().indexOf("AVG") === 0 || segments[1].toUpperCase().indexOf("SUM") === 0)
        {
            const type = segments[1].match(/\w+/)[0].trim().toUpperCase();
            const column = segments[1].match(/\(.*?\)/)[0].replace(/\(|\)/g, "").trim();
            query.function = type as SQLFunction;
            query.columns = [column];
        }
        else
        {
            query.columns = [];
            for (let i = 1; i < segments.length; i++)
            {
                if (segments[i].indexOf(",") === -1){
                    query.columns.push(segments[i]);
                } else {
                    const cols = segments[i].split(",");
                    for (let j = 0; j < cols.length; j++){
                        const col = cols[j].trim();
                        if (col.length){
                            query.columns.push(col);
                        }
                    }
                }
            }
        }
        return query;
    }

    private parseSegments(sql){
        let textNodes:Array<string> = sql.replace(/\s+/g, " ").trim().split(" ");
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
