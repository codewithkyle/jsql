class a{constructor(){this.worker=new Worker("/js/markdown-worker.js"),this.worker.onmessage=this.inbox.bind(this),this.messageId=0,this.promises={}}inbox(s){const{id:e,html:r,type:t,error:o}=s.data;e in this.promises&&(t==="error"?this.promises[e].reject(o):this.promises[e].resolve(r),delete this.promises[e])}stashMessageCallback(s,e,r){this.promises[`${s}`]={resolve:e,reject:r}}sendDataToWorker(s,e,r=()=>{}){this.messageId++,this.stashMessageCallback(this.messageId,e,r),this.worker.postMessage({id:this.messageId,markdown:s})}renderMarkdown(s){return new Promise((e,r)=>{this.sendDataToWorker(s,e,r)})}}const i=new a,n=i.renderMarkdown.bind(i);export{n as renderMarkdown};
