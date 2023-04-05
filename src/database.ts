import type { OpenCallback } from "../jsql";

export default class IDB {
    private db: IDBDatabase;
    private name: string;
    private queue: Transaction[];
    private flushing: boolean;

    constructor(name:string, version:number, callbacks:OpenCallback) {
        this.name = name;
        this.queue = [];
        this.flushing = false;
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = (event) => {
            if (callbacks && callbacks?.upgrade && typeof callbacks.upgrade === "function") {
                // @ts-ignore
                this.db = event.target.result;
                callbacks.upgrade(this.db, event.oldVersion, event.newVersion);
            }
        };
        req.onblocked = (event) => {
            if (callbacks && callbacks?.blocked && typeof callbacks.blocked === "function") {
                callbacks.blocked(event);
            }
        };
        req.onsuccess = (e) => {
            // @ts-ignore
            this.db = e.target.result;
            let usedCB = false;
            this.db.onversionchange = (event) => {
                if (callbacks && callbacks?.blocking && typeof callbacks.blocking === "function") {
                    usedCB = true;
                    callbacks.blocking(event);
                }
            };
            this.db.onclose = (event) => {
                if (callbacks && callbacks?.terminated && typeof callbacks.terminated === "function") {
                    usedCB = true;
                    callbacks.terminated(event);
                }
            };
            if (!usedCB && callbacks && callbacks?.success && typeof callbacks.success === "function") {
                callbacks.success();
            }
        }
    }

    public async deleteDB(): Promise<void> {
        return this.promisify(indexedDB.deleteDatabase(this.name));
    }

    public getAll(table:string): Promise<any> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readonly");
                    const store = tx.objectStore(table);
                    const records = await this.promisify(store.getAll());
                    this.restoreData(records);
                    return records;
                } catch (e) {
                    return [];
                }
            }); 
            this.queue.push(transaction);
            this.flush()
        });
    }

    public getAllByIndex(table:string, column:string, key:any): Promise<any> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readonly");
                    const store = tx.objectStore(table);
                    const index = store.index(column);
                    const records = await this.promisify(index.getAll(key));
                    this.restoreData(records);
                    return records;
                } catch (e) {
                    return [];
                }
            });
            this.queue.push(transaction);
            this.flush()
        });
    }

    public getByIndex(table:string, column:string, key:any): Promise<any|undefined> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readonly");
                    const store = tx.objectStore(table);
                    const index = store.index(column);
                    const record = await this.promisify(index.get(key));
                    if (record != null){
                        for (const key in record){
                            if (typeof record[key] === "string"){
                                try {
                                    record[key] = JSON.parse(record[key]);
                                } catch (e) {}
                            }
                        }
                    }
                    return record;
                } catch (e) {
                    return undefined;
                }
            });
            this.queue.push(transaction);
            this.flush()
        });
    }

    public clear(table:string): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readwrite");
                    const store = tx.objectStore(table);
                    await this.promisify(store.clear());
                } catch (e) {}
            });
            this.queue.push(transaction);
            this.flush()
        });
    }

    public count(table:string): Promise<number> { 
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readonly");
                    const store = tx.objectStore(table);
                    return await this.promisify(store.count());
                } catch (e) {
                    return 0;
                }
            });
            this.queue.push(transaction);
            this.flush()
        });
    }

    public countByIndex(table:string, column:string, key:any): Promise<number> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                try {
                    const tx = this.db.transaction(table, "readonly");
                    const store = tx.objectStore(table);
                    const index = store.index(column);
                    return await this.promisify(index.count(key));
                } catch (e) {
                    return 0;
                }
            });
            this.queue.push(transaction);
            this.flush()
        });
    }

    public add(table:string, data:any): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                const tx = this.db.transaction(table, "readwrite", { durability: "strict" });
                tx.oncomplete = () => {
                    resolve();
                } 
                tx.onerror = () => {
                    reject(tx.error);
                }
                const store = tx.objectStore(table);
                const cleanData = structuredClone(data);
                this.cleanData(cleanData);
                await this.promisify(store.add(cleanData));
            });
            this.queue.push(transaction);
            this.flush();
        });
    }

    public update(table:string, data:any): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                const tx = this.db.transaction(table, "readwrite", { durability: "strict" });
                tx.oncomplete = () => {
                    resolve();
                }
                tx.onerror = () => {
                    reject(tx.error);
                }
                const store = tx.objectStore(table);
                const cleanData = structuredClone(data);
                this.cleanData(cleanData);
                await this.promisify(store.put(cleanData));
            });
            this.queue.push(transaction);
            this.flush();
        });
    }

    public async delete(table:string, key:any): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = new Transaction(resolve, reject, async () => {
                const tx = this.db.transaction(table, "readwrite", { durability: "strict" });
                tx.oncomplete = () => {
                    resolve();
                }
                tx.onerror = () => {
                    reject(tx.error);
                }
                const store = tx.objectStore(table);
                await this.promisify(store.delete(key));
            });
            this.queue.push(transaction);
            this.flush();
        });
    }

    private cleanData(data:any): any {
        for (const key in data){
            if (typeof data[key] === "object"){
                data[key] = JSON.stringify(data[key]);
            }
        }
    }

    private restoreData(records:Array<any>): void {
        for (let i = 0; i < records.length; i++){
            for (const key in records[i]){
                if (typeof records[i][key] === "string"){
                    try {
                        records[i][key] = JSON.parse(records[i][key]);
                    } catch (e) {}
                }
            }
        }
    }

    private promisify(req:IDBRequest|IDBOpenDBRequest|IDBTransaction): Promise<any> {
        return new Promise((resolve, reject) => {
            if ("oncomplete" in req){
                // @ts-ignore
                req.oncomplete = (e) => resolve(e.target.result);
            }
            if ("onerror" in req){
                req.onerror = () => reject(req.error);
            }
            if ("onsuccess" in req){
                // @ts-ignore
                req.onsuccess = (e) => resolve(e.target.result);
            }
            if ("onblocked" in req){
                req.onblocked = () => reject(req.error);
            }
        });
    }

    private async flush(force = false) {
        if (this.flushing && !force) return;
        if (this.queue.length > 0 && this.db){
            this.flushing = true;
            const transaction = this.queue.shift();
            if (transaction){
                try {
                    const result = await transaction.tx();
                    transaction.resolve(structuredClone(result));
                } catch (e) {
                    transaction.reject(e);
                }
            }
            if (this.queue.length > 0){
                this.flush(true);
            } else {
                this.flushing = false;
            }
        } else {
            this.flushing = false;
        }

    }
}

class Transaction {
    public resolve:Function;
    public reject:Function;
    public tx:Function;

    constructor(resolve:Function, reject:Function, tx:Function) {
        this.resolve = resolve;
        this.reject = reject;
        this.tx = tx;
    }
}
