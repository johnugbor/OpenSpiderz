import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { BinaryStorageDriver } from "@spiderz/core";
import type { IBinaryData } from "@spiderz/shared";
export class LocalBinaryStorage implements BinaryStorageDriver {
  public constructor(private readonly root: string) {}
  public async put(dataId: string, stream: Readable, metadata: Omit<IBinaryData,"dataId"|"fileSize">): Promise<IBinaryData> { await fs.mkdir(this.root,{recursive:true}); const path=join(this.root,dataId); await pipeline(stream,createWriteStream(path,{flags:"wx"})); const stat=await fs.stat(path); await fs.writeFile(`${path}.json`,JSON.stringify({...metadata,dataId,fileSize:stat.size})); return {...metadata,dataId,fileSize:stat.size}; }
  public get(dataId:string):Promise<Readable>{return Promise.resolve(createReadStream(join(this.root,dataId)));}
  public async delete(dataId:string):Promise<void>{await Promise.all([fs.rm(join(this.root,dataId),{force:true}),fs.rm(join(this.root,`${dataId}.json`),{force:true})]);}
  public async *listOlderThan(cutoff:Date):AsyncIterable<string>{for(const entry of await fs.readdir(this.root)){if(entry.endsWith('.json'))continue;const stat=await fs.stat(join(this.root,entry));if(stat.mtime<cutoff)yield entry;}}
}
