import { FileTokSyncStore } from "../store";

const store = new FileTokSyncStore();
store.reset();
console.log(`TokSync data reset at ${store.filePath}`);
