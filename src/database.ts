import type { OpenCallback } from "../jsql";

export default class IDB {
    private db: IDBDatabase;
    private name: string;

    constructor(name:string, version:number, callbacks:OpenCallback) {
        this.name = name;
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = (event) => {
            if (callbacks && callbacks?.upgrade && typeof callbacks.upgrade === "function") {
                this.db = req.result;
                callbacks.upgrade(this.db, event.oldVersion, event.newVersion);
            }
        };
        req.onblocked = (event) => {
            if (callbacks && callbacks?.blocked && typeof callbacks.blocked === "function") {
                callbacks.blocked(event);
            }
        };
        req.onsuccess = () => {
            this.db = req.result;
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
        console.log(tx);
        const store = tx.objectStore(table);
        return this.promisify(store.getAll());
    }

    public async getAllByIndex(table:string, column:string, key:any): Promise<any> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const index = store.index(column);
        return this.promisify(index.getAll(key));
    }

    public async getByIndex(table:string, column:string, key:any): Promise<any|undefined> {
        const tx = this.db.transaction(table, "readonly");
        const store = tx.objectStore(table);
        const index = store.index(column);
        return this.promisify(index.get(key));
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

    public async add(table:string, data:any): Promise<number> {
        const tx = this.db.transaction(table, "readwrite");
        const store = tx.objectStore(table);
        return this.promisify(store.add(data));
    }

    public async update(table:string, data:any): Promise<number> {
        const tx = this.db.transaction(table, "readwrite");
        const store = tx.objectStore(table);
        return this.promisify(store.put(data));
    }

    public async delete(table:string, key:any): Promise<void> {
        const tx = this.db.transaction(table, "readwrite");
        const store = tx.objectStore(table);
        return this.promisify(store.delete(key));
    }

    private promisify(req:IDBRequest|IDBOpenDBRequest): Promise<any> {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            if ("onblocked" in req){
                req.onblocked = () => reject(req.error);
            }
        });
    }
}
