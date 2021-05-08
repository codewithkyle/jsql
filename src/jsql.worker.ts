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
            let response = null;
            switch (type){
                case "init":
                    await this.init(data);
                    break;
                case "query":
                    response = await this.queryBuilder(data);
                    break;
                default:
                    console.warn(`Invalid JSQL Worker message type: ${type}`);
                    break;
            }
            this.send("response", response, uid);
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
    }

    private async queryBuilder({ sql, params }):Promise<Query>{
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
        };
        for (let i = segments.length - 1; i >= 0; i--){
            switch(segments[i][0]){
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
                    break;
                case "WHERE":
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
                    query.type = "UPDATE";
                    break;
                default:
                    break;
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
            throw `Invalid syntax: Missing values.`;
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
