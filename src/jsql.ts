import type { Query, Settings } from "../jsql";

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
        this.worker = null;
        this.ready = false;
        this.queue = [];
        this.promises = {};
        this.settings = {
            schema: `${location.origin}/schema.json`,
            dbWorker: "https://unpkg.com/@codewithkyle/jsql@1/jsql.worker.js",
            streamWorker:
                "https://unpkg.com/@codewithkyle/jsql@1/stream.worker.js",
        };
    }

    private async getWorkerURL(settingsURL: string) {
        let url = null;
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
        return url;
    }

    public async start(
        settings: Partial<Settings> = {}
    ): Promise<string | void> {
        this.settings = Object.assign(this.settings, settings);
        const type = typeof this.settings.schema;
        if (type !== "string" && type !== "object") {
            console.error(
                "Schema file setting must be a schema object or a URL"
            );
            return;
        } else if (
            type === "string" &&
            this.settings.schema.indexOf("http") !== 0
        ) {
            console.error(
                "Schema file setting must be a complete URL. Ex: https://example.com/schema.json"
            );
            return;
        }
        const version = await new Promise(async (resolve, reject) => {
            try {
                const url = await this.getWorkerURL(this.settings.dbWorker);
                this.worker = new Worker(url);
                this.worker.onmessage = this.inbox.bind(this);
                const version = await new Promise(
                    (internalResolve, interalReject) => {
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
                                currentVersion:
                                    localStorage.getItem("JSQL_DB_VERSION") ||
                                    null,
                            },
                        });
                    }
                );
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
                console.warn(
                    `Unknown JSQL Worker response message type: ${type}`
                );
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

    private send(
        type: string,
        data: any = null,
        resolve: Function = noop,
        reject: Function = noop
    ) {
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

    public query(SQL: string, params: any = null, debug = false): Promise<any> {
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

    public raw(query: Array<Partial<Query>> | Partial<Query>): Promise<any> {
        console.warn(
            "JSQL Warning: You are performing an SQL query using the raw() function. This function is designed to be used for testing and debugging purposes only. If you are using this in production just know that the Query object interface can and will introduce breaking changes at any time."
        );
        return new Promise((resolve, reject) => {
            const queries: Array<Query> = [];
            const base: Query = {
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
                uniqueOnly: null,
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

    public async ingest(
        url: string,
        table: string,
        type: "JSON" | "NDJSON" = "NDJSON"
    ) {
        if (url.indexOf("http") !== 0) {
            console.error(
                "Ingest URL must be a complete URL. Ex: https://example.com/data.json"
            );
            return;
        }
        if (type === "JSON") {
            await this.ingestAsJSON(url, table);
        } else {
            await this.ingestAsNDJSON(url, table);
        }
    }

    private ingestAsNDJSON(url: string, table: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const workerURL = await this.getWorkerURL(
                this.settings.streamWorker
            );
            const worker = new Worker(workerURL);
            let total = 0;
            let totalInserted = 0;
            let hasFinished = false;
            try {
                worker.onmessage = async (e: MessageEvent) => {
                    const { result, type } = e.data;
                    switch (type) {
                        case "result":
                            total++;
                            await this.query(
                                `INSERT INTO ${table} VALUES ($row)`,
                                {
                                    row: result,
                                }
                            );
                            totalInserted++;
                            if (total === totalInserted && hasFinished) {
                                resolve();
                            }
                            break;
                        case "done":
                            worker.terminate();
                            hasFinished = true;
                            break;
                        default:
                            break;
                    }
                };
                worker.postMessage({
                    url: url,
                });
            } catch (e) {
                worker.terminate();
                reject(e);
            }
        });
    }

    private async ingestAsJSON(url: string, table: string) {
        const request = await fetch(url, {
            method: "GET",
            headers: new Headers({
                Accept: "application/json",
            }),
            credentials: "include",
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
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
        (
            c ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
        ).toString(16)
    );
}

const noop = () => {};

const db = new JSQLManager();
export default db;
