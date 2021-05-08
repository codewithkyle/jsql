import type { Table, Schema, Column } from "../jsql";
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
                    await this.queryParser(data);
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

    private async queryParser({ sql, params }){
        const segments = this.buildSegments(sql);
    }

    private buildSegments(sql){
        let textNodes:Array<string> = sql.replace(/\s+/g, " ").trim().split(" ");
        const segments = [];
        while(textNodes.length > 0){
            let index = -1;
            for (let i = textNodes.length - 1; i >= 0; i--){
                switch(textNodes[i].toUpperCase()){
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
                throw `Invalid syntax. Query: '${sql}'`;
            } else {
                segments.push(textNodes.splice(index, textNodes.length));
            }
        }
        return segments.reverse();
    }
}
new JSQLWorker();
