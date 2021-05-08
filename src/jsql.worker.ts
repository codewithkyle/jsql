import type { Table, Schema, Column, Query, SQLFunction } from "../jsql";
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
                    output = await this.performQuery(data);
                    break;
                case "sql":
                    const query = await this.buildQuery(data);
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

    private async performQuery(query:Query):Promise<Array<any>>{
        let rows = [];
        switch(query.type){
            case "SELECT":
                rows = await this.db.getAll(query.table);
                break;
            case "INSERT":
                for (const row of query.values){
                    await this.db.put(query.table, row);
                }
                rows = query.values;
                break;
            default:
                break;
        }
        if (query.columns.length && query.columns[0] !== "*"){
            let modifiedRows = [];
            for (let j = 0; j < rows.length; j++){
                const row = rows[j];
                const temp = {};
                for (let i = 0; i < query.columns.length; i++){
                    temp[query.columns[i]] = row?.[query.columns[i]] ?? null;
                }
                modifiedRows.push(temp);
            }
            rows = modifiedRows;
        }
        if (query.limit !== null){
            rows = rows.splice(query.offset, query.limit);
        }
        return rows;
    }

    private async buildQuery({ sql, params }):Promise<Query>{
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

    private parseWhereSegment(segments:Array<string>, query:Query, params:any):Query{
        if (segments.length < 2)
        {
            throw `Invalid syntax at: ${segments.join(" ")}.`
        }
        else
        {
            query.where = [];
            segments.splice(0, 1);
            const conditions = segments.join(" ").trim().split(" AND ");
            for (let i = 0; i < conditions.length; i++){
                const condition = conditions[i].trim();
                if (condition.indexOf(" OR ") === -1){
                    if (condition.indexOf("NOT ") === 0){
                        const values = condition.replace(/^(NOT)/, "").trim().split("=");
                        if (values.length !== 2){
                            throw `Invalid syntax at: ${condition}`;
                        }
                        query.where.push({
                            type: "EXCLUDE",
                            column: values[0].trim(),
                            values: [values[1].trim().replace(/^[\"\']|[\"\']$/g, "")],
                        });
                    } 
                    else if (condition.indexOf("IS NOT NULL") !== -1){
                        const column = condition.replace("IS NOT NULL", "").trim();
                        query.where.push({
                            type: "EXCLUDE",
                            column: column,
                            values: [null],
                        });
                    } else {
                        const values = condition.trim().replace(/\'|\"/g, "").split("=");
                        if (values.length !== 2){
                            throw `Invalid syntax at: ${condition}`;
                        }
                        query.where.push({
                            type: "INCLUDE",
                            column: values[0].trim(),
                            values: [values[1].trim().replace(/^[\"\']|[\"\']$/g, "")],
                        });
                    }
                } else {
                    const conditionSegments = condition.split(" OR ");
                    const result = {
                        type: "INCLUDE",
                        column: null,
                        values: [],
                    };
                    for (let i = 0; i < conditionSegments.length; i++){
                        const values = conditionSegments[i].trim().replace(/\'|\"/g, "").split("=");
                        if (values.length !== 2){
                            throw `Invalid syntax at: ${condition}`;
                        }
                        result.column = values[0].trim();
                        result.values.push(values[1].trim());
                    }
                    // @ts-ignore
                    query.where.push(result);
                }
            }
        }
        for (let i = 0; i < query.where.length; i++){
            for (let j = 0; j < query.where[i].values.length; j++){
                if (query.where[i].values[j].indexOf("$") === 0){
                    const key = query.where[i].values[j].substring(1, query.where[i].values[j].length);
                    if (key in params){
                        query.where[i].values[j] = params[key];
                    } else {
                        throw `Invalid params. Missing key: ${key}`;
                    }
                }
            }
        }
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
