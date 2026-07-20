import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { BinaryStorageDriver } from "@spiderz/core";
import type { IBinaryData } from "@spiderz/shared";
export interface S3BinaryStorageOptions { readonly bucket: string; readonly region: string; readonly endpoint?: string; readonly forcePathStyle?: boolean; readonly credentials?: { readonly accessKeyId: string; readonly secretAccessKey: string }; }
/** Works with AWS S3, MinIO, and other S3-compatible APIs. */
export class S3BinaryStorage implements BinaryStorageDriver {
  private readonly client: S3Client;
  public constructor(private readonly options: S3BinaryStorageOptions) { this.client=new S3Client({region:options.region,...(options.endpoint===undefined?{}:{endpoint:options.endpoint}),forcePathStyle:options.forcePathStyle??false,...(options.credentials===undefined?{}:{credentials:options.credentials})}); }
  public async put(dataId:string,stream:Readable,metadata:Omit<IBinaryData,"dataId"|"fileSize">):Promise<IBinaryData>{let size=0;stream.on("data",(chunk:Buffer)=>{size+=chunk.length;});await this.client.send(new PutObjectCommand({Bucket:this.options.bucket,Key:dataId,Body:stream,ContentType:metadata.mimeType,Metadata:{filename:metadata.fileName}}));return {...metadata,dataId,fileSize:size};}
  public async get(dataId:string):Promise<Readable>{const result=await this.client.send(new GetObjectCommand({Bucket:this.options.bucket,Key:dataId}));if(!(result.Body instanceof Readable))throw new Error(`Binary data '${dataId}' was not found.`);return result.Body;}
  public async delete(dataId:string):Promise<void>{await this.client.send(new DeleteObjectCommand({Bucket:this.options.bucket,Key:dataId}));}
  public async *listOlderThan(cutoff:Date):AsyncIterable<string>{let token: string|undefined;do{const page=await this.client.send(new ListObjectsV2Command({Bucket:this.options.bucket,ContinuationToken:token}));for(const object of page.Contents??[])if(object.Key!==undefined&&object.LastModified!==undefined&&object.LastModified<cutoff)yield object.Key;token=page.NextContinuationToken;}while(token!==undefined);}
}
