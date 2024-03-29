import type { Query, Settings, StreamArgs } from "../jsql";

class JSQLManager {
    private queue: Array<any>;
    private ready: boolean;
    private worker: Worker;
    private promises: {
        [key: string]: {
            success: Function;
            fail: Function;
        };
    };
    private settings: Settings;

    constructor() {
        this.ready = false;
        this.queue = [];
        this.promises = {};
        this.settings = {
            schema: `${location.origin}/schema.json`,
            dbWorker: "https://unpkg.com/@codewithkyle/jsql@1.3/jsql.worker.js",
            streamWorker: "https://unpkg.com/@codewithkyle/jsql@1.3/stream.worker.js",
            cache: false,
        };
    }

    private async getWorkerURL(settingsURL: string) {
        let url:string;
        if (settingsURL.indexOf("https://unpkg.com") === 0) {
            let request = await fetch(settingsURL);
            if (request.ok) {
                const response = await request.blob();
                url = URL.createObjectURL(response);
            } else {
                console.error(`${request.status}: ${request.statusText}`);
            }
        } else {
            url = settingsURL;
        }
        // @ts-ignore
        return url;
    }

    public async start(settings: Partial<Settings> = {}): Promise<string | void> {
        this.settings = Object.assign(this.settings, settings);
        const type = typeof this.settings.schema;
        if (type !== "string" && type !== "object") {
            console.error("Schema file setting must be a schema object or a URL");
            return;
        } 
        // @ts-ignore
        else if (type === "string" && this.settings.schema.indexOf("http") !== 0) {
            console.error("Schema file setting must be a complete URL. Ex: https://example.com/schema.json");
            return;
        }
        const version = await new Promise(async (resolve, reject) => {
            try {
                const url = await this.getWorkerURL(this.settings.dbWorker);
                this.worker = new Worker(url);
                this.worker.onmessage = this.inbox.bind(this);
                const version = await new Promise((internalResolve, interalReject) => {
                    const messageUid = uuid();
                    this.promises[messageUid] = {
                        success: internalResolve,
                        fail: interalReject,
                    };
                    this.worker.postMessage({
                        uid: messageUid,
                        type: "init",
                        data: {
                            schema: this.settings.schema,
                            currentVersion: localStorage.getItem("JSQL_DB_VERSION") || null,
                            cache: this.settings.cache,
                        },
                    });
                });
                this.flushQueue();
                resolve(version);
            } catch (e) {
                reject(e);
            }
        });
        localStorage.setItem("JSQL_DB_VERSION", `${version}`);
        return;
    }

    private inbox(e: MessageEvent): void {
        const { type, uid, data } = e.data;
        switch (type) {
            case "error":
                if (this.promises?.[uid]) {
                    this.promises[uid].fail(data);
                    delete this.promises[uid];
                }
                break;
            case "response":
                if (this.promises?.[uid]) {
                    this.promises[uid].success(data);
                    delete this.promises[uid];
                }
                break;
            default:
                console.warn(`Unknown JSQL Worker response message type: ${type}`);
                break;
        }
    }

    private flushQueue() {
        this.ready = true;
        for (let i = this.queue.length - 1; i >= 0; i--) {
            this.worker.postMessage(this.queue[i]);
            this.queue.splice(i, 1);
        }
    }

    private send(type: string, data: any = null, resolve: Function = noop, reject: Function = noop) {
        const messageUid = uuid();
        const message = {
            type: type,
            data: data,
            uid: messageUid,
        };
        this.promises[messageUid] = {
            success: resolve,
            fail: reject,
        };
        if (this.ready) {
            this.worker.postMessage(message);
        } else {
            this.queue.push(message);
        }
    }

    /**
     * Access IndexedDB data using an SQL query.
     * @see https://jsql.codewithkyle.com/
     * @example await db.query("SELECT * FROM table_name WHERE column_name = $value", { value: 1 });
     */
    public query<T>(
        SQL: string,
        params: {
            [key: string]: any;
        } | null = null,
        debug = false
    ): Promise<Array<T>> {
        return new Promise((resolve, reject) => {
            this.send(
                "sql",
                {
                    sql: `${SQL}`,
                    params: params,
                    debug: debug,
                },
                resolve,
                reject
            );
        });
    }

