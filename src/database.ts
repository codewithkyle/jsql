import type { OpenCallback } from "../jsql";

export default class IDB {
    private db: IDBDatabase;
    private name: string;

    constructor(name:string, version:number, callbacks:OpenCallback) {
        this.name = name;
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

    public async getAll(table:string): Promise<any> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const records = await this.promisify(store.getAll());
        this.restoreData(records);
        return records;
    }

    public async getAllByIndex(table:string, column:string, key:any): Promise<any> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const index = store.index(column);
        const records = await this.promisify(index.getAll(key));
        this.restoreData(records);
        return records;
    }

    public async getByIndex(table:string, column:string, key:any): Promise<any|undefined> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const index = store.index(column);
        const record = await this.promisify(index.get(key));
        if (record){
            for (const key in record){
                if (typeof record[key] === "string"){
                    try {
                        record[key] = JSON.parse(record[key]);
                    } catch (e) {}
                }
            }
        }
        return record;
    }

    public async clear(table:string): Promise<void> {
        const tx = this.db.transaction(table, "readwrite");
        const store = tx.objectStore(table);
        return this.promisify(store.clear());
    }

    public async count(table:string): Promise<number> { 
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        return this.promisify(store.count());
    }

    public async countByIndex(table:string, column:string, key:any): Promise<number> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const index = store.index(column);
        return this.promisify(index.count(key));
    }

    public add(table:string, data:any): Promise<void> {
        return new Promise(async (resolve, reject) => {
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
    }

    public update(table:string, data:any): Promise<void> {
        return new Promise(async (resolve, reject) => {
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
    }

    public async delete(table:string, key:any): Promise<void> {
        const tx = this.db.transaction(table, "readwrite");
        const store = tx.objectStore(table);
        return this.promisify(store.delete(key));
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
}
