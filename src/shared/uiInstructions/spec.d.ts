export interface Thumbnail {dataUrl:string;width:number;height:number}
export interface Component {id:string;name:string;kind:string;style?:Record<string,string>;evidence?:string;thumbnail?:Thumbnail;references?:unknown[]}
export interface Instance {id:string;componentId:string;parentId:string|null;label?:string;selector?:string;thumbnail?:Thumbnail;rect?:{x:number;y:number;width:number;height:number}}
export interface Tree {id:string;name:string;width:number;evidence?:string;nodes:Instance[];preview?:Thumbnail}
export interface Specification {valid:boolean;errors:string[];warnings:string[];manifest:{version:1;definitions:Component[];trees:Tree[]}|null;documents:Record<string,string>}
export function parseSpecification(markdown:string):Specification
export function replaceComponentDocument(markdown:string,id:string,document:string):string
export function isSafeThumbnail(value:unknown):value is string