    /**
     * DO NOT USE!
     * This endpoint is for internal use only.
     * @deprecated
     */
    public raw(query: Array<Partial<Query>> | Partial<Query>): Promise<any> {
        console.warn(
            "JSQL Warning: You are performing an SQL query using the raw() function. This function is designed to be used for testing and debugging purposes only. If you are using this in production just know that the Query object interface can and will introduce breaking changes at any time."
        );
        return new Promise((resolve, reject) => {
            const queries: Array<Query> = [];
            const base: Query = {
                type: null,
                columnFormats: null,
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
                uniqueOnly: null,
                columnAlias: [],
            };
            if (!Array.isArray(query)) {
                query = [query];
            }
            for (let i = 0; i < query.length; i++) {
                const temp = { ...base };
                queries.push(Object.assign(temp, query[i]));
            }
            this.send("query", queries, resolve, reject);
        });
    }

    public async ingest(url: string, table: string, type: "JSON" | "NDJSON" = "NDJSON", args: StreamArgs = {}) {
        if (url.indexOf("http") !== 0) {
            console.error("Ingest URL must be a complete URL. Ex: https://example.com/data.json");
            return;
        }
        if (type === "JSON") {
            await this.ingestAsJSON(url, table, args);
        } else {
            await this.ingestAsNDJSON(url, table, args);
        }
    }

    private ingestAsNDJSON(url: string, table: string, args: StreamArgs): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const workerURL = await this.getWorkerURL(this.settings.streamWorker);
            const worker = new Worker(workerURL);

            try {
                const pendingQueries = [];
                let runningQuery = false;

                worker.onmessage = async (e: MessageEvent) => {
                    const { result, type } = e.data;
                    switch (type) {
                        case "result":
                            pendingQueries.push(result);
                            if (!runningQuery && pendingQueries.length){
                                runningQuery = true;
                                const queries = pendingQueries.splice(0, pendingQueries.length - 1);
                                const rows = [];
                                const data = {};
                                for (let i = 0; i < queries.length; i++){
                                    rows.push(`$row${i}`);
                                    data[`row${i}`] = queries[i];
                                }
                                let sql = `INSERT INTO ${table} VALUES (${rows.join(", ")})`;
                                if (rows.length){
                                    await this.query(sql, data);
                                }
                                runningQuery = false;
                            }
                            break;
                        case "done":
                            worker.terminate();
                            const queries = pendingQueries;
                            const rows = [];
                            const data = {};
                            for (let i = 0; i < queries.length; i++){
                                rows.push(`$row${i}`);
                                data[`row${i}`] = queries[i];
                            }
                            let sql = `INSERT INTO ${table} VALUES (${rows.join(", ")})`;
                            if (rows.length){
                                await this.query(sql, data);
                            }
                            resolve();
                            break;
                        default:
                            break;
                    }
                };
                worker.postMessage({
                    url: url,
                    args: args,
                });
            } catch (e) {
                worker.terminate();
                reject(e);
            }
        });
    }

    private async ingestAsJSON(url: string, table: string, args: StreamArgs) {
        const requestArgs = Object.assign(
            {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
            },
            args
        );
        const request = await fetch(url, {
            method: requestArgs.method,
            headers: new Headers(requestArgs.headers),
            credentials: requestArgs.credentials,
        });
        if (request.ok) {
            const response = await request.json();
            const inserts = [];
            for (const row of response) {
                inserts.push(
                    this.query(`INSERT INTO ${table} VALUES ($row)`, {
                        row: row,
                    })
                );
            }
            await Promise.all(inserts);
        } else {
            throw `${request.status}: ${request.statusText}`;
        }
    }
}

function uuid() {
    // @ts-ignore
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

const noop = () => {};

const db = new JSQLManager();
export default db;
