class JSQLManager {
    private queue: Array<any>;
	private ready: boolean;
    private worker: Worker;
    private promises: {
		[key: string]: {
            success: Function;
            fail: Function;
        }
	};

    constructor(){
        this.worker = null;
        this.ready = false;
        this.queue = [];
        this.promises = {};
    }

    public start(schemaURL:string = `${location.origin}/scheam.json`, workerURL:string = "https://cdn.jsdelivr.net/npm/@codewithkyle/jsql@1/jsql.worker.js"):Promise<string|void>{
        return new Promise((resolve, reject) => {
            this.worker = new Worker(workerURL);
            this.worker.onmessage = this.inbox.bind(this);
            new Promise((internalResolve, interalReject) => {
                const messageUid = uuid();
                this.promises[messageUid] = {
                    success: internalResolve,
                    fail: interalReject
                };
                this.worker.postMessage({
                    uid: messageUid,
                    type: "init",
                    data: schemaURL,
                });
            }).then(()=>{
                this.flushQueue();
                resolve();
            }).catch((e)=>{
                console.error(e);
                reject(e);
            });
        });
    }

    private inbox(e:MessageEvent):void{
        const { type, uid, data } = e.data;
        switch (type){
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

    private send(type: string, data: any = null, resolve: Function = noop, reject:Function = noop) {
		const messageUid = uuid();
		const message = {
			type: type,
			data: data,
			uid: messageUid,
		};
        this.promises[messageUid] = {
            success: resolve,
            fail: reject
        };
		if (this.ready) {
			this.worker.postMessage(message);
		} else {
			this.queue.push(message);
		}
	}

    public query(SQL:string, params:any = null):Promise<any>{
        return new Promise((resolve, reject) => {
            this.send("query", {
                sql: SQL,
                params: params,
            }, resolve, reject);
        });
    }
}

function uuid(){
    // @ts-ignore
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

const noop = ()=>{};

const db = new JSQLManager();
export default db;