import type {Map as YMap} from 'yjs'
import {sanitizeOverviewReviews,type OverviewReview} from '../shell/page/overview/model.ts'

// Entries live directly on the existing page map. Creating a nested map lazily on two
// offline clients would race and discard one client's entire first review collection.
const PREFIX='overviewReview:'
export function writeOverviewReviews(target:YMap<unknown>,next:unknown,before:unknown={}) {
 const previous=sanitizeOverviewReviews(before)
 for(const [id,review] of Object.entries(sanitizeOverviewReviews(next))) {
  if(JSON.stringify(review)!==JSON.stringify(previous[id]))target.set(PREFIX+id,structuredClone(review))
 }
 // An absent key never deletes another person's previously recorded decision.
}
export function readOverviewReviews(target:YMap<unknown>):Record<string,OverviewReview> {
 const values:Record<string,unknown>={}
 target.forEach((value,key)=>{if(key.startsWith(PREFIX))values[key.slice(PREFIX.length)]=value})
 return sanitizeOverviewReviews(values)
}
